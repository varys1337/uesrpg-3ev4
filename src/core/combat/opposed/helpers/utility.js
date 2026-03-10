/**
 * src/core/combat/opposed/helpers/utility.js
 *
 * Shield helpers and shared damage payload utilities.
 * Phase 18.4 extraction - small self-contained helpers.
 */
import {
  listEquippedShields as listEquippedShieldsCanonical,
  hasEquippedShieldType as hasEquippedShieldTypeCanonical,
} from "../../../items/shield-utils.js";

/**
 * Enumerate equipped shields on an actor (excludes bucklers for blocking RAW).
 */
export function listEquippedShields(actor) {
  return listEquippedShieldsCanonical(actor, { includeBuckler: false, allowLegacy: true });
}

/**
 * Check if actor has an equipped shield of a specific type (normal/buckler/tower).
 */
export function hasEquippedShieldType(actor, typeKey) {
  return hasEquippedShieldTypeCanonical(actor, typeKey, { allowLegacy: true });
}

/**
 * Serialize damage data for multi-defender sharing (reuse same roll across defenders).
 */
export function buildSharedDamagePayload({ mode, dmg, weaponUuid = null, damageType = null } = {}) {
  if (!mode || !dmg) return null;
  return {
    mode,
    weaponUuid: weaponUuid ?? null,
    damageType: damageType ?? null,
    damageString: dmg.damageString ?? "0",
    finalDamage: Number(dmg.finalDamage ?? 0) || 0,
    rollATotal: Number(dmg.rollA?.total ?? NaN),
    rollBTotal: Number(dmg.rollB?.total ?? NaN),
    rerollMode: dmg.rerollMode ?? null,
    damagedValue: dmg.damagedValue ?? null,
    usedAltDamage: Boolean(dmg.usedAltDamage)
  };
}

/**
 * Deserialize shared damage payload (inflates without roll objects).
 */
export function inflateSharedDamage(shared) {
  if (!shared) return null;
  return {
    damageString: shared.damageString ?? "0",
    finalDamage: Number(shared.finalDamage ?? 0) || 0,
    rollA: null,
    rollB: null,
    rerollMode: shared.rerollMode ?? null,
    damagedValue: shared.damagedValue ?? null,
    usedAltDamage: Boolean(shared.usedAltDamage)
  };
}
