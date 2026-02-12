/**
 * src/core/actors/ae/modifiers.js
 *
 * Active Effect modifier collection and evaluation helpers.
 * Provides deterministic resolution for ADD/OVERRIDE modes.
 */

import { isTransferEffectActive } from "../../active-effects/transfer.js";
import { evaluateAEModifierKeys } from "../../active-effects/modifier-evaluator.js";
import { isActorUndead } from "../../traits/trait-registry.js";

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
  for (const k of keys) out[k] = { add: 0, override: null };
  if (!keys.length) return out;

  const asNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const ADD = CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
  const OVERRIDE = CONST?.ACTIVE_EFFECT_MODES?.OVERRIDE ?? 5;

  /** @type {{effect: any, priority: number, sortId: string}[]} */
  const sources = [];

  // Actor embedded effects
  for (const ef of (actor?.effects ?? [])) {
    sources.push({
      effect: ef,
      priority: Number(ef?.priority ?? 0),
      sortId: String(ef?.id ?? ef?._id ?? '')
    });
  }

  // Transfer item effects (type/equipped gating handled by isTransferEffectActive)
  for (const item of (actor?.items ?? [])) {
    for (const ef of (item?.effects ?? [])) {
      if (!isTransferEffectActive(actor, item, ef)) continue;
      sources.push({
        effect: ef,
        priority: Number(ef?.priority ?? 0),
        sortId: String(ef?.id ?? ef?._id ?? '')
      });
    }
  }

  // Deterministic ordering: ascending priority, then ascending id.
  sources.sort((a, b) => (a.priority - b.priority) || a.sortId.localeCompare(b.sortId));

  for (const { effect } of sources) {
    if (!effect || effect.disabled) continue;
    const changes = Array.isArray(effect.changes) ? effect.changes : [];
    for (const ch of changes) {
      if (!ch) continue;
      const key = ch.key;
      if (!out[key]) continue;
      const mode = ch.mode;
      const value = asNum(ch.value);
      if (!value && mode !== OVERRIDE) continue;

      if (mode === OVERRIDE) {
        out[key].override = value;
        out[key].add = 0;
      } else if (mode === ADD) {
        // Ignore ADDs if an OVERRIDE exists (final-wins semantics for the pipeline).
        if (out[key].override == null) out[key].add += value;
      }
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
  if (!keys.length) return { add: 0, override: null };

  const keyLookup = new Set(keys);

  const asNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const ADD = CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
  const OVERRIDE = CONST?.ACTIVE_EFFECT_MODES?.OVERRIDE ?? 5;

  /** @type {{effect: any, priority: number, sortId: string}[]} */
  const sources = [];

  for (const ef of (actor?.effects ?? [])) {
    sources.push({
      effect: ef,
      priority: Number(ef?.priority ?? 0),
      sortId: String(ef?.id ?? ef?._id ?? '')
    });
  }

  for (const item of (actor?.items ?? [])) {
    for (const ef of (item?.effects ?? [])) {
      if (!isTransferEffectActive(actor, item, ef)) continue;
      sources.push({
        effect: ef,
        priority: Number(ef?.priority ?? 0),
        sortId: String(ef?.id ?? ef?._id ?? '')
      });
    }
  }

  sources.sort((a, b) => (a.priority - b.priority) || a.sortId.localeCompare(b.sortId));

  const out = { add: 0, override: null };

  for (const { effect } of sources) {
    if (!effect || effect.disabled) continue;
    const changes = Array.isArray(effect.changes) ? effect.changes : [];
    for (const ch of changes) {
      if (!ch) continue;
      const key = ch.key;
      if (!keyLookup.has(key)) continue;
      const mode = ch.mode;
      const value = asNum(ch.value);
      if (!value && mode !== OVERRIDE) continue;

      if (mode === OVERRIDE) {
        out.override = value;
        out.add = 0;
      } else if (mode === ADD) {
        if (out.override == null) out.add += value;
      }
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
  const keys = [
    `system.modifiers.${rk}.base`,
    `system.modifiers.${rk}.bonus`,
    `system.modifiers.${rk}.max`,
    `system.modifiers.${rk}.value`
  ];
  const map = collectAEModifiersForKeys(actor, keys);
  return {
    base: map[keys[0]] ?? { add: 0, override: null },
    bonus: map[keys[1]] ?? { add: 0, override: null },
    max: map[keys[2]] ?? { add: 0, override: null },
    value: map[keys[3]] ?? { add: 0, override: null }
  };
}

/**
 * Read deterministic AE modifiers for Initiative Rating (IR).
 * @param {SimpleActor} actor
 */
export function getInitiativeAEModifiers(actor) {
  const keys = {
    bonus: "system.modifiers.initiative.bonus",
    base: "system.modifiers.initiative.base",
    value: "system.modifiers.initiative.value",
    flat: "system.modifiers.initiative.flat",
    multAgi: "system.modifiers.initiative.mult.agi",
    multInt: "system.modifiers.initiative.mult.int",
    multPrc: "system.modifiers.initiative.mult.prc"
  };

  const map = collectAEModifiersForKeys(actor, Object.values(keys));

  return {
    bonus: map[keys.bonus] ?? { add: 0, override: null },
    base: map[keys.base] ?? { add: 0, override: null },
    value: map[keys.value] ?? { add: 0, override: null },
    flat: map[keys.flat] ?? { add: 0, override: null },
    mult: {
      agi: map[keys.multAgi] ?? { add: 0, override: null },
      int: map[keys.multInt] ?? { add: 0, override: null },
      prc: map[keys.multPrc] ?? { add: 0, override: null }
    }
  };
}

/**
 * Read deterministic AE modifiers for Speed (ground, fly, swim).
 * @param {SimpleActor} actor
 */
export function getSpeedAEModifiers(actor) {
  const keys = {
    value: "system.modifiers.speed.value",
    flySpeed: "system.modifiers.speed.flySpeed",
    swimSpeed: "system.modifiers.speed.swimSpeed"
  };
  const map = collectAEModifiersForKeys(actor, Object.values(keys));
  return {
    value: map[keys.value] ?? { add: 0, override: null },
    flySpeed: map[keys.flySpeed] ?? { add: 0, override: null },
    swimSpeed: map[keys.swimSpeed] ?? { add: 0, override: null }
  };
}

/**
 * Read deterministic AE modifiers for Action Points.
 * @param {SimpleActor} actor
 */
export function getActionPointsAEModifiers(actor) {
  const keys = {
    max: "system.modifiers.action_points.max",
    value: "system.modifiers.action_points.value"
  };
  const map = collectAEModifiersForKeys(actor, Object.values(keys));
  return {
    max: map[keys.max] ?? { add: 0, override: null },
    value: map[keys.value] ?? { add: 0, override: null }
  };
}

/**
 * Read deterministic AE modifiers for Lucky/Unlucky active slot counts.
 * @param {SimpleActor} actor
 */
export function getLuckyUnluckySlotAEModifiers(actor) {
  const lucky = collectAEModifiersForKeySetMerged(actor, [
    "system.modifiers.lucky_numbers.max",
    "system.modifiers.lucky_numbers.value"
  ]);
  const unlucky = collectAEModifiersForKeySetMerged(actor, [
    "system.modifiers.unlucky_numbers.max",
    "system.modifiers.unlucky_numbers.value"
  ]);
  return { lucky, unlucky };
}

/**
 * Read deterministic AE modifiers for Carry/Encumbrance.
 * @param {SimpleActor} actor
 */
export function getCarryAEModifiers(actor) {
  const keys = {
    carryBase: "system.modifiers.carry.base",
    carryBonus: "system.modifiers.carry.bonus",
    carryOverride: "system.modifiers.carry.override",

    // Encumbrance lanes (RAW): test penalty, speed penalty, stamina penalty.
    encPenaltyLegacy: "system.modifiers.encumbrance.penalty",
    encTestPenalty: "system.modifiers.encumbrance.testPenalty",
    encSpeedPenalty: "system.modifiers.encumbrance.speedPenalty",
    encStaminaPenalty: "system.modifiers.encumbrance.staminaPenalty"
  };

  const map = collectAEModifiersForKeys(actor, Object.values(keys));

  // Prefer the explicit RAW-aligned key if present; otherwise fall back to the legacy alias.
  const testPenalty = map[keys.encTestPenalty] ?? map[keys.encPenaltyLegacy] ?? { add: 0, override: null };

  return {
    base: map[keys.carryBase] ?? { add: 0, override: null },
    bonus: map[keys.carryBonus] ?? { add: 0, override: null },
    override: map[keys.carryOverride] ?? { add: 0, override: null },

    // Keep old property name working, but also expose the clearer name.
    encPenalty: testPenalty,
    encTestPenalty: testPenalty,
    encSpeedPenalty: map[keys.encSpeedPenalty] ?? { add: 0, override: null },
    encStaminaPenalty: map[keys.encStaminaPenalty] ?? { add: 0, override: null }
  };
}

/**
 * Read deterministic AE modifiers for Fatigue / Exhaustion.
 * @param {SimpleActor} actor
 */
export function getFatigueAEModifiers(actor) {
  const bonusLane = collectAEModifiersForKeySetMerged(actor, [
    "system.modifiers.fatigue.bonus",
    "system.modifiers.exhaustion.bonus"
  ]);
  const penaltyLane = collectAEModifiersForKeySetMerged(actor, [
    "system.modifiers.fatigue.penalty",
    "system.modifiers.exhaustion.penalty"
  ]);
  return { bonus: bonusLane, penalty: penaltyLane };
}

/**
 * Apply Active Effect modifiers to resistance values.
 * @param {SimpleActor} actor
 * @param {object} resistanceData - The actor's resistance object to modify
 * @returns {object} Modified resistance values with AE modifiers applied
 */
export function applyResistanceAEModifiers(actor, resistanceData) {
  if (!resistanceData || typeof resistanceData !== 'object') return resistanceData;
  
  // Map of resistance keys to their corresponding AE key paths
  const resistanceKeyMap = {
    fireR: {
      legacy: "system.modifiers.resistance.fireR",
      traits: "system.traits.resistance.fire"
    },
    frostR: {
      legacy: "system.modifiers.resistance.frostR",
      traits: "system.traits.resistance.frost"
    },
    shockR: {
      legacy: "system.modifiers.resistance.shockR",
      traits: "system.traits.resistance.shock"
    },
    poisonR: {
      legacy: "system.modifiers.resistance.poisonR",
      resistances: "system.resistances.poison",
      traits: "system.traits.resistance.poison"
    },
    magicR: {
      legacy: "system.modifiers.resistance.magicR",
      resistances: "system.resistances.magic"
    },
    diseaseR: {
      legacy: "system.modifiers.resistance.diseaseR",
      resistances: "system.resistances.disease",
      traits: "system.traits.resistance.disease"
    },
    silverR: {
      legacy: "system.modifiers.resistance.silverR"
    },
    sunlightR: {
      legacy: "system.modifiers.resistance.sunlightR"
    },
    natToughness: {
      legacy: "system.modifiers.resistance.natToughness"
    }
  };
  
  // Collect all AE keys to evaluate
  const allKeys = [];
  for (const resKey in resistanceKeyMap) {
    const paths = resistanceKeyMap[resKey];
    if (paths.legacy) allKeys.push(paths.legacy);
    if (paths.resistances) allKeys.push(paths.resistances);
    if (paths.traits) allKeys.push(paths.traits);
  }
  
  // Evaluate all resistance AE modifiers
  const aeMods = evaluateAEModifierKeys(actor, allKeys);
  
  // Apply modifiers to each resistance value
  const result = { ...resistanceData };
  for (const resKey in resistanceKeyMap) {
    const paths = resistanceKeyMap[resKey];
    let totalModifier = 0;
    
    // Sum all applicable AE modifiers for this resistance
    if (paths.legacy) {
      totalModifier += Number(aeMods[paths.legacy] ?? 0) || 0;
    }
    if (paths.resistances) {
      totalModifier += Number(aeMods[paths.resistances] ?? 0) || 0;
    }
    if (paths.traits) {
      totalModifier += Number(aeMods[paths.traits] ?? 0) || 0;
    }
    
    // Apply the modifier to the base resistance value
    if (totalModifier !== 0 && typeof result[resKey] === 'number') {
      result[resKey] = Number(result[resKey] ?? 0) + totalModifier;
    }
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

  const keys = [
    "system.modifiers.wound_threshold.bonus",
    "system.modifiers.wound_threshold.value"
  ];

  const map = collectAEModifiersForKeys(actor, keys);

  // Bonus lane
  {
    const m = map[keys[0]] ?? { add: 0, override: null };
    if (m.override != null) actorSystemData.wound_threshold.bonus = Number(m.override);
    else if (m.add) actorSystemData.wound_threshold.bonus = Number(actorSystemData.wound_threshold.bonus ?? 0) + Number(m.add);
  }

  // Value lane (final)
  {
    const m = map[keys[1]] ?? { add: 0, override: null };
    if (m.override != null) actorSystemData.wound_threshold.value = Number(m.override);
    else if (m.add) actorSystemData.wound_threshold.value = Number(actorSystemData.wound_threshold.value ?? 0) + Number(m.add);
  }

  // Safety: wound threshold cannot be negative
  actorSystemData.wound_threshold.value = Math.max(0, Number(actorSystemData.wound_threshold.value ?? 0));
}
