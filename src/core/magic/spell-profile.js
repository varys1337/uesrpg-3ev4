/**
 * @module magic/spell-profile
 *
 * src/core/magic/spell-profile.js
 *
 * Centralized spell profile resolution for UESRPG 3ev4.
 * Provides a single source of truth for spell metadata normalization.
 *
 * **Design Goals**:
 * - Schema-neutral: No schema changes, only read normalization
 * - Single source: All spell metadata reads route through this module
 * - Deterministic: Same inputs always produce same outputs
 * - Composable: Profile includes all data needed for casting decisions
 *
 * **Delegation Pattern**:
 * This module consolidates logic from:
 * - magicka-utils.js (cost, damage, scaling)
 * - spell-range.js (range, AoE)
 * - spell-routing.js (classification)
 * - opposed/spell-helpers.js (duration, upkeep)
 *
 * Target: Foundry VTT v13.351
 */

/**
 * Composite spell profile returned by `resolveSpellProfile()`.
 *
 * Aggregates all metadata needed for casting decisions into a single
 * deterministic snapshot. Sub-objects are documented inline.
 *
 * @typedef {object} SpellProfile
 * @property {string}  uuid  - Spell item UUID
 * @property {string}  name  - Spell name
 * @property {string}  img   - Spell icon path
 * @property {{school: string, form: string, type: string, level: number}} metadata
 * @property {{isAttack: boolean, isDamaging: boolean, isHealing: boolean, isDirect: boolean, isInstant: boolean, hasUpkeep: boolean, hasOverload: boolean, hasReinforce: boolean}} classification
 * @property {{base: number, baseRaw: number, aeModifier: number, aeBreakdown: Array, wpBonus: number, restrained: {enabled: boolean, reduction: number, appliesOnSuccess: boolean}, overload: {enabled: boolean, multiplier: number}, overcharge: {enabled: boolean}, final: number, attempt: number}} cost
 * @property {{formula: string, type: string, isHealing: boolean, overloadBonusFormula: string, criticalBehavior: string}} damage
 * @property {{value: number, unit: string, isInstant: boolean, isPermanent: boolean, isFinite: boolean}} duration
 * @property {{type: string, maxMeters: number|null, requiresTarget: boolean, requiresLineOfSight: boolean}} range
 * @property {{isAoE: boolean, shape: string|null, size: number, width: number, pulse: boolean, includeCaster: boolean, config: object|null}} aoe
 * @property {{levels: Array, currentLevel: object|null, hasScaling: boolean}} scaling
 * @property {{value: number, isEnabled: boolean}} mindlock
 * @property {object|null} engine           - Engine config (targeting, effects, persistence, etc.)
 * @property {{isTargeted: boolean, requiresDefense: boolean, appliesEffects: boolean, blocksOtherCasts: boolean}} computed
 * @property {object|null} talentModifiers  - Populated by spellcasting talent modifier stage
 */

import {
  getSpellLevel,
  getSpellCost,
  getSpellDamageFormula,
  getSpellDamageType,
  isHealingSpell as _isHealingSpell,
  getSpellScalingEntry,
  getActorWillpowerBonus
} from "./magicka-utils.js";
import {
  getSpellRangeType,
  getSpellMaxRangeMeters,
  getSpellAoEConfig
} from "./spell-range.js";
import { evaluateAEModifierKeysDetailed } from "../active-effects/modifier-evaluator.js";
import {
  applySpellcastingTalentModifiers,
  applyTalentSummaryToProfile
} from "../traits/spellcasting-talents.js";
import {
  isRuleElementRuntimeEnabled,
  evaluateRuleElementsRuntime
} from "../traits/features/rule-element-runtime.js";
import { normalizeSpellConfig } from "./spell-config.js";
import { _num, _strTrim as _str } from "./_primitives.js";
import { _bool } from "../../utils/coerce.js";

/**
 * Normalize a modifier lane key component to a safe, stable token.
 * @param {*} s
 * @returns {string}
 */
function _normalizeKey(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Collect Active Effect modifier keys for spell cost.
 * @param {Item} spell
 * @returns {string[]}
 */
function _collectSpellCostModifierKeys(spell) {
  const keySet = new Set([
    "system.modifiers.magic.cost._all"
  ]);

  const schoolKey = _normalizeKey(spell?.system?.school);
  if (schoolKey) keySet.add(`system.modifiers.magic.cost.${schoolKey}`);

  return Array.from(keySet);
}

/**
 * Evaluate Active Effect modifiers for spell cost.
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {{total: number, breakdown: Array}}
 */
function _evaluateSpellCostAEModifier(actor, spell) {
  try {
    const keys = _collectSpellCostModifierKeys(spell);
    if (!keys.length) return { total: 0, breakdown: [] };
    return evaluateAEModifierKeysDetailed(actor, keys, { labelPrefix: "Magic Cost" });
  } catch (_e) {
    return { total: 0, breakdown: [] };
  }
}

/**
 * Resolve spell duration configuration.
 * @param {Item} spell
 * @returns {{value: number, unit: string, isInstant: boolean, isPermanent: boolean, isFinite: boolean}}
 */
/**
 * Resolve spell duration profile.
 * @param {Item} spell
 * @param {object} options - { level }
 * @returns {{value: number, unit: string, isInstant: boolean, isPermanent: boolean, isFinite: boolean}}
 */
function _resolveDuration(spell, options = {}) {
  // Check scaling entry first if level is specified
  const scaling = getSpellScalingEntry(spell, options.level ?? null);
  const scaledDuration = scaling?.duration;
  
  // Use scaled duration if available and valid, otherwise use base duration
  let dur;
  if (scaledDuration && typeof scaledDuration === "object" && scaledDuration.value != null) {
    dur = scaledDuration;
  } else {
    dur = spell?.system?.duration ?? {};
  }
  
  const value = _num(dur.value, 0);
  const unit = _str(dur.unit || "rounds").toLowerCase();
  
  const isInstant = unit === "instant" || value === 0;
  const isPermanent = unit === "permanent";
  const isFinite = !isInstant && !isPermanent && ["rounds", "minutes", "hours", "days"].includes(unit);
  
  return { value, unit, isInstant, isPermanent, isFinite };
}

/**
 * Resolve spell classification flags.
 * @param {Item} spell
 * @returns {{isAttack: boolean, isDamaging: boolean, isHealing: boolean, isDirect: boolean, isInstant: boolean, hasUpkeep: boolean, hasOverload: boolean, hasReinforce: boolean}}
 */
function _resolveClassification(spell) {
  const isAttack = _bool(spell?.system?.isAttackSpell);
  const isDamaging = _bool(spell?.system?.isDamagingSpell);
  const isHealing = _isHealingSpell(spell);
  const isDirect = _bool(spell?.system?.isDirect);
  const isInstant = _bool(spell?.system?.isInstant);
  const hasUpkeep = _bool(spell?.system?.hasUpkeep);
  const hasOverload = _bool(spell?.system?.hasOverload);
  const hasReinforce = _bool(spell?.system?.hasReinforce);
  
  return {
    isAttack,
    isDamaging,
    isHealing,
    isDirect,
    isInstant,
    hasUpkeep,
    hasOverload,
    hasReinforce
  };
}

/**
 * Resolve spell cost profile with casting options.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} options - { level, isRestrained, isOverloaded, isOvercharged }
 * @returns {{base: number, baseRaw: number, aeModifier: number, aeBreakdown: Array, wpBonus: number, restrained: {enabled: boolean, reduction: number, appliesOnSuccess: boolean}, overload: {enabled: boolean, multiplier: number}, final: number, attempt: number}}
 */
function _resolveCostProfile(actor, spell, options = {}) {
  const baseCostRaw = getSpellCost(spell, options.level ?? null);
  const { total: aeModifierRaw, breakdown: aeBreakdown } = _evaluateSpellCostAEModifier(actor, spell);
  const aeModifier = _num(aeModifierRaw, 0);
  
  // Base cost after AE modifiers (before restrain/overload)
  const baseCost = Math.max(0, Math.floor(baseCostRaw + aeModifier));
  
  const wpBonus = getActorWillpowerBonus(actor);
  const isRestrained = _bool(options.isRestrained);
  const isOverloaded = _bool(options.isOverloaded);
  const isOvercharged = _bool(options.isOvercharged);
  
  // Restrain: RAW reduces cost only on successful cast (refunded after roll)
  const restrainedReduction = isRestrained ? Math.min(Math.max(0, baseCost - 1), wpBonus) : 0;
  
  // Overload: RAW doubles cost
  const overloadMultiplier = isOverloaded ? 2 : 1;
  
  // Attempt cost (what's spent upfront)
  const attemptCost = Math.max(0, Math.floor(baseCost * overloadMultiplier));
  
  // Final cost (after restrain refund on success)
  const finalCost = Math.max(1, attemptCost - restrainedReduction);
  
  return {
    base: baseCost,
    baseRaw: baseCostRaw,
    aeModifier,
    aeBreakdown,
    wpBonus,
    restrained: {
      enabled: isRestrained,
      reduction: restrainedReduction,
      appliesOnSuccess: true // RAW: refund only on successful cast
    },
    overload: {
      enabled: isOverloaded,
      multiplier: overloadMultiplier
    },
    overcharge: {
      enabled: isOvercharged
    },
    final: finalCost,
    attempt: attemptCost
  };
}

/**
 * Resolve spell damage profile.
 * @param {Item} spell
 * @param {object} options - { level, isOverloaded, isCritical }
 * @returns {{formula: string, type: string, isHealing: boolean, overloadBonusFormula: string, criticalBehavior: string}}
 */
function _resolveDamageProfile(spell, options = {}) {
  const formula = getSpellDamageFormula(spell, options.level ?? null);
  const type = getSpellDamageType(spell);
  const isHealing = _isHealingSpell(spell);
  
  const overloadBonusFormula = _str(spell?.system?.overloadBonusDamage);
  
  // RAW: Critical success on damaging spells = max damage
  // RAW: Critical success on non-damaging spells = double restrain reduction
  const criticalBehavior = (formula && formula !== "0" && !isHealing) 
    ? "max-damage" 
    : "double-restrain";
  
  return {
    formula,
    type,
    isHealing,
    overloadBonusFormula,
    criticalBehavior
  };
}

/**
 * Resolve spell range profile.
 * @param {Item} spell
 * @returns {{type: string, maxMeters: number|null, requiresTarget: boolean, requiresLineOfSight: boolean}}
 */
function _resolveRangeProfile(spell) {
  const type = getSpellRangeType(spell);
  const maxMeters = getSpellMaxRangeMeters(spell);
  
  const requiresTarget = ["ranged", "melee"].includes(type);
  const requiresLineOfSight = type === "ranged"; // Melee bypasses LoS checks
  
  return {
    type,
    maxMeters,
    requiresTarget,
    requiresLineOfSight
  };
}

/**
 * Resolve spell AoE profile.
 * @param {Item} spell
 * @returns {{isAoE: boolean, shape: string|null, size: number, width: number, pulse: boolean, includeCaster: boolean, config: object|null}}
 */
function _resolveAoEProfile(spell) {
  const rangeType = getSpellRangeType(spell);
  const isAoE = rangeType === "aoe";
  
  // Also detect AoE from explicit aoeShape/aoeSize fields, not just rangeType.
  const config = getSpellAoEConfig(spell);
  const hasAoEConfig = config && (config.sizeMeters > 0 || config.pulse);

  if (!isAoE && !hasAoEConfig) {
    return {
      isAoE: false,
      shape: null,
      size: 0,
      width: 0,
      pulse: false,
      includeCaster: false,
      config: null
    };
  }
  
  return {
    isAoE: true,
    shape: config?.shape ?? null,
    size: config?.sizeMeters ?? 0,
    width: config?.widthMeters ?? 0,
    pulse: _bool(spell?.system?.aoePulse) || Boolean(config?.pulse),
    includeCaster: _bool(spell?.system?.aoeIncludeCaster) || Boolean(config?.includeCaster),
    config
  };
}

/**
 * Resolve spell metadata (school, form, type).
 * @param {Item} spell
 * @returns {{school: string, form: string, type: string, level: number}}
 */
function _resolveMetadata(spell) {
  return {
    school: _str(spell?.system?.school),
    form: _str(spell?.system?.form),
    type: _str(spell?.system?.spellType),
    level: getSpellLevel(spell)
  };
}

/**
 * Resolve spell scaling configuration.
 * @param {Item} spell
 * @param {object} options - { level }
 * @returns {{levels: Array, currentLevel: object|null, hasScaling: boolean}}
 */
function _resolveScaling(spell, options = {}) {
  const levels = spell?.system?.scaling?.levels ?? [];
  const hasScaling = Array.isArray(levels) && levels.length > 0;
  const currentLevel = getSpellScalingEntry(spell, options.level ?? null);
  
  return {
    levels,
    currentLevel,
    hasScaling
  };
}

/**
 * Resolve spell mindlock configuration.
 * @param {Item} spell
 * @returns {{value: number, isEnabled: boolean}}
 */
function _resolveMindlock(spell) {
  const value = _num(spell?.system?.mindlockValue, 0);
  return {
    value,
    isEnabled: value > 0
  };
}

/**
 * Resolve complete spell profile for casting decisions.
 * 
 * This is the single source of truth for spell metadata normalization.
 * All consumers should use this profile instead of reading spell.system.* directly.
 * 
 * @param {Item} spell - The spell item
 * @param {Actor} actor - The caster
 * @param {object} options - { level, isRestrained, isOverloaded, isOvercharged, isCritical }
 * @returns {SpellProfile}
 */
export function resolveSpellProfile(spell, actor, options = {}) {
  if (!spell || !actor) {
    throw new Error("resolveSpellProfile requires both spell and actor");
  }
  
  const metadata = _resolveMetadata(spell);
  const classification = _resolveClassification(spell);
  const cost = _resolveCostProfile(actor, spell, options);
  const damage = _resolveDamageProfile(spell, options);
  const duration = _resolveDuration(spell, options);
  const range = _resolveRangeProfile(spell);
  const aoe = _resolveAoEProfile(spell);
  const scaling = _resolveScaling(spell, options);
  const mindlock = _resolveMindlock(spell);

  // ── Engine config (targeting, effects, persistence, summon) ──
  let engine = null;
  try {
    const normalized = normalizeSpellConfig(spell);
    engine = {
      targeting: normalized.targeting,
      effects: normalized.effects,
      persistence: normalized.persistence,
      summon: normalized.summon,
      overTime: normalized.overTime
    };
  } catch (_err) {
    // Non-fatal: engine config is optional for legacy spells
  }
  
  const profile = {
    // Identity
    uuid: spell.uuid,
    name: spell.name,
    img: spell.img,
    
    // Metadata
    metadata,
    
    // Classification
    classification,
    
    // Cost
    cost,
    
    // Damage/Healing
    damage,
    
    // Duration
    duration,
    
    // Range
    range,
    
    // AoE
    aoe,
    
    // Scaling
    scaling,
    
    // Mindlock
    mindlock,
    
    // Engine config (targeting, stacking, persistence, summon)
    engine,
    
    // Computed flags
    computed: {
      isTargeted: classification.isAttack || classification.isHealing || classification.isDirect,
      requiresDefense: classification.isAttack && !classification.isDirect,
      appliesEffects: classification.hasUpkeep || (spell.effects?.size ?? 0) > 0 || duration.isFinite,
      blocksOtherCasts: classification.hasUpkeep && !duration.isFinite && duration.value === 0
    },

    // Talent modifiers placeholder (populated below)
    talentModifiers: null
  };

  // ── Spellcasting Talent Modifier Stage ──
  // Apply after base profile resolution (including scaling) so modifiers
  // see the fully resolved profile and can adjust cost/damage/etc.
  try {
    const castContext = {
      spellOptions: options,
      isRestrained: _bool(options.isRestrained),
      isOverloaded: _bool(options.isOverloaded),
      isOvercharged: _bool(options.isOvercharged)
    };
    const { modifiers, summary } = applySpellcastingTalentModifiers({
      actor,
      spellItem: spell,
      profile,
      castContext
    });
    if (modifiers.length > 0) {
      applyTalentSummaryToProfile(profile, summary);
    }
  } catch (err) {
    console.error("UESRPG | spell-profile | Talent modifier stage error:", err);
  }

  // ── Rule Element spellModifier Stage ──
  // Evaluate Rule Elements of type `spellModifier` and feed their deltas
  // into the profile. Runs after the interceptor-based talent stage so
  // that RE-authoritative talents (which skipped the interceptor above)
  // still inject their modifiers.
  try {
    if (isRuleElementRuntimeEnabled({ workflow: "magic" })) {
      const reRuntime = evaluateRuleElementsRuntime({
        actor,
        item: spell,
        workflow: "magic",
        phase: "preRoll",
        testType: "spell",
        attackMode: "magic"
      });
      const sm = reRuntime?.spellModifiers;
      if (sm) {
        const wbDelta = _num(sm.restraintWbDelta, 0);
        const effectDelta = _num(sm.effectDelta, 0);
        const costDelta = _num(sm.costDelta, 0);

        // Apply restraint WB delta (same path as talent summary)
        if (wbDelta !== 0 && profile.cost) {
          profile.cost.wpBonus = _num(profile.cost.wpBonus) + wbDelta;
          if (profile.cost.restrained?.enabled) {
            const adjustedWb = profile.cost.wpBonus;
            const restrainedReduction = Math.min(
              Math.max(0, _num(profile.cost.base) - 1),
              Math.max(0, adjustedWb)
            );
            profile.cost.restrained.reduction = restrainedReduction;
            profile.cost.final = Math.max(1, _num(profile.cost.attempt) - restrainedReduction);
          }
        }

        // Apply effect delta (Reinforce bonus)
        if (effectDelta !== 0 && profile.talentModifiers) {
          profile.talentModifiers.reinforceBonusDelta =
            _num(profile.talentModifiers.reinforceBonusDelta) + effectDelta;
        }

        // Apply cost delta
        if (costDelta !== 0 && profile.cost) {
          profile.cost.attempt = Math.max(0, _num(profile.cost.attempt) + costDelta);
          profile.cost.final = Math.max(1, _num(profile.cost.final) + costDelta);
        }

        // Stamp RE modifiers on profile for downstream inspection
        profile.ruleElementSpellModifiers = {
          restraintWbDelta: wbDelta,
          effectDelta,
          costDelta,
          applied: reRuntime.applied
        };
      }
    }
  } catch (err) {
    console.error("UESRPG | spell-profile | Rule Element spellModifier stage error:", err);
  }

  return profile;
}

/**
 * Get a human-readable summary of a spell profile.
 * Useful for debugging and chat card displays.
 * 
 * @param {SpellProfile} profile
 * @returns {string}
 */
export function summarizeSpellProfile(profile) {
  const parts = [];
  
  parts.push(`**${profile.name}**`);
  parts.push(`${profile.metadata.school} L${profile.metadata.level} (${profile.metadata.type})`);
  parts.push(`Cost: ${profile.cost.attempt} MP${profile.cost.restrained.enabled ? ` (restrained: -${profile.cost.restrained.reduction} on success)` : ""}`);
  
  if (profile.damage.formula && profile.damage.formula !== "0") {
    parts.push(`Damage: ${profile.damage.formula} ${profile.damage.type}`);
  }
  
  if (profile.duration.isFinite) {
    parts.push(`Duration: ${profile.duration.value} ${profile.duration.unit}`);
  } else if (profile.classification.hasUpkeep) {
    parts.push(`Duration: Upkeep`);
  }
  
  if (profile.range.type !== "none") {
    parts.push(`Range: ${profile.range.type}${profile.range.maxMeters ? ` (${profile.range.maxMeters}m)` : ""}`);
  }
  
  if (profile.aoe.isAoE) {
    parts.push(`AoE: ${profile.aoe.shape} (${profile.aoe.size}m)`);
  }
  
  return parts.join(" | ");
}
