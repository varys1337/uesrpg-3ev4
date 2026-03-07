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
import {
  isMeleeWeapon,
  getWeaponReachBoundsUnits,
  getLongestEquippedMeleeWeapon
} from "../../core/homebrew/engagement-flanking/equipped-weapons.js";

/* -------------------------------------------- */
/* Weapon Detection                             */
/* -------------------------------------------- */

export { isMeleeWeapon, getWeaponReachBoundsUnits, getLongestEquippedMeleeWeapon };

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
  return getLongestEquippedMeleeWeapon(actor);
}
