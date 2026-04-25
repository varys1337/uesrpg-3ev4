/**
 * Canonical derivation layer for combat-facing item classification.
 *
 * This module is intentionally items-focused and does not depend on the opposed workflow.
 * Combat code (when resumed) should consume ONLY this context object.
 */
import { isShieldItem } from "../items/shield-utils.js";
import { getWeaponCombatCapabilities } from "../combat/combat-utils.js";

/**
 * @typedef {Object} AttackContext
 * @property {"melee"|"ranged"} attackMode
 * @property {boolean} isWeapon
 * @property {boolean} isShield
 * @property {boolean} canParry
 * @property {boolean} canCounter
 * @property {boolean} canBlock
 */

/**
 * Derive the attack/defense context from a single item.
 *
 * @param {Item} item
 * @param {Actor} [actor] - reserved for later RAW exceptions (talents/traits).
 * @returns {AttackContext}
 */
export function getAttackContext(item, actor = null) {
  const sys = item?.system ?? {};

  const isWeapon = item?.type === "weapon";
  const isShield = isShieldItem(item, { allowLegacy: true });

  const capabilities = isWeapon ? getWeaponCombatCapabilities(item) : null;
  /** @type {"melee"|"ranged"} */
  const attackMode = capabilities?.attackMode === "ranged" ? "ranged" : "melee";

  // Minimal RAW gating (can be expanded later once Chapter 7 qualities/materials are modeled).
  // Prefer explicit item flags if present; otherwise default based on attackMode.
  const canParry = isWeapon
    ? (Object.prototype.hasOwnProperty.call(sys, "canParry") ? !!sys.canParry : capabilities.meleeCapable)
    : false;
  const canCounter = isWeapon
    ? (Object.prototype.hasOwnProperty.call(sys, "canCounter") ? !!sys.canCounter : capabilities.meleeCapable)
    : false;
  const canBlock = isShield;

  return {
    attackMode,
    isWeapon,
    isShield,
    canParry,
    canCounter,
    canBlock
  };
}
