import { getWeaponReachBoundsEffective } from "../reach-length/weapon.js";

/**
 * Check if an item is an equipped melee weapon.
 * @param {Item} item
 * @returns {boolean}
 */
export function isMeleeWeapon(item) {
  if (!item) return false;
  if (item.type !== "weapon") return false;

  const mode = item.system?.attackMode ?? item.system?.mode;
  if (String(mode ?? "").toLowerCase() !== "melee") return false;

  return Boolean(item.system?.equipped);
}

/**
 * Resolve effective reach bounds for a weapon in scene units.
 * @param {Item} weapon
 * @returns {{max:number,min:number}}
 */
export function getWeaponReachBoundsUnits(weapon) {
  const { min, max } = getWeaponReachBoundsEffective(weapon);
  return { max: Math.max(0, max), min: Math.max(0, min) };
}

/**
 * Select the equipped melee weapon with the greatest effective max reach.
 * @param {Actor} actor
 * @returns {{weapon: Item|null, bounds: {max:number,min:number}}}
 */
export function getLongestEquippedMeleeWeapon(actor) {
  const weapons = actor?.items?.filter(isMeleeWeapon) ?? [];
  if (!weapons.length) return { weapon: null, bounds: { max: 0, min: 0 } };

  let best = weapons[0];
  let bestBounds = getWeaponReachBoundsUnits(best);

  for (const weapon of weapons.slice(1)) {
    const bounds = getWeaponReachBoundsUnits(weapon);
    if (bounds.max > bestBounds.max) {
      best = weapon;
      bestBounds = bounds;
    }
  }

  return { weapon: best, bounds: bestBounds };
}
