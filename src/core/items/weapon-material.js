import {
  WEAPON_MATERIAL_RULES_MELEE,
  WEAPON_MATERIAL_RULES_RANGED,
  WEAPON_MATERIAL_RULES_SLING,
} from "../constants/equipment.js";
import { hasLegacyQuality, hasStructuredQuality } from "../documents/item-utils.js";

/** Resolve the authored material key without lowercasing away camel-case keys. */
export function resolveWeaponMaterialRule(system = {}) {
  const traits = Array.isArray(system.qualitiesTraits) ? system.qualitiesTraits : [];
  const hasQuality = (key) => traits.some(value => String(value).toLowerCase() === key)
    || hasStructuredQuality(system.qualitiesStructured, key)
    || hasLegacyQuality(system.qualities, key);
  const isSling = hasQuality("sling");
  const isThrown = hasQuality("thrown");
  const useMeleeMaterial = String(system.attackMode ?? "melee").toLowerCase() !== "ranged" || isThrown;
  const table = isSling ? WEAPON_MATERIAL_RULES_SLING
    : (useMeleeMaterial ? WEAPON_MATERIAL_RULES_MELEE : WEAPON_MATERIAL_RULES_RANGED);
  const requested = String(system.material || "iron").trim().toLowerCase();
  const key = Object.keys(table).find(candidate => candidate.toLowerCase() === requested);
  return { key: key ?? null, rule: key ? table[key] : null, isSling, isThrown, useMeleeMaterial };
}
