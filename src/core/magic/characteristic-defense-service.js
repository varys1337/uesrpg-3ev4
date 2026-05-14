/**
 * @module magic/characteristic-defense-service
 *
 * src/core/magic/characteristic-defense-service.js
 *
 * Characteristic defense engine for UESRPG 3ev4.
 * Implements a "save-like" defense model where the defender tests against
 * a characteristic (e.g., Endurance vs Fatigue) instead of Block/Evade/Ward.
 *
 * Integration:
 *  - Hooks into `uesrpg.spell.spellHitTarget` for post-hit characteristic saves
 *  - Uses the consequence engine for failure payloads
 *  - Uses authority proxy for all mutations
 *
 * Design:
 *  - Spell must have `engine.defenseModel = "characteristic"`
 *  - Defender rolls d100 vs (Characteristic TN + modifier)
 *  - Modifier source: "spellStrength" (spell level × 10) or "formula"
 *  - On success: negate / halve / endEffect
 *  - On failure: apply consequences (resource deltas, conditions)
 *
 * Target: Foundry VTT v13.351
 */

import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { normalizeSpellConfig } from "./spell-config.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { applyCondition } from "../conditions/condition-engine.js";
import { _num, _strTrim as _str, createDebugLogger } from "./_primitives.js";
import { buildMagicCastContext } from "./opposed/cast-context.js";
import { getSpellLevel, getSpellStrengthFormula } from "./magicka-utils.js";

const _CHA_LABELS = {
  str: "Strength", end: "Endurance", agi: "Agility", int: "Intelligence",
  wp: "Willpower", prc: "Perception", prs: "Personality", lck: "Luck"
};

const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][CharDefense]");

/**
 * Resolve the Spell Strength for modifier computation.
 * SS is typically the spell's numeric strength formula (flat value) or level × 10.
 *
 * @param {Item} spell
 * @returns {number}
 */
function _resolveSpellStrength(spell) {
  // Try numeric spell strength first.
  const formula = _str(getSpellStrengthFormula(spell));
  const n = Number(formula);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  // Fallback: spell level × 10
  const level = _num(getSpellLevel(spell), 1);
  return level * 10;
}

/**
 * Compute the modifier penalty applied to the defender's characteristic TN.
 *
 * @param {Item} spell
 * @param {object} charDefConfig - Normalized characteristicDefense config
 * @returns {number} Modifier value (subtracted from defender TN)
 */
function _resolveModifier(spell, charDefConfig) {
  const mode = _str(charDefConfig.modifierMode);
  if (mode === "formula") {
    // Evaluate the custom formula (simple numeric for now)
    const val = _num(charDefConfig.modifierFormula, 0);
    return val;
  }
  // Default: spellStrength
  return _resolveSpellStrength(spell);
}

function _resolveModifierFromCastContext(spell, charDefConfig, opts = {}) {
  const mode = _str(charDefConfig.modifierMode);
  if (mode === "formula") {
    return _num(charDefConfig.modifierFormula, 0);
  }

  const castContext = opts?.castContext ?? buildMagicCastContext(opts?.attacker ?? {}, spell, {
    actor: opts?.caster ?? null
  });
  const spellStrengthValue = Number(castContext?.spellStrengthValue ?? 0);
  if (Number.isFinite(spellStrengthValue) && spellStrengthValue > 0) {
    return Math.floor(spellStrengthValue);
  }
  return 0;
}

/**
 * Check if a spell uses characteristic defense model.
 *
 * @param {Item} spell
 * @returns {boolean}
 */
export function isCharacteristicDefense(spell) {
  if (!spell) return false;
  const config = normalizeSpellConfig(spell);
  return config.defenseModel === "characteristic";
}

/**
 * Compute the TN breakdown for a characteristic defense without rolling.
 * Used by defender-commit to pre-display TN consistently with the actual roll.
 *
 * @param {Actor} defender - The defending actor
 * @param {Item} spell - The spell being defended against
 * @returns {{finalTN: number, baseTN: number, totalMod: number, chaLabel: string, breakdown: Array}|null}
 */
export function computeCharacteristicDefenseTN(defender, spell, opts = {}) {
  if (!defender || !spell) return null;
  const config = normalizeSpellConfig(spell);
  const charDef = config.characteristicDefense;
  const chaKey = _str(charDef.defenderCharacteristic) || "end";
  const chaLabel = _CHA_LABELS[chaKey] ?? chaKey.toUpperCase();
  const charObj = defender.system?.characteristics?.[chaKey];
  const charTotal = _num(
    typeof charObj === "object" ? charObj?.total ?? charObj?.base : charObj,
    0
  );
  const modifier = _resolveModifierFromCastContext(spell, charDef, opts);
  const effectiveTN = Math.max(1, charTotal - modifier);
  const modLabel = charDef.modifierMode === "formula"
    ? "Modifier (formula)"
    : "Spell Strength";
  return {
    finalTN: effectiveTN,
    baseTN: charTotal,
    totalMod: -modifier,
    chaLabel,
    breakdown: [
      { key: "base", label: `${chaLabel}`, value: charTotal, source: "characteristic" },
      { key: "modifier", label: modLabel, value: -modifier, source: "spell" }
    ]
  };
}

/**
 * Execute a characteristic defense test for the defender against a spell.
 * Returns the result without applying consequences (caller applies).
 *
 * @param {Actor} defender - The defending actor
 * @param {Item} spell - The spell being defended against
 * @param {object} [opts={}]
 * @param {Actor} [opts.caster] - The caster (for chat flavor)
 * @param {boolean} [opts.postToChat=true] - Whether to post the roll to chat
 * @returns {Promise<CharacteristicDefenseResult|null>}
 */
export async function executeCharacteristicDefense(defender, spell, opts = {}) {
  if (!defender || !spell) return null;

  const config = normalizeSpellConfig(spell);
  const charDef = config.characteristicDefense;
  const chaKey = _str(charDef.defenderCharacteristic) || "end";
  const chaLabel = _CHA_LABELS[chaKey] ?? chaKey.toUpperCase();

  // Resolve the defender's characteristic TN
  const charObj = defender.system?.characteristics?.[chaKey];
  const charTotal = _num(
    typeof charObj === "object" ? charObj?.total ?? charObj?.base : charObj,
    0
  );

  // Resolve the modifier (spell strength or formula)
  const modifier = _resolveModifierFromCastContext(spell, charDef, opts);

  // Final TN = characteristic - modifier (harder save = lower TN)
  const effectiveTN = Math.max(1, charTotal - modifier);

  _debug("Characteristic defense:", {
    defender: defender.name,
    spell: spell.name,
    characteristic: chaKey,
    charTotal,
    modifier,
    effectiveTN,
    onSuccess: charDef.onSuccess,
    onFailure: charDef.onFailure
  });

  // Build TN breakdown for opposed card display
  const modLabel = charDef.modifierMode === "formula"
    ? "Modifier (formula)"
    : "Spell Strength";
  const tnData = {
    finalTN: effectiveTN,
    baseTN: charTotal,
    totalMod: -modifier,
    breakdown: [
      { key: "base", label: `${chaLabel}`, value: charTotal, source: "characteristic" },
      { key: "modifier", label: modLabel, value: -modifier, source: "spell" }
    ]
  };

  // Roll the defense test
  const result = await doTestRoll(defender, {
    target: Number(tnData?.finalTN ?? effectiveTN) || effectiveTN,
    allowLucky: true,
    allowUnlucky: true
  });

  // Post roll to chat (optional - disabled for opposed workflow integration)
  const postToChat = opts.postToChat ?? true;
  if (postToChat) {
    const spellName = _str(spell.name) || "Spell";
    await result.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: defender }),
      flavor: `<b>${chaLabel} Save</b> vs ${spellName} (TN ${Number(tnData?.finalTN ?? effectiveTN) || effectiveTN})`,
      flags: { "uesrpg-3ev4": { magicOpposedMeta: { stage: "characteristic-defense" } } }
    });
  }

  return {
    success: result.isSuccess,
    criticalSuccess: result.isCriticalSuccess,
    criticalFailure: result.isCriticalFailure,
    rollTotal: result.rollTotal,
    target: Number(tnData?.finalTN ?? effectiveTN) || effectiveTN,
    degree: result.degree,
    characteristic: chaKey,
    characteristicLabel: chaLabel,
    characteristicTotal: charTotal,
    modifier,
    onSuccess: charDef.onSuccess,
    onFailure: charDef.onFailure,
    result,
    roll: result.roll,
    tnData
  };
}

/**
 * Process the outcome of a characteristic defense against a spell.
 * Applies consequences or negation based on the save result.
 *
 * @param {Actor} defender
 * @param {Item} spell
 * @param {CharacteristicDefenseResult} defResult
 * @param {object} [opts={}]
 * @param {Actor} [opts.caster] - The caster actor
 * @returns {Promise<CharacteristicDefenseOutcome>}
 */
export async function processCharacteristicDefenseOutcome(defender, spell, defResult, opts = {}) {
  const config = normalizeSpellConfig(spell);
  const consequences = config.consequences;
  const suppressChat = opts.suppressChat ?? false;

  if (defResult.success) {
    // ── Save succeeded ────────────────────────────────────────
    const action = _str(defResult.onSuccess) || "negate";
    _debug("Save succeeded, action:", action);

    if (action === "negate") {
      // Full negate — no consequences applied
      await _postOutcomeChat(defender, spell, defResult, {
        outcome: "success",
        text: `${defender.name} resists ${spell.name}! (${defResult.characteristicLabel} save succeeded)`,
        consequenceReport: null
      }, { suppressChat });
      return { resisted: true, halved: false, consequenceReport: null };
    }

    if (action === "halve") {
      // Half consequences
      const report = await applyConsequences(defender, consequences, {
        source: spell.name,
        origin: spell.uuid,
        halveFactor: 0.5
      });
      await _postOutcomeChat(defender, spell, defResult, {
        outcome: "partial",
        text: `${defender.name} partially resists ${spell.name} (halved consequences)`,
        consequenceReport: report
      }, { suppressChat });
      return { resisted: false, halved: true, consequenceReport: report };
    }

    // endEffect — negate and remove existing effects
    await _postOutcomeChat(defender, spell, defResult, {
      outcome: "endEffect",
      text: `${defender.name} shakes off ${spell.name}!`,
      consequenceReport: null
    }, { suppressChat });
    return { resisted: true, halved: false, consequenceReport: null };
  }

  // ── Save failed ───────────────────────────────────────────
  const failAction = _str(defResult.onFailure) || "consequences";
  _debug("Save failed, action:", failAction);

  if (failAction === "damage") {
    // Damage is handled by the normal spell damage pipeline (return flag)
    await _postOutcomeChat(defender, spell, defResult, {
      outcome: "failure",
      text: `${defender.name} fails to resist ${spell.name} — spell takes full effect!`,
      consequenceReport: null
    }, { suppressChat });
    return { resisted: false, halved: false, consequenceReport: null, applyDamage: true };
  }

  // Default: apply consequences
  const report = await applyConsequences(defender, consequences, {
    source: spell.name,
    origin: spell.uuid,
    halveFactor: 1
  });
  await _postOutcomeChat(defender, spell, defResult, {
    outcome: "failure",
    text: `${defender.name} fails the ${defResult.characteristicLabel} save!`,
    consequenceReport: report
  }, { suppressChat });
  return { resisted: false, halved: false, consequenceReport: report };
}

/**
 * Post the characteristic defense outcome to chat.
 * Suppressed when called from opposed workflow (outcome displayed in opposed card).
 * @private
 */
async function _postOutcomeChat(defender, spell, defResult, info, opts = {}) {
  // Suppress chat posting if called from opposed workflow
  if (opts.suppressChat) return;

  const parts = [];
  parts.push(`<div class="uesrpg-char-defense-outcome">`);
  parts.push(`<p><strong>${info.text}</strong></p>`);

  if (info.consequenceReport?.applied) {
    parts.push(formatConsequenceReport(info.consequenceReport, "Consequences:"));
  }

  parts.push(`</div>`);

  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: defender }),
      content: parts.join(""),
      flags: { "uesrpg-3ev4": { characteristicDefense: true } },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (err) {
    console.warn("UESRPG | CharDefense | Failed to post outcome chat", err);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Consequence Engine (merged from consequence-engine.js)
 * ═══════════════════════════════════════════════════════════════════════════ */

const _ceDebug = createDebugLogger("debugMagicRouting", "[UESRPG][ConsequenceEngine]");

/**
 * @typedef {object} ConsequencePayload
 * @property {number} [staminaDelta=0]   - Change to current stamina (negative = drain)
 * @property {number} [healthDelta=0]    - Change to current HP (negative = damage)
 * @property {number} [magickaDelta=0]   - Change to current magicka (negative = drain)
 * @property {string} [applyCondition]   - Condition key to apply (e.g. "dazed", "stunned")
 * @property {string} [description]      - Flavour description for chat output
 */

/**
 * @typedef {object} ConsequenceReport
 * @property {boolean} applied           - Whether any consequence was actually applied
 * @property {string[]} lines            - Human-readable summary lines for chat display
 * @property {object} deltas             - Actual numeric changes applied { stamina, health, magicka }
 * @property {string|null} conditionName - Name of condition applied, or null
 */

/**
 * Apply a consequence payload to the target actor.
 *
 * @param {Actor} actor - Target actor
 * @param {ConsequencePayload} consequences - Consequence data
 * @param {object} [opts={}]
 * @param {string} [opts.source]          - Source label (spell name, etc.)
 * @param {string} [opts.origin]          - Origin uuid for condition AE
 * @param {number} [opts.halveFactor=1]   - Multiply numeric deltas (0.5 for halve)
 * @returns {Promise<ConsequenceReport>}
 */
export async function applyConsequences(actor, consequences, opts = {}) {
  if (!actor) {
    return { applied: false, lines: [], deltas: { stamina: 0, health: 0, magicka: 0 }, conditionName: null };
  }

  const factor = _num(opts.halveFactor, 1);
  const source = _str(opts.source) || "Spell";
  const origin = _str(opts.origin) || null;

  const rawSP = _num(consequences?.staminaDelta, 0);
  const rawHP = _num(consequences?.healthDelta, 0);
  const rawMP = _num(consequences?.magickaDelta, 0);
  const conditionKey = _str(consequences?.applyCondition);

  // Apply factor (for halve on success)
  const spDelta = factor !== 1 ? Math.ceil(rawSP * factor) : rawSP;
  const hpDelta = factor !== 1 ? Math.ceil(rawHP * factor) : rawHP;
  const mpDelta = factor !== 1 ? Math.ceil(rawMP * factor) : rawMP;

  const lines = [];
  const deltas = { stamina: 0, health: 0, magicka: 0 };
  let conditionName = null;
  let applied = false;

  // ── Stamina delta ───────────────────────────────────────────
  if (spDelta !== 0) {
    const currentSP = _num(actor.system?.stamina?.value, 0);
    const maxSP = _num(actor.system?.stamina?.max, currentSP);
    const newSP = Math.max(0, Math.min(maxSP, currentSP + spDelta));
    const actualDelta = newSP - currentSP;

    if (actualDelta !== 0) {
      const result = await requestUpdateDocument(actor, { "system.stamina.value": newSP });
      if (result !== null) {
        deltas.stamina = actualDelta;
        applied = true;
        const verb = actualDelta < 0 ? "loses" : "gains";
        lines.push(`${actor.name} ${verb} ${Math.abs(actualDelta)} SP`);
        _ceDebug(`Stamina: ${currentSP} → ${newSP} (delta: ${actualDelta})`);
      }
    }
  }

  // ── Health delta ────────────────────────────────────────────
  if (hpDelta !== 0) {
    const currentHP = _num(actor.system?.hp?.value, 0);
    const maxHP = _num(actor.system?.hp?.max, currentHP);
    const newHP = Math.max(0, Math.min(maxHP, currentHP + hpDelta));
    const actualDelta = newHP - currentHP;

    if (actualDelta !== 0) {
      const result = await requestUpdateDocument(actor, { "system.hp.value": newHP });
      if (result !== null) {
        deltas.health = actualDelta;
        applied = true;
        const verb = actualDelta < 0 ? "loses" : "gains";
        lines.push(`${actor.name} ${verb} ${Math.abs(actualDelta)} HP`);
        _ceDebug(`HP: ${currentHP} → ${newHP} (delta: ${actualDelta})`);
      }
    }
  }

  // ── Magicka delta ───────────────────────────────────────────
  if (mpDelta !== 0) {
    const currentMP = _num(actor.system?.magicka?.value, 0);
    const maxMP = _num(actor.system?.magicka?.max, currentMP);
    const newMP = Math.max(0, Math.min(maxMP, currentMP + mpDelta));
    const actualDelta = newMP - currentMP;

    if (actualDelta !== 0) {
      const result = await requestUpdateDocument(actor, { "system.magicka.value": newMP });
      if (result !== null) {
        deltas.magicka = actualDelta;
        applied = true;
        const verb = actualDelta < 0 ? "loses" : "gains";
        lines.push(`${actor.name} ${verb} ${Math.abs(actualDelta)} MP`);
        _ceDebug(`Magicka: ${currentMP} → ${newMP} (delta: ${actualDelta})`);
      }
    }
  }

  // ── Condition application ───────────────────────────────────
  if (conditionKey) {
    try {
      const ae = await applyCondition(actor, conditionKey, { origin, source });
      if (ae) {
        conditionName = ae.name ?? conditionKey;
        applied = true;
        lines.push(`${actor.name} gains condition: ${conditionName}`);
        _ceDebug(`Condition applied: ${conditionKey}`);
      }
    } catch (err) {
      console.warn("UESRPG | ConsequenceEngine | Failed to apply condition:", conditionKey, err);
      lines.push(`Failed to apply ${conditionKey} to ${actor.name}`);
    }
  }

  // ── Description note ────────────────────────────────────────
  const desc = _str(consequences?.description);
  if (desc) {
    lines.push(desc);
  }

  return { applied, lines, deltas, conditionName };
}

/**
 * Format a consequence report as HTML for chat messages.
 *
 * @param {ConsequenceReport} report
 * @param {string} [heading] - Optional heading
 * @returns {string} HTML string
 */
export function formatConsequenceReport(report, heading) {
  if (!report?.applied && !(report?.lines?.length)) return "";

  const parts = [];
  if (heading) parts.push(`<p><strong>${heading}</strong></p>`);
  if (report.lines?.length) {
    parts.push("<ul>");
    for (const line of report.lines) {
      parts.push(`<li>${line}</li>`);
    }
    parts.push("</ul>");
  }
  return parts.join("");
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Initialization
 * ═══════════════════════════════════════════════════════════════════════════ */

let _initialized = false;

/**
 * Initialize the characteristic defense service.
 * Previously registered a `uesrpg.spell.spellHitTarget` hook, but the
 * characteristic defense is now integrated directly into outcome-resolution.js
 * (resolveWithCharacteristicDefense) so the save happens BEFORE damage/effects
 * are applied, not as a post-hit supplement.
 *
 * This function is kept as a no-op for safe initialization ordering.
 */
export function initializeCharacteristicDefenseService() {
  if (_initialized) return;
  _initialized = true;
  _debug("Characteristic defense service initialized (outcome-resolution integration)");
}
