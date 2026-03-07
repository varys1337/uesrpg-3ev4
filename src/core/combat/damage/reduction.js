/**
 * src/core/combat/damage/reduction.js
 * UESRPG 3e v4 — Damage Reduction Calculation
 *
 * Handles armor, resistance, and toughness reduction based on damage type and hit location.
 */

import { evaluateAEModifierKeys, evaluateAEModifierKeysDetailed } from "../../active-effects/modifier-evaluator.js";
import { UESRPG } from "../../constants.js";
import { collectItemTokens } from "./tokens.js";
import { DAMAGE_TYPES } from "./types.js";
import { getWallOfSteelArmorItemBonus } from "../../traits/resilience-talents.js";

/**
 * Best-effort condition check without importing the condition engine.
 * Avoids circular dependencies (condition-engine -> damage-automation).
 *
 * @param {Actor} actor
 * @param {string} key
 * @returns {boolean}
 */
function actorHasConditionKey(actor, key) {
  const k = String(key || "").trim().toLowerCase();
  if (!actor || !k) return false;

  for (const ef of (actor.effects ?? [])) {
    try {
      if (ef?.disabled) continue;
      if (ef?.statuses?.has?.(k)) return true;
      
      const coreId = String(ef?.flags?.core?.statusId ?? "").toLowerCase();
      if (coreId === k) return true;

      const sysKey = String(ef?.flags?.["uesrpg-3ev4"]?.condition?.key ?? "").toLowerCase();
      if (sysKey === k) return true;

      // Loose fallback: some legacy effects only have a name
      const n = String(ef?.name ?? "").toLowerCase();
      if (n === k) return true;
    } catch (_e) {
      continue;
    }
  }

  return false;
}

/**
 * Determine if an item is a magic source for damage purposes.
 * Used to check if weapons/armor bypass incorporeal resistance.
 *
 * @param {Item} item
 * @returns {boolean}
 */
export function isItemMagicSource(item) {
  if (!item) return false;
  const sys = item.system ?? {};
  const tokens = collectItemTokens(item);

  const hasMagicToken = tokens.includes("magic");
  const hasSilverToken = tokens.includes("silver") || tokens.includes("silvered");

  const legacy = String(sys.qualities ?? "").toLowerCase();
  const legacyMagic = legacy.includes("magic");
  const legacySilver = legacy.includes("silver");

  const runed = sys.runed === true;
  const chargeValue = Number(sys.charge?.value ?? 0);
  const chargeMax = Number(sys.charge?.max ?? 0);
  const hasCharge = (Number.isFinite(chargeValue) && chargeValue > 0)
    || (Number.isFinite(chargeMax) && chargeMax > 0);

  if (String(item.type ?? "") === "armor") {
    const magicAR = Number(sys.magic_arEffective ?? sys.magic_ar ?? 0);
    const hasMagicAR = Number.isFinite(magicAR) && magicAR > 0;
    return hasMagicAR || hasMagicToken || legacyMagic || runed || hasCharge;
  }

  return hasMagicToken || hasSilverToken || legacyMagic || legacySilver || runed || hasCharge;
}

/**
 * Get total damage reduction for an actor based on damage type.
 * Physical: armor (by hit location) + natToughness
 * Non-physical: resistance only (no generic END soak)
 *
 * @param {Actor} actor
 * @param {string} damageType
 * @param {string} hitLocation
 * @param {object} options
 * @returns {{armor:number,resistance:number,toughness:number,total:number,penetrated:number}}
 */
export function getDamageReduction(actor, damageType = DAMAGE_TYPES.PHYSICAL, hitLocation = "Body", options = {}) {
  if (!actor?.system) {
    return { armor: 0, resistance: 0, toughness: 0, total: 0, penetrated: 0 };
  }

  const ignoreNonMagicArmor = options?.ignoreNonMagicArmor === true;

  // Template uses RightArm/LeftArm/RightLeg/LeftLeg keys; sheets might still pass "Right Arm" etc.
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

  const propertyName = locationMap[hitLocation] ?? hitLocation;

  // RAW: While Prone, treat any FULL armor as PARTIAL for coverage purposes.
  // This is implemented as a coverage-class downgrade only (does not mutate item data).
  const isProneForArmor = actorHasConditionKey(actor, "prone");

  // --- Armor coverage normalization ---
  // Legacy data (and the base template) can create armor items where all hitLocations are set to true.
  // This causes unrelated pieces (e.g. body armor) to incorrectly contribute AR to other locations.
  // We normalize coverage deterministically using the armor item's "category" when possible.
  //
  // Rules:
  // - For FULL armor pieces, category is authoritative.
  // - For PARTIAL armor pieces, if hitLocations are "all true" (legacy default), fall back to category.
  // - Otherwise, only explicit true values count as covered (undefined does not).
  const ARMOR_CATEGORY_TO_LOCATIONS = {
    head: ["Head"],
    body: ["Body"],
    l_arm: ["LeftArm"],
    r_arm: ["RightArm"],
    l_leg: ["LeftLeg"],
    r_leg: ["RightLeg"],
  };

  const ARMOR_LOCATION_KEYS = ["Head", "Body", "RightArm", "LeftArm", "RightLeg", "LeftLeg"];

  const normalizeCoverageOverride = (value) => {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return "";
    if (raw === "full" || raw === "partial" || raw === "none") return raw;
    if (raw === "no armor" || raw === "noarmour" || raw === "no armour" || raw === "no_armor" || raw === "no-armour") {
      return "none";
    }
    return "";
  };

  const resolveArmorClass = (sys, locationKey = null, { applyProne = true } = {}) => {
    let armorClass = String(sys?.armorClass || "partial").toLowerCase();
    if (armorClass !== "full" && armorClass !== "partial" && armorClass !== "none") armorClass = "partial";
    const override = normalizeCoverageOverride(sys?.hitLocationStates?.[locationKey]?.coverageOverride);
    if (override) armorClass = override;
    if (applyProne && isProneForArmor && armorClass === "full") armorClass = "partial";
    return armorClass;
  };

  const getLocationDamagedValue = (sys, locationKey) => {
    const raw = sys?.hitLocationStates?.[locationKey]?.damaged;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(0, Math.floor(n));
  };

  const getCoveredLocations = (item, locationKey = null) => {
    const sys = item?.system ?? {};
    const armorClass = resolveArmorClass(sys, locationKey);
    const category = String(sys.category || "").toLowerCase();
    const hitLocs = sys.hitLocations ?? {};

    if (armorClass === "none") return new Set();

    const catLocs = ARMOR_CATEGORY_TO_LOCATIONS[category] ?? null;
    if (catLocs) return new Set(catLocs);

    // Legacy compatibility fallback for uncategorized pieces.
    return new Set(ARMOR_LOCATION_KEYS.filter(k => hitLocs?.[k] === true));
  };

  const actorData = actor.system;

  // Track base vs AE modifier contributions so the chat report can attribute reductions to effects.
  let armor = 0;
  let resistance = 0;
  // RAW: Natural Toughness reduces incoming damage of all types and functions like AR but is not armor.
  let toughness = Number(actorData.resistance?.natToughness ?? 0);
  let coverageClass = "none";

  const base = { armor: 0, resistance: 0, toughness };
  const ae = {
    armorRating: {
      global: { total: 0, entries: [] },
      location: { key: propertyName, total: 0, entries: [] },
    },
    resistance: { key: null, total: 0, entries: [] },
    natToughness: { total: 0, entries: [] },
  };

  // PHYSICAL: armor by hitLocation + natToughness
  if (damageType === DAMAGE_TYPES.PHYSICAL) {
    const equippedArmor = actor.items?.filter((i) => i.type === "armor" && i.system?.equipped === true) ?? [];
    const wallBonus = getWallOfSteelArmorItemBonus(actor);

    for (const item of equippedArmor) {
      // Shields do not contribute AR; they are handled via Block in later steps.
      if (item.system?.isShield) continue;
      if (ignoreNonMagicArmor && !isItemMagicSource(item)) continue;

      const covered = getCoveredLocations(item, propertyName);
      if (!covered.has(propertyName)) continue;
      
      const resolvedArmorClass = resolveArmorClass(item.system, propertyName);
      if (resolvedArmorClass === "none") continue;
      
      if (resolvedArmorClass === "full") {
        coverageClass = "full";
      } else if (coverageClass !== "full") {
        coverageClass = "partial";
      }

      // Automation should always prefer derived effective values.
      let ar = (item.system?.armorEffective != null)
        ? Number(item.system.armorEffective)
        : Number(item.system?.armor ?? 0);

      // RAW: While Prone, treat FULL armor as PARTIAL.
      // Implement as a derived-value override at damage time (no item mutation).
      // This ensures AR follows the partial profile even if armorEffective was derived as full.
      if (isProneForArmor) {
        const sys = item.system ?? {};
        const armorClassBeforeProne = resolveArmorClass(sys, propertyName, { applyProne: false });
        if (armorClassBeforeProne === "full") {
          const materialKey = String(sys.material || "").trim();
          const partialProfile = UESRPG?.ARMOR_PROFILES?.partial?.[materialKey] ?? null;

          if (partialProfile && partialProfile.ar != null) {
            const qs = Array.isArray(sys.qualitiesStructured) ? sys.qualitiesStructured : [];
            const damagedQ = qs.find(q => String(q?.key ?? "").toLowerCase() === "damaged");
            const damagedValue = Number(damagedQ?.value ?? 0) || 0;
            ar = Math.max(0, Number(partialProfile.ar) - damagedValue);
          }
        }
      }

      const locDamaged = getLocationDamagedValue(item.system, propertyName);
      if (locDamaged > 0) ar = Math.max(0, ar - locDamaged);

      // Wall of Steel (Chapter 4): +1 AR to any worn armor.
      if (wallBonus) ar += wallBonus;

      armor += Number.isFinite(ar) ? ar : 0;
    }

    base.armor = armor;

    // RAW: Physical resistance is separate from Natural Toughness and reduces physical damage like other resistances.
    resistance = Number(actorData.resistance?.physicalR ?? 0);
    base.resistance = resistance;

  } else {
    // NON-PHYSICAL:
    //  - Resistance always applies.
    //  - Armor usually does NOT mitigate magic/elemental damage.
    //    However, when armor has explicit magic/elemental reduction lanes, it mitigates accordingly.
    //    Schema (armor items):
    //      - system.magic_ar (generic magic AR; intended for "magic" damage)
    //      - system.special_ar_type + system.special_ar (typed mitigation; e.g. fire/frost/shock)
    //    These reductions are location-based and use the same deterministic coverage resolver.

    const equippedArmor = actor.items?.filter((i) => i.type === "armor" && i.system?.equipped === true) ?? [];
    const dtLower = String(damageType ?? "").toLowerCase();

    for (const item of equippedArmor) {
      // Shields do not contribute AR; they are handled via Block in later steps.
      if (item.system?.isShield) continue;

      const covered = getCoveredLocations(item, propertyName);
      if (!covered.has(propertyName)) continue;

      const sys = item.system ?? {};

      // Typed mitigation (elemental, poison, etc.)
      const specialType = String(sys.special_ar_type ?? "").toLowerCase();
      let specialAR = Number(sys.special_arEffective ?? sys.special_ar ?? 0);
      const locDamaged = getLocationDamagedValue(sys, propertyName);
      if (locDamaged > 0) specialAR = Math.max(0, specialAR - locDamaged);
      if (specialType && specialType === dtLower && Number.isFinite(specialAR) && specialAR) {
        armor += Math.max(0, specialAR);
      }

      // Generic magic mitigation lane
      if (dtLower === DAMAGE_TYPES.MAGIC) {
        let magicAR = Number(sys.magic_arEffective ?? sys.magic_ar ?? 0);
        if (locDamaged > 0) magicAR = Math.max(0, magicAR - locDamaged);
        if (Number.isFinite(magicAR) && magicAR) armor += Math.max(0, magicAR);
      }
    }

    base.armor = armor;

    // Resistance lane
    switch (damageType) {
      case DAMAGE_TYPES.FIRE:
        resistance = Number(actorData.resistance?.fireR ?? 0);
        break;
      case DAMAGE_TYPES.FROST:
        resistance = Number(actorData.resistance?.frostR ?? 0);
        break;
      case DAMAGE_TYPES.SHOCK:
        resistance = Number(actorData.resistance?.shockR ?? 0);
        break;
      case DAMAGE_TYPES.POISON:
        resistance = Number(actorData.resistance?.poisonR ?? 0);
        break;
      case DAMAGE_TYPES.MAGIC:
        resistance = Number(actorData.resistance?.magicR ?? 0);
        break;
      case DAMAGE_TYPES.SILVER:
        resistance = Number(actorData.resistance?.silverR ?? 0);
        break;
      case DAMAGE_TYPES.SUNLIGHT:
        resistance = Number(actorData.resistance?.sunlightR ?? 0);
        break;
      default:
        resistance = 0;
    }

    base.resistance = resistance;
  }

  base.toughness = toughness;

  // --- Active Effects: Armor Rating & Resistance modifiers (ADD/OVERRIDE)
  // These are applied deterministically as modifier totals (not absolute armor/resistance replacement).
  // Keys:
  //  - Armor: system.modifiers.combat.armorRating and optional per-location system.modifiers.combat.armorRating.<LocationKey>
  //  - Resistance: system.modifiers.resistance.<resKey> (fireR, frostR, shockR, poisonR, magicR, diseaseR, silverR, sunlightR)
  //  - Nat Toughness: system.modifiers.resistance.natToughness
  try {
    const armorKeys = [
      "system.modifiers.combat.armorRating",
      `system.modifiers.combat.armorRating.${propertyName}`,
    ];
    const armorResult = evaluateAEModifierKeysDetailed(actor, armorKeys);
    const gKey = "system.modifiers.combat.armorRating";
    const lKey = `system.modifiers.combat.armorRating.${propertyName}`;
    const gTotal = Number(armorResult.totalsByKey[gKey] ?? 0) || 0;
    const lTotal = Number(armorResult.totalsByKey[lKey] ?? 0) || 0;
    const gDetail = armorResult.detailsByKey[gKey] ?? { total: 0, contributions: [] };
    const lDetail = armorResult.detailsByKey[lKey] ?? { total: 0, contributions: [] };
    ae.armorRating.global = { total: gTotal, entries: gDetail.contributions ?? [] };
    ae.armorRating.location = { key: propertyName, total: lTotal, entries: lDetail.contributions ?? [] };
    const armorModTotal = gTotal + lTotal;
    if (armorModTotal) armor += armorModTotal;

    // Determine applicable resistance keys for this damage type
    // Support multiple AE key paths for backward compatibility and Chapter 4 expansion:
    // 1. Legacy: system.modifiers.resistance.<resKey> (existing)
    // 2. New: system.resistances.<type> (Chapter 4)
    // 3. New: system.traits.resistance.<type> (Chapter 4 trait-specific)
    const resKeyByType = {
      [DAMAGE_TYPES.PHYSICAL]: { legacy: "physicalR", resistances: null, traits: "physical" },
      [DAMAGE_TYPES.FIRE]: { legacy: "fireR", resistances: null, traits: "fire" },
      [DAMAGE_TYPES.FROST]: { legacy: "frostR", resistances: null, traits: "frost" },
      [DAMAGE_TYPES.SHOCK]: { legacy: "shockR", resistances: null, traits: "shock" },
      [DAMAGE_TYPES.POISON]: { legacy: "poisonR", resistances: "poison", traits: "poison" },
      [DAMAGE_TYPES.MAGIC]: { legacy: "magicR", resistances: "magic", traits: null },
      [DAMAGE_TYPES.SILVER]: { legacy: "silverR", resistances: null, traits: null },
      [DAMAGE_TYPES.SUNLIGHT]: { legacy: "sunlightR", resistances: null, traits: null },
    };

    const resKeyMap = (resKeyByType[damageType] ?? null);
    if (resKeyMap) {
      // Collect all applicable resistance AE keys
      const resistanceKeys = [];
      
      // Legacy key (always check for backward compatibility)
      if (resKeyMap.legacy) {
        resistanceKeys.push(`system.modifiers.resistance.${resKeyMap.legacy}`);
      }
      
      // New system.resistances.* keys
      if (resKeyMap.resistances) {
        resistanceKeys.push(`system.resistances.${resKeyMap.resistances}`);
      }
      
      // New system.traits.resistance.* keys
      if (resKeyMap.traits) {
        resistanceKeys.push(`system.traits.resistance.${resKeyMap.traits}`);
      }
      
      // Evaluate all resistance keys and sum them
      if (resistanceKeys.length > 0) {
        const resMods = evaluateAEModifierKeys(actor, resistanceKeys);
        let totalResistance = 0;
        
        for (const rKey of resistanceKeys) {
          const r = resMods[rKey] ?? 0;
          const numericValue = Number(r) || 0;
          totalResistance += numericValue;
        }
        
        ae.resistance.key = resKeyMap.legacy || resKeyMap.resistances || resKeyMap.traits || "unknown";
        ae.resistance.total = totalResistance;
        ae.resistance.entries = []; // Legacy structure preserved for compatibility
        resistance += totalResistance;
      }
    }

    // Natural Toughness modifier applies to all damage types (RAW).
    const tKey = "system.modifiers.resistance.natToughness";
    const toughResult = evaluateAEModifierKeysDetailed(actor, [tKey]);
    const tTotal = Number(toughResult.totalsByKey[tKey] ?? 0) || 0;
    const tDetail = toughResult.detailsByKey[tKey] ?? { total: 0, contributions: [] };
    ae.natToughness.total = tTotal;
    ae.natToughness.entries = tDetail.contributions ?? [];
    toughness += tTotal;
  } catch (err) {
    console.warn("UESRPG | AE armor/resistance modifier evaluation failed", err);
  }

  const total = armor + resistance + toughness;
  return { armor, resistance, toughness, total, penetrated: 0, base, ae, coverage: { class: coverageClass } };
}
