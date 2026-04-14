/**
 * @module magic/damage-application
 *
 * src/core/magic/damage-application.js
 *
 * Magic damage/healing application wrappers which delegate to the unified combat
 * damage/healing pipeline for full parity.
 *
 * Target: Foundry VTT v13.351
 */

import { applyDamage, applyHealing, DAMAGE_TYPES, getDamageReduction } from "../combat/damage-automation.js";
import { doesUserOwnActor, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { getActorTraitValue } from "../traits/trait-registry.js";
import { evaluateAEModifierKeys } from "../active-effects/modifier-evaluator.js";
import { _str, createDebugLogger } from "./_primitives.js";
import { _bool } from "../../utils/coerce.js";
import { isShieldItem } from "../items/shield-utils.js";
import { getResolvedArmorValues } from "../combat/armor-state.js";

const _spellDebug = createDebugLogger("spellCastingDebug");

function _maxTraitValue(actor, key) {
  return Math.max(0, Number(getActorTraitValue(actor, key, { mode: "max" })) || 0);
}

function _maxEffectFlagNumber(actor, { flagPath } = {}) {
  if (!actor) return 0;
  const path = String(flagPath ?? "").trim();
  if (!path) return 0;
  let max = 0;

  for (const ef of (actor.effects ?? [])) {
    if (!ef || ef.disabled) continue;
    const v = foundry?.utils?.getProperty ? foundry.utils.getProperty(ef, path) : null;
    const n = Number(v);
    if (Number.isFinite(n) && n > max) max = n;
  }

  return max;
}

function _getWhisperRecipients(actor) {
  const out = new Set();
  const users = game.users?.contents ?? [];
  for (const user of users) {
    if (!user) continue;
    if (user.isGM) {
      out.add(user.id);
      continue;
    }
    if (doesUserOwnActor(user, actor)) out.add(user.id);
  }
  return Array.from(out);
}

function _normalizeHitLocationKey(hitLocation = "Body") {
  const locationMap = {
    Head: "Head",
    Body: "Body",
    "Right Arm": "RightArm",
    "Left Arm": "LeftArm",
    "Right Leg": "RightLeg",
    "Left Leg": "LeftLeg",
    RightArm: "RightArm",
    LeftArm: "LeftArm",
    RightLeg: "RightLeg",
    LeftLeg: "LeftLeg",
  };
  return locationMap[hitLocation] ?? hitLocation;
}

function _listMagicArmorSources(actor, hitLocation, damageType) {
  const targetType = _str(damageType).toLowerCase();
  const locationKey = _normalizeHitLocationKey(hitLocation);
  const items = actor?.items?.filter((item) => (item?.type === "armor" || item?.type === "shield") && item?.system?.equipped === true) ?? [];
  const out = [];
  for (const item of items) {
    if (isShieldItem(item, { allowLegacy: true })) continue;
    if (item?.system?.hitLocations?.[locationKey] !== true) continue;
    const resolved = getResolvedArmorValues(item.system ?? {}, { isProneForArmor: false });
    let ar = 0;
    if (targetType === DAMAGE_TYPES.MAGIC) ar = Number(resolved?.magic_ar ?? 0) || 0;
    else if (_str(resolved?.special_ar_type).toLowerCase() === targetType) ar = Number(resolved?.special_ar ?? 0) || 0;
    if (ar <= 0) continue;
    out.push({ name: String(item.name ?? "Armor"), ar });
  }
  return out;
}

function _splitMagicBreakdownLines(lines = []) {
  const sourceNotes = [];
  const reductionNotes = [];
  for (const rawLine of lines) {
    const line = String(rawLine ?? "").trim();
    if (!line) continue;
    if (/(^|\s)(AR:|Magic AR:|[A-Za-z]+ AR:|Resistance:|Magic Resistance:|Natural Toughness:|R \(base\):|T \(base)/i.test(line)) {
      reductionNotes.push(line);
      continue;
    }
    sourceNotes.push(line);
  }
  return { sourceNotes, reductionNotes };
}

function _buildMagicGmDamageReport({
  targetActor,
  source,
  hitLocation,
  damageType,
  rawDamage,
  totalApplied,
  result,
  sourceNotes = [],
  reductionNotes = [],
  reductionTotal = 0,
} = {}) {
  const hpDelta = Math.max(0, (Number(result?.oldHP ?? 0) || 0) - (Number(result?.newHP ?? 0) || 0));
  return {
    panelKey: `gm-damage:${String(targetActor?.uuid ?? targetActor?.id ?? "target")}:${Date.now()}`,
    title: String(targetActor?.name ?? "Target"),
    source: String(source ?? "Spell"),
    hitLocation: String(hitLocation ?? "Body"),
    totalDamage: Math.max(0, Number(totalApplied ?? 0) || 0),
    hp: {
      value: Number(result?.newHP ?? 0) || 0,
      max: Number(targetActor?.system?.hp?.max ?? 0) || 0,
      delta: hpDelta
    },
    tempHp: ((Number(result?.tempHPAbsorbed ?? 0) || 0) > 0 || (Number(result?.oldTempHP ?? 0) || 0) > 0)
      ? {
          value: Number(result?.newTempHP ?? 0) || 0,
          absorbed: Number(result?.tempHPAbsorbed ?? 0) || 0
        }
      : null,
    buffers: [],
    traitNotes: [],
    woundTriggered: String(result?.woundStatus ?? "") === "wounded",
    woundThreshold: 0,
    defeated: Number(result?.newHP ?? 0) === 0,
    segments: [
      {
        damageType: String(damageType ?? DAMAGE_TYPES.MAGIC),
        rawDamage: Math.max(0, Number(rawDamage ?? 0) || 0),
        reductionTotal: Math.max(0, Number(reductionTotal ?? 0) || 0),
        applied: Math.max(0, Number(totalApplied ?? 0) || 0),
        sourceNotes: [String(source ?? "Spell"), ...sourceNotes].filter(Boolean),
        reductionNotes: reductionNotes.filter(Boolean),
      }
    ]
  };
}

async function _applySpellAbsorption(targetActor, { casterActor = null, magicCost = 0, allowSelfAbsorption = false, sourceLabel = "Spell" } = {}) {
  if (!targetActor) return { absorbed: false, restored: 0, rollTotal: null, threshold: null };

  // Three independent threshold sources (take the highest):
  //   1. Trait-based spellAbsorption (racial / innate)
  //   2. AE flag path (legacy: activated talents like Dragonskin)
  //   3. AE modifier lane (system.modifiers.magic.spellAbsorption) — set by
  //      Spell Absorption spell's tracker AE via changes[]
  const traitVal  = _maxTraitValue(targetActor, "spellAbsorption");
  const flagVal   = _maxEffectFlagNumber(targetActor, { flagPath: "flags.uesrpg.spellAbsorption" });
  const aeResult  = evaluateAEModifierKeys(targetActor, ["system.modifiers.magic.spellAbsorption"]);
  const modLane   = Number(aeResult["system.modifiers.magic.spellAbsorption"] ?? 0) || 0;
  const threshold = Math.max(traitVal, flagVal, modLane);

  if (threshold <= 0) return { absorbed: false, restored: 0, rollTotal: null, threshold: null };

  if (casterActor && targetActor && casterActor.uuid === targetActor.uuid && !allowSelfAbsorption) {
    return { absorbed: false, restored: 0, rollTotal: null, threshold };
  }

  const roll = new Roll("1d10");
  await roll.evaluate();
  const rollTotal = Number(roll.total ?? 0) || 0;
  const absorbed = rollTotal <= threshold;
  let restored = 0;

  if (absorbed) {
    const currentMP = Number(targetActor.system?.magicka?.value ?? 0);
    const maxMP = Number(targetActor.system?.magicka?.max ?? 0);
    const missingMP = Math.max(0, maxMP - currentMP);
    const restoreCap = Math.max(0, Number(magicCost ?? 0));
    restored = Math.min(missingMP, restoreCap);

    if (restored > 0) {
      await requestUpdateDocument(targetActor, { "system.magicka.value": currentMP + restored });
    }
  }

  try {
    const content = `
      <div class="uesrpg-spell-absorption">
        <h3>Spell Absorption (${threshold})</h3>
        <div><b>Source:</b> ${sourceLabel}</div>
        <div><b>Roll:</b> ${rollTotal}</div>
        <div><b>Outcome:</b> ${absorbed ? "Absorbed (no effect)" : "Failed"}</div>
        ${absorbed && restored > 0 ? `<div><b>MP Restored:</b> +${restored}</div>` : ""}
      </div>
    `;
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      content,
      whisper: _getWhisperRecipients(targetActor),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (_e) {
    // Non-blocking
  }

  return { absorbed, restored, rollTotal, threshold };
}

/**
 * Apply magic damage with combat-parity mitigation breakdown.
 * 
 * RAW (Chapter 6): Magic damage is layered - it has both Magic as base damage type AND 
 * a specific elemental/typed damage. Resistances are applied in order:
 * 1. Elemental/typed resistance (fire, frost, shock, etc.) - applied first
 * 2. Magic resistance - applied second
 *
 * @param {Actor} targetActor
 * @param {number} damage
 * @param {string} damageType
 * @param {Item} spell
 * @param {object} options
 * @param {boolean} options.isCritical
 * @param {string} options.hitLocation
 * @param {string} options.rollHTML
 * @param {boolean} options.isOverloaded
 * @param {number} options.overloadBonus
 * @param {boolean} options.isOvercharged
 * @param {number[]} options.overchargeTotals
 * @param {number} options.elementalBonus
 * @param {string} options.elementalBonusLabel
 */
export async function applyMagicDamage(targetActor, damage, damageType, spell, options = {}) {
  if (!targetActor) return null;

  const dt = _str(damageType).toLowerCase() || DAMAGE_TYPES.MAGIC;
  const rollHTML = _str(options.rollHTML);
  const hitLocation = options.hitLocation ?? "Body";
  const source = _str(options.source ?? spell?.name ?? "Spell");
  const casterActor = options.casterActor ?? null;
  const magicCost = Number(options.magicCost ?? 0) || 0;
  const allowSelfAbsorption = options.allowSelfAbsorption === true;
  const skipChatMessage = options.skipChatMessage === true;

  const absorption = await _applySpellAbsorption(targetActor, {
    casterActor,
    magicCost,
    allowSelfAbsorption,
    sourceLabel: source
  });
  if (absorption.absorbed) {
    return { spellAbsorbed: true, absorption };
  }

  let adjustedDamage = Number(damage || 0) || 0;
  const extraBreakdownLines = [];
  const woundThresholdDelta = 0;
  if (_bool(options.isOverloaded) && Number(options.overloadBonus || 0) > 0) {
    extraBreakdownLines.push(`Overload Bonus: +${Number(options.overloadBonus || 0)}`);
  }
  if (Number(options.elementalBonus || 0) > 0) {
    extraBreakdownLines.push(`${_str(options.elementalBonusLabel || "Elemental Talent")}: +${Number(options.elementalBonus || 0)}`);
  }
  if (_bool(options.isOvercharged) && Array.isArray(options.overchargeTotals) && options.overchargeTotals.length === 2) {
    const a = Number(options.overchargeTotals[0] ?? 0) || 0;
    const b = Number(options.overchargeTotals[1] ?? 0) || 0;
    extraBreakdownLines.push(`Master of Magicka: rolled twice (kept ${Math.max(a, b)} of ${a} / ${b})`);
  }

  // RAW: Spell damage is layered (Magic base + elemental type).
  // Calculate damage with layered mitigation: elemental first, then magic.
  // This implementation ensures that ALL spell damage is treated as magical damage
  // in addition to any specific elemental type (fire, frost, shock, etc.).
  // For example, a Fire spell applies both Fire AR/resistance AND Magic AR/resistance.
  const isElementalSpell = (dt !== DAMAGE_TYPES.MAGIC && dt !== DAMAGE_TYPES.PHYSICAL && dt !== DAMAGE_TYPES.HEALING && dt !== "none");
  
  // For magic wound effects, track damage by type
  // This enables proper wound side effects (Fire -> Burning, Shock -> Magicka loss, etc.)
  const damageAppliedByType = {};
  if (dt && dt !== "none" && dt !== DAMAGE_TYPES.PHYSICAL) {
    damageAppliedByType[dt] = Number(damage || 0);
  }
  
  if (isElementalSpell) {
    // Step 1: Get elemental mitigation (typed AR + resistance)
    const elementalReduction = getDamageReduction(targetActor, dt, hitLocation);
    const elementalAR = Number(elementalReduction.armor || 0);
    const elementalRes = Number(elementalReduction.resistance || 0);
    const elementalMitigation = elementalAR + elementalRes;
    
    // Step 2: Get magic mitigation (Magic AR + magic resistance)
    const magicReduction = getDamageReduction(targetActor, DAMAGE_TYPES.MAGIC, hitLocation);
    const magicAR = Number(magicReduction.armor || 0);
    const magicRes = Number(magicReduction.resistance || 0);
    const magicMitigation = magicAR + magicRes;
    
    // Step 3: Natural Toughness (counted once; applies to all damage)
    const toughness = Number(elementalReduction.toughness || 0);
    
    // Step 4: Apply layered mitigation
    // Apply elemental mitigation first (RAW: "Weakness is applied first")
    const afterElemental = adjustedDamage - elementalMitigation;
    // Then apply magic mitigation
    const afterMagic = afterElemental - magicMitigation;
    // Finally apply Natural Toughness (once)
    const finalDamage = afterMagic - toughness;
    
    // Add mitigation breakdown to chat
    const dtLabel = dt.charAt(0).toUpperCase() + dt.slice(1);
    if (elementalAR !== 0) {
      extraBreakdownLines.push(`${dtLabel} AR: -${elementalAR}`);
    }
    if (elementalRes !== 0) {
      const sign = elementalRes >= 0 ? "-" : "+";
      const absValue = Math.abs(elementalRes);
      extraBreakdownLines.push(`${dtLabel} Resistance: ${sign}${absValue}`);
    }
    if (magicAR !== 0) {
      extraBreakdownLines.push(`Magic AR: -${magicAR}`);
    }
    if (magicRes !== 0) {
      const sign = magicRes >= 0 ? "-" : "+";
      const absValue = Math.abs(magicRes);
      extraBreakdownLines.push(`Magic Resistance: ${sign}${absValue}`);
    }
    if (toughness !== 0) {
      extraBreakdownLines.push(`Natural Toughness: -${toughness}`);
    }
    
    // Apply the layered damage with ignoreReduction=true since we calculated it manually
    const result = await applyDamage(targetActor, Math.max(0, finalDamage), dt, {
      source,
      hitLocation,
      rollHTML,
      ignoreReduction: true,
      magicSource: true,
      skipChatMessage,
      extraBreakdownLines,
      woundThresholdDelta,
      damageAppliedByType,
    });
    if (!result) return result;
    const split = _splitMagicBreakdownLines(extraBreakdownLines);
    const reductionNotes = [];
    const elementalArmorSources = _listMagicArmorSources(targetActor, hitLocation, dt);
    const magicArmorSources = _listMagicArmorSources(targetActor, hitLocation, DAMAGE_TYPES.MAGIC);
    if (elementalArmorSources.length) {
      reductionNotes.push(`${dtLabel} AR: ${elementalArmorSources.map((entry) => `${entry.name} (${entry.ar})`).join(", ")}`);
    }
    if (elementalRes !== 0) {
      reductionNotes.push(`${dtLabel} Resistance: ${elementalRes >= 0 ? "-" : "+"}${Math.abs(elementalRes)}`);
    }
    if (magicArmorSources.length) {
      reductionNotes.push(`Magic AR: ${magicArmorSources.map((entry) => `${entry.name} (${entry.ar})`).join(", ")}`);
    }
    if (magicRes !== 0) {
      reductionNotes.push(`Magic Resistance: ${magicRes >= 0 ? "-" : "+"}${Math.abs(magicRes)}`);
    }
    if (toughness !== 0) {
      reductionNotes.push(`Natural Toughness: -${toughness}`);
    }
    result.gmDamageReport = _buildMagicGmDamageReport({
      targetActor,
      source,
      hitLocation,
      damageType: dt,
      rawDamage: adjustedDamage,
      totalApplied: result.damage,
      result,
      sourceNotes: split.sourceNotes,
      reductionNotes: reductionNotes.length ? reductionNotes : split.reductionNotes,
      reductionTotal: elementalMitigation + magicMitigation + toughness,
    });
    return result;
  }
  
  // Non-elemental spells (pure magic, physical, etc.) use normal damage pipeline
  const result = await applyDamage(targetActor, adjustedDamage, dt, {
    source,
    hitLocation,
    rollHTML,
    magicSource: true,
    skipChatMessage,
    extraBreakdownLines,
    woundThresholdDelta,
    damageAppliedByType: dt && dt !== "none" && dt !== DAMAGE_TYPES.PHYSICAL ? damageAppliedByType : null,
  });
  if (!result) return result;
  const split = _splitMagicBreakdownLines(extraBreakdownLines);
  const reductionNotes = [...split.reductionNotes];
  const armorValue = Number(result?.reductions?.armor ?? 0) || 0;
  const resistanceValue = Number(result?.reductions?.resistance ?? 0) || 0;
  const toughnessValue = Number(result?.reductions?.toughness ?? 0) || 0;
  if (armorValue > 0) {
    const armorSources = _listMagicArmorSources(targetActor, hitLocation, dt);
    reductionNotes.push(armorSources.length
      ? `AR: ${armorSources.map((entry) => `${entry.name} (${entry.ar})`).join(", ")}`
      : `AR: ${armorValue}`);
  }
  if (resistanceValue > 0 && dt !== DAMAGE_TYPES.PHYSICAL) {
    reductionNotes.push(`R (base): ${resistanceValue}`);
  }
  if (toughnessValue > 0) {
    reductionNotes.push(`T (base natToughness): ${toughnessValue}`);
  }
  result.gmDamageReport = _buildMagicGmDamageReport({
    targetActor,
    source,
    hitLocation,
    damageType: dt,
    rawDamage: adjustedDamage,
    totalApplied: result.damage,
    result,
    sourceNotes: split.sourceNotes,
    reductionNotes,
    reductionTotal: Number(result?.reductions?.total ?? 0) || 0,
  });
  return result;
}

/**
 * Apply magic healing using the unified healing pipeline.
 *
 * @param {Actor} targetActor
 * @param {number} healing
 * @param {Item} spell
 * @param {object} options
 * @param {boolean} options.isTemporary - If true, grants temp HP instead of restoring HP
 */
export async function applyMagicHealing(targetActor, healing, spell, options = {}) {
  _spellDebug("UESRPG | applyMagicHealing CALLED", {
    targetActor: targetActor?.name,
    healing,
    spellName: spell?.name,
    isTemporary: options.isTemporary
  });

  if (!targetActor) {
    console.error("UESRPG | applyMagicHealing: No target actor");
    return null;
  }

  const source = _str(options.source ?? spell?.name ?? "Spell");
  const rollHTML = _str(options.rollHTML);
  const casterActor = options.casterActor ?? null;
  const magicCost = Number(options.magicCost ?? 0) || 0;
  const allowSelfAbsorption = options.allowSelfAbsorption === true;

  const absorption = await _applySpellAbsorption(targetActor, {
    casterActor,
    magicCost,
    allowSelfAbsorption,
    sourceLabel: source
  });
  if (absorption.absorbed) {
    return { spellAbsorbed: true, absorption };
  }
  
  _spellDebug("UESRPG | applyMagicHealing: Calling applyHealing", {
    targetActor: targetActor.name,
    healing: Number(healing || 0),
    source,
    isTemporary: options.isTemporary === true
  });

  return applyHealing(targetActor, Number(healing || 0), {
    source,
    rollHTML,
    isTemporary: options.isTemporary === true,
    // Per user requirement: omit current/max HP line to reduce metagame information.
    hideHpLine: true,
    // Skip chat message since healing is already shown in the magic opposed card
    skipChatMessage: true,
  });
}
