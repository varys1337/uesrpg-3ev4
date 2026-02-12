/**
 * src/core/combat/opposed/helpers/utility.js
 *
 * Shield helpers and shared damage payload utilities.
 * Phase 18.4 extraction - small self-contained helpers.
 */

/**
 * Enumerate equipped shields on an actor (excludes bucklers for blocking RAW).
 */
export function listEquippedShields(actor) {
  if (!actor?.items) return [];
  // Shields are modeled as Armor items with the "Is Shield" toggle enabled.
  // Do not infer shield-ness from blockRating, since BR is now derived (effective) and may not be persisted.
  return [...(actor.itemTypes?.armor ?? []), ...(actor.itemTypes?.item ?? [])].filter(i => {
    if (i.system?.equipped !== true) return false;
    if (!Boolean(i.system?.isShieldEffective ?? i.system?.isShield)) return false;

    // RAW: bucklers cannot be used to Block.
    const shieldType = String(i.system?.shieldType || "normal").toLowerCase();
    if (shieldType === "buckler") return false;

    return true;
  });
}

/**
 * Check if actor has an equipped shield of a specific type (normal/buckler/tower).
 */
export function hasEquippedShieldType(actor, typeKey) {
  const target = String(typeKey ?? "").toLowerCase();
  if (!target) return false;
  return (actor?.items ?? []).some(i => {
    if (i.type !== "armor") return false;
    if (i.system?.equipped !== true) return false;
    const isShield = Boolean(i.system?.isShieldEffective ?? i.system?.isShield);
    if (!isShield && String(i.system?.item_cat ?? "").toLowerCase() !== "shield") return false;
    const shieldType = String(i.system?.shieldType ?? "normal").toLowerCase();
    return shieldType === target;
  });
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
