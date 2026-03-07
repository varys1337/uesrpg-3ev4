/**
 * src/core/conditions/constants.js
 *
 * Shared constants for the conditions subsystem.
 * Centralizes namespace/flag strings to prevent drift across conditions modules.
 */

/** System flag scope — must remain "uesrpg-3ev4" to match all stored flag data. */
export { FLAG_SCOPE } from "../system/namespace.js";

/** Returns the current game system ID for settings access (avoids hardcoding). */
export { getRuntimeSystemId as getSystemId } from "../system/namespace.js";
