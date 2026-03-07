/**
 * @file Combat system constants to reduce string literal duplication.
 * @module constants
 * 
 * Usage Guidelines:
 * - For runtime system ID with fallback: use util._getSystemId()
 * - For settings.get() calls: use SYSTEM_ID constant
 * - For flag access: prefer util._opposedFlags() or use hardcoded strings
 *   (flag paths are stable and changing them would break saved data)
 */

/** System identifier — re-exported from canonical namespace */
export { SYSTEM_ID } from "../../system/namespace.js";

/** Opposed workflow message flag keys */
export const FLAGS = {
  OPPOSED: "opposed",
  OPPOSED_PARENT: "opposedParent",
  PENDING_AMMO: "pendingAmmo"
};

/** Combat tracking flag keys */
export const COMBAT_FLAGS = {
  ATTACK_COUNT: "attackCount",
  TURN_COUNT: "turnCount"
};
