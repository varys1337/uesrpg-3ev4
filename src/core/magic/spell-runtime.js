/**
 * @module spell-runtime
 * src/core/magic/spell-runtime.js
 *
 * Consolidated spell runtime services: hooks, routing, reflect, zone management.
 *
 * Merges:
 *  - spell-hooks.js        → emitPreCast, emitCastResolved, emitEffectApplied
 *  - spell-routing.js      → classifySpellForRouting, getUserSpellTargets, shouldUseTargetedSpellWorkflow, shouldUseModernSpellWorkflow, debugMagicRoutingLog
 *  - spell-reflect.js      → getSpellReflectThreshold, trySpellReflect
 *  - spell-zone-service.js → linkTemplateToOriginAE, getTokensInTemplate, getActiveSpellZones
 *
 * None of these modules carry side-effect initialization; they are pure utility/service exports.
 *
 * Target: Foundry VTT v13.351
 */

import { evaluateAEModifierKeys } from "../active-effects/modifier-evaluator.js";
import { registerLinkedEntity, getOriginAEs } from "./effects/origin-effect.js";
import { _str, createDebugLogger, isDebugEnabled } from "./_primitives.js";
import { _bool } from "../../utils/coerce.js";

// ── Shared Private Helpers ───────────────────────────────────────────────────

/** @private Debug log for magic routing (gated by setting). */
const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][SpellReflect]");

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Spell Lifecycle Hooks (from spell-hooks.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Emit the preCast hook. Returns false if any listener cancelled the cast.
 *
 * @param {object} payload
 * @param {Actor} payload.caster - The casting actor
 * @param {Item} payload.spell - The spell being cast
 * @param {object} payload.profile - Resolved spell profile
 * @param {object} payload.spellOptions - Spell options (restrain, overload, etc.)
 * @param {string[]} payload.targetUuids - Target UUIDs
 * @returns {boolean} false if cancelled
 */
export function emitPreCast(payload) {
  try {
    return Hooks.call("uesrpg.spell.preCast", {
      caster: payload.caster,
      spell: payload.spell,
      profile: payload.profile,
      spellOptions: payload.spellOptions,
      targetUuids: payload.targetUuids ?? []
    });
  } catch (err) {
    console.error("UESRPG | spell-hooks | preCast hook error", err);
    return true; // Don't block casting on hook errors
  }
}

/**
 * Emit the castResolved hook.
 *
 * @param {object} payload
 * @param {Actor} payload.caster - The casting actor
 * @param {Item} payload.spell - The spell that was cast
 * @param {object} payload.result - Roll result (from degree-roll-helper)
 * @param {boolean} payload.success - Whether the cast succeeded
 * @param {boolean} payload.backfired - Whether backfire was triggered
 * @param {number} payload.mpSpent - MP actually spent (after refund)
 * @param {object} payload.spellOptions - Options used
 * @param {string} [payload.messageId] - Chat message ID
 */
export function emitCastResolved(payload) {
  try {
    Hooks.callAll("uesrpg.spell.castResolved", {
      caster: payload.caster,
      spell: payload.spell,
      result: payload.result,
      success: payload.success,
      backfired: payload.backfired ?? false,
      mpSpent: payload.mpSpent ?? 0,
      spellOptions: payload.spellOptions ?? {},
      messageId: payload.messageId ?? null
    });
  } catch (err) {
    console.error("UESRPG | spell-hooks | castResolved hook error", err);
  }
}

/**
 * Emit the effectApplied hook.
 *
 * @param {object} payload
 * @param {Actor} payload.caster - The casting actor
 * @param {Actor} payload.target - The target actor
 * @param {Item} payload.spell - The spell
 * @param {ActiveEffect[]} payload.effects - The AEs created on the target
 * @param {ActiveEffect} [payload.originEffect] - The Origin AE on the caster (if any)
 */
export function emitEffectApplied(payload) {
  try {
    Hooks.callAll("uesrpg.spell.effectApplied", {
      caster: payload.caster,
      target: payload.target,
      spell: payload.spell,
      effects: payload.effects ?? [],
      originEffect: payload.originEffect ?? null
    });
  } catch (err) {
    console.error("UESRPG | spell-hooks | effectApplied hook error", err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Spell Routing (from spell-routing.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classify a spell for routing purposes.
 * @param {Item} spell
 * @returns {{isAttack: boolean, isHealing: boolean, isDirect: boolean, isCharacteristicDefense: boolean, isTargeted: boolean, damageType: string}}
 */
export function classifySpellForRouting(spell) {
  const isAttack = (spell?.system?.isAttackSpell === true) || (_str(spell?.system?.isAttackSpell).toLowerCase() === "true");
  const damageType = _str(spell?.system?.damageType).toLowerCase();
  // Check both the isHealingSpell toggle AND the damageType for backwards compatibility
  // Include temporary healing as healing type
  const isHealing = _bool(spell?.system?.isHealingSpell) ||
                    (damageType === "healing") ||
                    (damageType === "temporaryhealing") ||
                    (damageType === "temporary healing");
  const isDirect = _bool(spell?.system?.isDirect);
  // Characteristic defense spells need targeted workflow to create chat cards
  const defenseModel = _str(spell?.system?.engine?.defenseModel).toLowerCase();
  const isCharacteristicDefense = (defenseModel === "characteristic");
  const isTargeted = isAttack || isHealing || isDirect || isCharacteristicDefense;
  return { isAttack, isHealing, isDirect, isCharacteristicDefense, isTargeted, damageType };
}

/**
 * Get current user targets in a stable array.
 * @returns {Token[]}
 */
export function getUserSpellTargets() {
  try {
    return Array.from(game.user?.targets ?? []);
  } catch (_e) {
    return [];
  }
}

/**
 * Determine whether this cast should route into the targeted MagicOpposedWorkflow.
 * @param {Item} spell
 * @param {Token[]} targets
 * @returns {boolean}
 */
export function shouldUseTargetedSpellWorkflow(spell, targets) {
  const cls = classifySpellForRouting(spell);
  return cls.isTargeted && Array.isArray(targets) && targets.length > 0;
}

/**
 * Determine whether this spell should use the modern casting engine even when untargeted.
 * All spells now use the modern pipeline for consistent Magicka handling and spell options.
 * @param {Item} spell
 * @returns {boolean}
 */
export function shouldUseModernSpellWorkflow(spell) {
  // All spells use the modern rolling pipeline
  return true;
}

/**
 * Optional debug logging for routing decisions.
 * @param {object} params
 * @param {string} params.source
 * @param {Actor} params.actor
 * @param {Item} params.spell
 * @param {Token[]} params.targets
 */
export function debugMagicRoutingLog({ source, actor, spell, targets }) {
  if (!isDebugEnabled("debugMagicRouting")) return;
  const cls = classifySpellForRouting(spell);
  const t = Array.isArray(targets) ? targets.map(tt => tt?.document?.uuid ?? tt?.uuid ?? "?") : [];
  console.debug(`[UESRPG][MagicRouting] ${source}`, {
    actor: actor?.uuid ?? actor?.id,
    spell: spell?.uuid ?? spell?.id,
    classification: cls,
    targets: t
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Spell Reflect (from spell-reflect.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Read the Spell Reflect threshold from an actor.
 *
 * Sources:
 * - AE modifier key: `system.modifiers.magic.spellReflect` (numeric, ADD semantics)
 * - Direct data path: `actor.system.modifiers.magic.spellReflect`
 *
 * @param {Actor} actor
 * @returns {number} The highest spell level that can be reflected (0 = no reflect)
 */
export function getSpellReflectThreshold(actor) {
  if (!actor) return 0;

  // AE-based spellReflect value (aggregated from all active effects)
  const aeResult = evaluateAEModifierKeys(actor, ["system.modifiers.magic.spellReflect"]);
  const aeValue = Number(aeResult["system.modifiers.magic.spellReflect"] ?? 0) || 0;

  // Direct data path fallback (for manually set values or non-AE sources)
  const dataValue = Number(actor.system?.modifiers?.magic?.spellReflect ?? 0) || 0;

  // Use whichever is higher (AE stacking or base value)
  return Math.max(aeValue, dataValue);
}

/**
 * Check if a spell would be reflected by the target's Spell Reflect.
 *
 * @param {Actor} targetActor - The spell's target
 * @param {Item} spell - The spell being cast
 * @param {Actor} casterActor - The original caster
 * @param {object} [options]
 * @param {boolean} [options.alreadyReflected=false] - If true, skip (prevent loops)
 * @returns {Promise<{reflected: boolean, behavior: string, threshold: number, spellLevel: number}>}
 */
export async function trySpellReflect(targetActor, spell, casterActor, options = {}) {
  const result = { reflected: false, behavior: "none", threshold: 0, spellLevel: 0, rollTotal: null };

  if (!targetActor || !spell) return result;

  // Prevent infinite reflect loops
  if (options.alreadyReflected) return result;

  // Don't reflect self-targeted spells
  if (casterActor && targetActor.uuid === casterActor.uuid) return result;

  const threshold = getSpellReflectThreshold(targetActor);
  result.threshold = threshold;

  if (threshold <= 0) return result;

  const spellLevel = Number(spell.system?.level ?? 0) || 0;
  result.spellLevel = spellLevel;

  // RAW: Roll 1d10 — if roll ≤ threshold, the spell is reflected.
  const roll = new Roll("1d10");
  await roll.evaluate();
  const rollTotal = Number(roll.total ?? 0) || 0;
  result.rollTotal = rollTotal;

  if (rollTotal > threshold) {
    _debug(`Spell "${spell.name}" (L${spellLevel}) — Reflect roll ${rollTotal} > threshold ${threshold}, not reflected`);

    // Post chat notification for the failed reflect attempt
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><div class="uesrpg-spell-reflect"><h3>Spell Reflect (${threshold})</h3><p><strong>${targetActor.name}</strong> attempts to reflect <strong>${spell.name}</strong>.</p><p><b>Roll:</b> ${rollTotal}</p><p><b>Outcome:</b> Failed — spell is not reflected.</p></div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { /* non-blocking */ }

    return result;
  }

  // Reflected!
  result.reflected = true;

  // Determine behavior based on spell type
  const spellName = String(spell.name ?? "").trim();
  const isAbsorbChar = spellName.startsWith("Absorb ") && spell.system?.school === "mysticism" &&
    !["Absorb Life", "Absorb Magicka"].includes(spellName);

  if (isAbsorbChar) {
    // RAW: "no net effect" when Absorb [Char] is reflected
    result.behavior = "cancel";
  } else {
    // All other spells: redirect to caster
    result.behavior = "redirect";
  }

  _debug(`Spell "${spell.name}" (L${spellLevel}) REFLECTED by ${targetActor.name} (roll ${rollTotal} ≤ threshold ${threshold}), behavior=${result.behavior}`);

  // Post chat notification
  try {
    const behaviorText = result.behavior === "cancel"
      ? `The spell has no net effect.`
      : `The spell is redirected back at ${casterActor?.name ?? "the caster"}!`;

    await ChatMessage.create({
      content: `<div class="uesrpg"><div class="uesrpg-spell-reflect"><h3>Spell Reflected!</h3><p><strong>${targetActor.name}</strong> reflects <strong>${spell.name}</strong> (Level ${spellLevel}).</p><p><b>Roll:</b> ${rollTotal}</p><p>${behaviorText}</p><p><em>Reflect threshold: ${threshold}</em></p></div></div>`,
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (_e) { /* non-blocking */ }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Spell Zone Service (from spell-zone-service.js)
// ═══════════════════════════════════════════════════════════════════════════════

const _FLAG_NS = "uesrpg-3ev4";

/**
 * Link an existing MeasuredTemplate to an Origin AE.
 *
 * @param {ActiveEffect} originAE - Origin AE on the caster
 * @param {string} templateUuid - UUID of the MeasuredTemplateDocument
 * @param {string} [label] - Human-readable label
 * @returns {Promise<boolean>} Success
 */
export async function linkTemplateToOriginAE(originAE, templateUuid, label = "") {
  if (!originAE || !templateUuid) return false;
  return registerLinkedEntity(originAE, {
    type: "template",
    uuid: templateUuid,
    label: label || "Spell Zone"
  });
}

/**
 * Get all tokens currently within a MeasuredTemplate's area.
 *
 * Uses center + corner + midpoint sampling for accuracy.
 *
 * @param {MeasuredTemplateDocument|string} templateDocOrUuid - Template document or UUID
 * @returns {Token[]} Array of Token objects within the template
 */
export function getTokensInTemplate(templateDocOrUuid) {
  try {
    const doc = typeof templateDocOrUuid === "string"
      ? fromUuidSync(templateDocOrUuid)
      : templateDocOrUuid;
    if (!doc) return [];

    const tpl = doc.object ?? doc;
    if (!tpl?.shape) return [];

    const scene = doc.parent ?? canvas?.scene;
    if (!scene) return [];

    const tokens = canvas?.tokens?.placeables ?? [];
    if (!tokens.length) return [];

    return tokens.filter(token => {
      if (!token?.document) return false;
      return _isTokenInTemplate(token, tpl);
    });
  } catch (err) {
    console.warn("UESRPG | spell-zone-service | getTokensInTemplate error", err);
    return [];
  }
}

/**
 * Get all active spell zones (Origin AEs that have linked templates).
 *
 * @param {Actor} [casterActor] - If provided, only returns zones for this caster
 * @returns {Array<{originAE: ActiveEffect, templateUuids: string[], spellName: string, casterUuid: string}>}
 */
export function getActiveSpellZones(casterActor = null) {
  const results = [];
  const actors = casterActor ? [casterActor] : (game.actors?.contents ?? []);

  for (const actor of actors) {
    const origins = getOriginAEs(actor);
    for (const origin of origins) {
      const flags = origin.flags?.[_FLAG_NS];
      if (!flags?.isOriginAE) continue;
      const linked = flags.linkedEntities ?? [];
      const tplLinks = linked.filter(l => l.type === "template");
      if (!tplLinks.length) continue;

      results.push({
        originAE: origin,
        templateUuids: tplLinks.map(l => l.uuid),
        spellName: flags.spellName ?? origin.name,
        casterUuid: flags.casterUuid ?? actor.uuid,
        spellUuid: flags.spellUuid ?? ""
      });
    }
  }

  return results;
}

// ─── Zone Internals ──────────────────────────────────────────────────────────

/**
 * Check if a token is within a template's shape.
 * Uses center point + 8-direction sampling for tokens larger than 1x1.
 * @param {Token} token
 * @param {MeasuredTemplate} tpl
 * @returns {boolean}
 * @private
 */
function _isTokenInTemplate(token, tpl) {
  const shape = tpl.shape;
  if (!shape) return false;

  // Template world position
  const tplX = tpl.document?.x ?? tpl.x ?? 0;
  const tplY = tpl.document?.y ?? tpl.y ?? 0;

  // Sample points on the token (center + corners + midpoints)
  const points = _getTokenSamplePoints(token);

  for (const pt of points) {
    // Convert to template-local coordinates
    const localX = pt.x - tplX;
    const localY = pt.y - tplY;
    if (shape.contains(localX, localY)) return true;
  }
  return false;
}

/**
 * Get sample points for a token (center + corners + edge midpoints).
 * @param {Token} token
 * @returns {Array<{x: number, y: number}>}
 * @private
 */
function _getTokenSamplePoints(token) {
  const doc = token.document ?? token;
  const x = doc.x ?? 0;
  const y = doc.y ?? 0;
  const gs = canvas?.grid?.size ?? 100;
  const w = (doc.width ?? 1) * gs;
  const h = (doc.height ?? 1) * gs;

  const cx = x + w / 2;
  const cy = y + h / 2;

  // Center point always
  const points = [{ x: cx, y: cy }];

  // For larger tokens, add corners and midpoints
  if (w > gs || h > gs) {
    points.push(
      { x: x, y: y },               // top-left
      { x: x + w, y: y },           // top-right
      { x: x, y: y + h },           // bottom-left
      { x: x + w, y: y + h },       // bottom-right
      { x: cx, y: y },              // top-mid
      { x: cx, y: y + h },          // bottom-mid
      { x: x, y: cy },              // left-mid
      { x: x + w, y: cy }           // right-mid
    );
  }

  return points;
}
