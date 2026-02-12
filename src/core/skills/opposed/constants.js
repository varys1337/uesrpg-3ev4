/**
 * src/core/skills/opposed/constants.js
 * Shared constants for skill opposed workflow
 */

export const SKILL_ROLL_SETTINGS_NS = "uesrpg-3ev4";
export const FLAG_NS = "uesrpg-3ev4";
export const FLAG_KEY = "skillOpposed";
export const CARD_VERSION = 1;
export const SKILL_ROLL_LAST_OPTIONS_KEY = "skillRollLastOptions";
export const DEFAULT_COMBAT_STYLE_DEFENSE_TYPE = "parry";

// Banked-choice (meta-limiting) automation locks.
// Prevents duplicate auto-roll starts from multiple hook triggers.
export const bankedAutoRollLocalLocks = new Set();
