/**
 * @module traits/weapon-expertise
 * @description Barrel export for the Weapon Expertise talent automation module.
 * All public API surfaces are re-exported here.
 */

// Data definitions
export { WEAPON_EXPERTISE, normalizeWeaponName, getWeaponExpertiseSlugs } from "./weapon-expertise-map.js";

// Helpers
export {
  resolveWeaponKey,
  weaponMatchesAny,
  weaponMatchesTalent,
  attackModeMatchesTalent,
  isWeaponExpertiseActive,
  getActiveWeaponExpertise,
  isWeaponThrown,
  isWeaponHandToHand,
  isWeaponDueling,
  getCharBonus
} from "./weapon-expertise-helpers.js";

// Handlers (interceptors)
export {
  applyWeaponExpertiseAttackerPreTN,
  applyWeaponExpertiseDamageModifiers,
  applyWeaponExpertisePostDamageEffects,
  getWeaponExpertiseWTDelta,
  collectWeaponExpertiseNotes
} from "./weapon-expertise-handlers.js";
