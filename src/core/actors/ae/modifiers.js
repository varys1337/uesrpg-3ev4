/**
 * src/core/actors/ae/modifiers.js
 *
 * Active Effect modifier collection and evaluation helpers.
 * Provides deterministic resolution for ADD/OVERRIDE modes.
 *
 * Delegates effect collection to the shared collectApplicableEffects helper
 * in modifier-evaluator.js so disabled-filtering, transfer-gating, and
 * origin-deduplication logic is maintained in a single location.
 */

import { getApplicableEffectsCached } from "../../active-effects/modifier-evaluator.js";
import { applyNumericModifierChange, createModifierTotal, isAddMode, isOverrideMode, mergeModifierTotals } from "../../active-effects/reducers.js";
import { isActorUndead } from "../../traits/trait-registry.js";
import { getEffectChanges } from "../../../utils/compat.js";

const RESISTANCE_AE_PATHS = Object.freeze({
  fireR: ["system.modifiers.resistance.fireR", "system.traits.resistance.fire"],
  frostR: ["system.modifiers.resistance.frostR", "system.traits.resistance.frost"],
  shockR: ["system.modifiers.resistance.shockR", "system.traits.resistance.shock"],
  poisonR: ["system.modifiers.resistance.poisonR", "system.resistances.poison", "system.traits.resistance.poison"],
  magicR: ["system.modifiers.resistance.magicR", "system.resistances.magic"],
  diseaseR: ["system.modifiers.resistance.diseaseR", "system.resistances.disease", "system.traits.resistance.disease"],
  silverR: ["system.modifiers.resistance.silverR"],
  sunlightR: ["system.modifiers.resistance.sunlightR"],
  natToughness: ["system.modifiers.resistance.natToughness"],
});

/**
 * All AE key paths evaluated during actor prepare. Maintained centrally so
 * buildActorAETotalsMap can collect them in a single effect-array pass.
 */
const _ALL_ACTOR_AE_KEYS = Object.freeze([
  // Characteristic bonuses (post-calculation)
  "system.characteristics.str.bonus", "system.characteristics.end.bonus",
  "system.characteristics.agi.bonus", "system.characteristics.int.bonus",
  "system.characteristics.wp.bonus",  "system.characteristics.prc.bonus",
  "system.characteristics.prs.bonus", "system.characteristics.lck.bonus",
  // Resources: hp, magicka, stamina, luck_points
  "system.modifiers.hp.base",          "system.modifiers.hp.bonus",
  "system.modifiers.hp.max",           "system.modifiers.hp.value",
  "system.modifiers.magicka.base",     "system.modifiers.magicka.bonus",
  "system.modifiers.magicka.max",      "system.modifiers.magicka.value",
  "system.modifiers.stamina.base",     "system.modifiers.stamina.bonus",
  "system.modifiers.stamina.max",      "system.modifiers.stamina.value",
  "system.modifiers.luck_points.base", "system.modifiers.luck_points.bonus",
  "system.modifiers.luck_points.max",  "system.modifiers.luck_points.value",
  // Initiative
  "system.modifiers.initiative.bonus",    "system.modifiers.initiative.base",
  "system.modifiers.initiative.value",    "system.modifiers.initiative.flat",
  "system.modifiers.initiative.mult.agi", "system.modifiers.initiative.mult.int",
  "system.modifiers.initiative.mult.prc",
  // Speed
  "system.modifiers.speed.value",    "system.modifiers.speed.flySpeed",
  "system.modifiers.speed.swimSpeed",
  // Action Points
  "system.modifiers.action_points.max", "system.modifiers.action_points.value",
  // Lucky/Unlucky slots (alias pairs merged by _mergeFromMap)
  "system.modifiers.lucky_numbers.max",   "system.modifiers.lucky_numbers.value",
  "system.modifiers.unlucky_numbers.max", "system.modifiers.unlucky_numbers.value",
  // Recovery
  "system.modifiers.recovery.naturalHealing.multiplier",
  "system.modifiers.recovery.naturalHealing.flatBonus",
  "system.modifiers.recovery.magicka.multiplier",
  "system.modifiers.recovery.stamina.multiplier",
  // Carry/Encumbrance
  "system.modifiers.carry.base",    "system.modifiers.carry.bonus",
  "system.modifiers.carry.override",
  "system.modifiers.encumbrance.penalty",      "system.modifiers.encumbrance.testPenalty",
  "system.modifiers.encumbrance.speedPenalty", "system.modifiers.encumbrance.staminaPenalty",
  // Fatigue/Exhaustion (alias pairs)
  "system.modifiers.fatigue.bonus",   "system.modifiers.exhaustion.bonus",
  "system.modifiers.fatigue.penalty", "system.modifiers.exhaustion.penalty",
  // Resistances (all paths from RESISTANCE_AE_PATHS)
  ...Object.values(RESISTANCE_AE_PATHS).flat(),
  // Wound Threshold
  "system.modifiers.wound_threshold.bonus", "system.modifiers.wound_threshold.value",
]);

/**
 * Merge AE key results from a pre-built totals map as an aliased key-set.
 * Equivalent to collectAEModifiersForKeySetMerged but reads from a cached map.
 * OVERRIDE from any key wins; ADDs accumulate until an OVERRIDE is seen.
 * @param {Record<string, {add: number, override: number|null}>} map
 * @param {string[]} keySet
 * @returns {{add: number, override: number|null}}
 */
function _mergeFromMap(map, keySet) {
  return mergeModifierTotals(keySet.map((key) => map[key]));
}

/**
 * Build (or return cached) the full AE modifier totals map for the given actor.
 * Evaluates all known actor-prepare AE key paths in one effect-array pass.
 * Cached on actor._aeTotalsMap; must be invalidated alongside actor._aeApplicableCache
 * in AE lifecycle hooks.
 * @param {SimpleActor} actor
 * @returns {Record<string, {add: number, override: number|null}>}
 */
export function buildActorAETotalsMap(actor) {
  if (actor?._aeTotalsMap) return actor._aeTotalsMap;
  const map = collectAEModifiersForKeys(actor, _ALL_ACTOR_AE_KEYS);
  if (actor) actor._aeTotalsMap = map;
  return map;
}

/**
 * Collect numeric Active Effect modifiers for a set of target keys.
 *
 * Deterministic resolution rules:
 *  - We consider Actor embedded effects and active transfer Item effects.
 *  - ADD values are summed.
 *  - If any OVERRIDE exists for a key, it wins and ADDs for that key are ignored.
 *  - Other modes are ignored.
 *
 * @param {SimpleActor} actor
 * @param {Array<string>} targetKeys
 * @returns {Record<string, { add: number, override: number|null }>} map by key
 */
export function collectAEModifiersForKeys(actor, targetKeys = []) {
  const keys = Array.isArray(targetKeys) ? targetKeys.filter(Boolean) : [];
  const out = {};
  for (const k of keys) out[k] = createModifierTotal();
  if (!keys.length) return out;

  // Use the shared effect collection helper (disabled-filtering, transfer-gating,
  // origin-deduplication all handled centrally in modifier-evaluator.js).
  const effects = getApplicableEffectsCached(actor);

  for (const effect of effects) {
    const changes = getEffectChanges(effect);
    for (const ch of changes) {
      if (!ch) continue;
      const key = ch.key;
      if (!out[key]) continue;
      applyNumericModifierChange(out[key], ch);
    }
  }

  return out;
}

/**
 * Collect deterministic AE modifiers where multiple keys should be treated as a single semantic lane.
 * This is used for aliasing (e.g., fatigue vs exhaustion) while preserving deterministic OVERRIDE behavior.
 *
 * @param {SimpleActor} actor
 * @param {string[]} keySet
 * @returns {{ add: number, override: number|null }}
 */
export function collectAEModifiersForKeySetMerged(actor, keySet = []) {
  const keys = Array.isArray(keySet) ? keySet.filter(Boolean) : [];
  if (!keys.length) return createModifierTotal();

  const keyLookup = new Set(keys);

  // Use the shared effect collection helper.
  const effects = getApplicableEffectsCached(actor);

  const out = createModifierTotal();

  for (const effect of effects) {
    const changes = getEffectChanges(effect);
    for (const ch of changes) {
      if (!ch) continue;
      const key = ch.key;
      if (!keyLookup.has(key)) continue;
      applyNumericModifierChange(out, ch);
    }
  }

  return out;
}

/**
 * Read deterministic AE modifiers for a resource modifier namespace.
 * @param {SimpleActor} actor
 * @param {string} resourceKey
 * @returns {{ base: {add:number, override:number|null}, bonus:{add:number, override:number|null}, max:{add:number, override:number|null}, value:{add:number, override:number|null} }}
 */
export function getResourceAEModifiers(actor, resourceKey) {
  const rk = String(resourceKey ?? '').trim();
  const baseKey  = `system.modifiers.${rk}.base`;
  const bonusKey = `system.modifiers.${rk}.bonus`;
  const maxKey   = `system.modifiers.${rk}.max`;
  const valueKey = `system.modifiers.${rk}.value`;
  const map = buildActorAETotalsMap(actor);
  return {
    base:  map[baseKey]  ?? { add: 0, override: null },
    bonus: map[bonusKey] ?? { add: 0, override: null },
    max:   map[maxKey]   ?? { add: 0, override: null },
    value: map[valueKey] ?? { add: 0, override: null }
  };
}

/**
 * Read deterministic AE modifiers for Initiative Rating (IR).
 * @param {SimpleActor} actor
 */
export function getInitiativeAEModifiers(actor) {
  const map = buildActorAETotalsMap(actor);
  return {
    bonus: map["system.modifiers.initiative.bonus"]    ?? { add: 0, override: null },
    base:  map["system.modifiers.initiative.base"]     ?? { add: 0, override: null },
    value: map["system.modifiers.initiative.value"]    ?? { add: 0, override: null },
    flat:  map["system.modifiers.initiative.flat"]     ?? { add: 0, override: null },
    mult: {
      agi: map["system.modifiers.initiative.mult.agi"] ?? { add: 0, override: null },
      int: map["system.modifiers.initiative.mult.int"] ?? { add: 0, override: null },
      prc: map["system.modifiers.initiative.mult.prc"] ?? { add: 0, override: null }
    }
  };
}

/**
 * Read deterministic AE modifiers for Speed (ground, fly, swim).
 * @param {SimpleActor} actor
 */
export function getSpeedAEModifiers(actor) {
  const map = buildActorAETotalsMap(actor);
  return {
    value:     map["system.modifiers.speed.value"]     ?? { add: 0, override: null },
    flySpeed:  map["system.modifiers.speed.flySpeed"]  ?? { add: 0, override: null },
    swimSpeed: map["system.modifiers.speed.swimSpeed"] ?? { add: 0, override: null }
  };
}

/**
 * Read deterministic AE modifiers for Action Points.
 * @param {SimpleActor} actor
 */
export function getActionPointsAEModifiers(actor) {
  const map = buildActorAETotalsMap(actor);
  return {
    max:   map["system.modifiers.action_points.max"]   ?? { add: 0, override: null },
    value: map["system.modifiers.action_points.value"] ?? { add: 0, override: null }
  };
}

/**
 * Read deterministic AE modifiers for Lucky/Unlucky active slot counts.
 * @param {SimpleActor} actor
 */
export function getLuckyUnluckySlotAEModifiers(actor) {
  const map = buildActorAETotalsMap(actor);
  const lucky   = _mergeFromMap(map, ["system.modifiers.lucky_numbers.max",   "system.modifiers.lucky_numbers.value"]);
  const unlucky = _mergeFromMap(map, ["system.modifiers.unlucky_numbers.max", "system.modifiers.unlucky_numbers.value"]);
  return { lucky, unlucky };
}

/**
 * Read deterministic AE modifiers for recovery lanes.
 * @param {SimpleActor} actor
 */
export function getRecoveryAEModifiers(actor) {
  const map = buildActorAETotalsMap(actor);
  return {
    naturalHealing: {
      multiplier: map["system.modifiers.recovery.naturalHealing.multiplier"] ?? { add: 0, override: null },
      flatBonus: map["system.modifiers.recovery.naturalHealing.flatBonus"] ?? { add: 0, override: null }
    },
    magicka: {
      multiplier: map["system.modifiers.recovery.magicka.multiplier"] ?? { add: 0, override: null }
    },
    stamina: {
      multiplier: map["system.modifiers.recovery.stamina.multiplier"] ?? { add: 0, override: null }
    }
  };
}

/**
 * Read deterministic AE modifiers for Carry/Encumbrance.
 * @param {SimpleActor} actor
 */
export function getCarryAEModifiers(actor) {
  const map = buildActorAETotalsMap(actor);
  // Prefer the explicit RAW-aligned testPenalty key; fall back to the legacy alias.
  const testPenalty = map["system.modifiers.encumbrance.testPenalty"]
    ?? map["system.modifiers.encumbrance.penalty"]
    ?? { add: 0, override: null };
  return {
    base:     map["system.modifiers.carry.base"]     ?? { add: 0, override: null },
    bonus:    map["system.modifiers.carry.bonus"]    ?? { add: 0, override: null },
    override: map["system.modifiers.carry.override"] ?? { add: 0, override: null },
    // Keep old property name working, but also expose the clearer name.
    encPenalty:        testPenalty,
    encTestPenalty:    testPenalty,
    encSpeedPenalty:   map["system.modifiers.encumbrance.speedPenalty"]   ?? { add: 0, override: null },
    encStaminaPenalty: map["system.modifiers.encumbrance.staminaPenalty"] ?? { add: 0, override: null }
  };
}

/**
 * Read deterministic AE modifiers for Fatigue / Exhaustion.
 * @param {SimpleActor} actor
 */
export function getFatigueAEModifiers(actor) {
  const map = buildActorAETotalsMap(actor);
  return {
    bonus:   _mergeFromMap(map, ["system.modifiers.fatigue.bonus",   "system.modifiers.exhaustion.bonus"]),
    penalty: _mergeFromMap(map, ["system.modifiers.fatigue.penalty", "system.modifiers.exhaustion.penalty"])
  };
}

/**
 * Apply Active Effect modifiers to resistance values.
 * @param {SimpleActor} actor
 * @param {object} resistanceData - The actor's resistance object to modify
 * @returns {object} Modified resistance values with AE modifiers applied
 */
export function applyResistanceAEModifiers(actor, resistanceData) {
  if (!resistanceData || typeof resistanceData !== 'object') return resistanceData;

  // Use the centrally-cached totals map (includes all resistance key paths).
  const aeMods = buildActorAETotalsMap(actor);

  // Apply modifiers to each resistance value
  const result = { ...resistanceData };
  for (const [resKey, keys] of Object.entries(RESISTANCE_AE_PATHS)) {
    const merged = mergeModifierTotals(keys.map((key) => aeMods[key]), { accumulateOverrides: true });
    if (typeof result[resKey] !== 'number') continue;
    if (merged.override != null) result[resKey] = Number(merged.override);
    else if (merged.add) result[resKey] = Number(result[resKey] ?? 0) + Number(merged.add);
  }

  return result;
}

/**
 * Chapter 5: magical healing / first aid can temporarily remove passive wound penalties
 * while the actor remains wounded. Implemented as AE-backed suppression markers.
 * @param {SimpleActor} actor
 * @param {object} actorData
 */
export function hasWoundPenaltySuppression(actor, actorData) {
  if (isActorUndead(actor)) return true;
  // Passive wound effect suppression immunity (e.g. Frenzy).
  try {
    const raw = actorData?.system?.traits?.immunity?.passiveWounds;
    if (raw === true) return true;
    const n = Number(raw);
    if (Number.isFinite(n) && n !== 0) return true;
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "on") return true;
  } catch (_e) {}

  const scope = game.system?.id ?? "uesrpg-3ev4";
  const effectsRaw = actorData?.effects;
  const effects = Array.isArray(effectsRaw) ? effectsRaw : (effectsRaw ? Array.from(effectsRaw) : []);

  return effects.some(e => {
    const flags = e?.flags?.[scope] ?? e?.flags?.["uesrpg-3ev4"] ?? null;
    const wounds = flags?.wounds ?? null;
    if (!wounds || typeof wounds !== "object") return false;

    // Explicit suppression marker
    if (wounds.suppressWoundPenalty === true) return true;

    const kind = String(wounds.kind ?? "");
    if (kind === "forestall") {
      const r = Number(wounds.remainingRounds ?? 0);
      return Number.isFinite(r) && r > 0;
    }
    if (kind === "firstAid") return true;

    return false;
  });
}

/**
 * Apply deterministic Active Effect modifiers to Wound Threshold.
 * @param {SimpleActor} actor
 * @param {any} actorSystemData
 */
export function applyWoundThresholdAEs(actor, actorSystemData) {
  if (!actorSystemData) return;

  const map = buildActorAETotalsMap(actor);

  // Bonus lane
  {
    const m = map["system.modifiers.wound_threshold.bonus"] ?? { add: 0, override: null };
    if (m.override != null) actorSystemData.wound_threshold.bonus = Number(m.override);
    else if (m.add) actorSystemData.wound_threshold.bonus = Number(actorSystemData.wound_threshold.bonus ?? 0) + Number(m.add);
  }

  // Value lane (final)
  {
    const m = map["system.modifiers.wound_threshold.value"] ?? { add: 0, override: null };
    if (m.override != null) actorSystemData.wound_threshold.value = Number(m.override);
    else if (m.add) actorSystemData.wound_threshold.value = Number(actorSystemData.wound_threshold.value ?? 0) + Number(m.add);
  }

  // Safety: wound threshold cannot be negative
  actorSystemData.wound_threshold.value = Math.max(0, Number(actorSystemData.wound_threshold.value ?? 0));
}

/**
 * Collect AE modifiers targeting custom skill items.
 *
 * Scans all active effects on the actor for changes whose key matches the
 * pattern `skill.{skillName}.bonus` and accumulates the totals by skill name.
 * ADD mode values are summed; OVERRIDE mode sets an absolute value (last one wins).
 *
 * This is intentionally separate from buildActorAETotalsMap because skill
 * modifiers operate on embedded Item documents, not actor system data paths.
 *
 * Supported key format:  skill.{Skill Name}.bonus
 * Example:               skill.Alchemy.bonus
 *
 * @param {Actor} actor
 * @returns {Record<string, number>}  Map of skillName → total bonus to apply
 */
export function collectSkillAEModifiers(actor) {
  const result = {};
  const overrideTracker = {};

  for (const effect of actor.effects ?? []) {
    if (!effect.active) continue;
    for (const change of getEffectChanges(effect)) {
      const m = String(change.key ?? "").match(/^skill\.(.+)\.bonus$/);
      if (!m) continue;
      const name = m[1];
      const val = Number(change.value) || 0;
      const mode = Number(change.mode);
      // mode 5 = OVERRIDE, mode 2 = ADD (Foundry CONST.ACTIVE_EFFECT_MODES)
      if (isOverrideMode(mode)) {
        overrideTracker[name] = val;
      } else if (isAddMode(mode)) {
        result[name] = (result[name] ?? 0) + val;
      }
    }
  }

  // Overrides take precedence over accumulated adds
  for (const [name, val] of Object.entries(overrideTracker)) {
    result[name] = val;
  }

  return result;
}
