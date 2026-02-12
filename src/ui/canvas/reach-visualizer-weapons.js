/**
 * src/ui/canvas/reach-visualizer-weapons.js
 *
 * Active melee weapon detection for reach visualizer.
 * - Determines which equipped melee weapon to display reach for
 * - Supports "max equipped" and "last used" modes
 * - Integrates with reach-visualizer-state for last-used tracking
 *
 * Foundry VTT v13.351 compatible.
 */

import { getLastMeleeWeaponForActor } from "./reach-visualizer-state.js";

/* -------------------------------------------- */
/* Weapon Detection                             */
/* -------------------------------------------- */

/**
 * Check if an item is an equipped melee weapon.
 * @param {Item} item
 * @returns {boolean}
 */
export function isMeleeWeapon(item) {
  if (!item) return false;
  if (item.type !== "weapon") return false;

  // System-specific melee selector:
  // - primary: system.attackMode === "melee" (as per item menu)
  // - fallback: system.mode === "melee"
  const mode = item.system?.attackMode ?? item.system?.mode;
  if (String(mode ?? "").toLowerCase() !== "melee") return false;

  const equipped = Boolean(item.system?.equipped);
  return equipped;
}

/**
 * Get the reach bounds (max and min) from a weapon item.
 * @param {Item} weapon
 * @returns {{max: number, min: number}}
 */
export function getWeaponReachBoundsUnits(weapon) {
  const max = Number(weapon?.system?.reach ?? 0);
  const min = Number(weapon?.system?.reachMin ?? 0);
  return { max: Math.max(0, max), min: Math.max(0, min) };
}

/**
 * Determine the "active" melee weapon for an actor based on reach source setting.
 * Returns null weapon if no equipped melee weapons exist.
 *
 * @param {Actor} actor
 * @param {string} reachSource - Either "maxEquipped" or "lastUsed"
 * @returns {{weapon: Item|null, bounds: {max:number, min:number}}}
 */
export function getActiveMeleeWeapon(actor, reachSource) {
  const weapons = actor?.items?.filter(isMeleeWeapon) ?? [];
  if (!weapons.length) return { weapon: null, bounds: { max: 0, min: 0 } };

  if (reachSource === "lastUsed") {
    const lastId = getLastMeleeWeaponForActor(actor.id);
    const lastWeapon = lastId ? weapons.find(w => w.id === lastId) : null;
    if (lastWeapon) return { weapon: lastWeapon, bounds: getWeaponReachBoundsUnits(lastWeapon) };
  }

  // Default (maxEquipped): pick the equipped melee weapon with the highest reach.
  let best = weapons[0];
  let bestBounds = getWeaponReachBoundsUnits(best);

  for (const w of weapons.slice(1)) {
    const b = getWeaponReachBoundsUnits(w);
    if (b.max > bestBounds.max) {
      best = w;
      bestBounds = b;
    }
  }

  return { weapon: best, bounds: bestBounds };
}
