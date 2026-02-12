/**
 * src/core/characteristics/opposed/constants.js
 * Shared constants for characteristic opposed workflow
 */

export const FLAG_NS = "uesrpg-3ev4";
export const FLAG_KEY = "charOpposed";
export const CARD_VERSION = 1;

/** Valid characteristic keys */
export const CHARACTERISTICS = Object.freeze({
  str: "Strength",
  end: "Endurance",
  agi: "Agility",
  int: "Intelligence",
  wp: "Willpower",
  prc: "Perception",
  prs: "Personality",
  lck: "Luck"
});

// Banked-choice automation locks (prevents duplicate auto-roll from multiple hook triggers).
export const bankedAutoRollLocalLocks = new Set();
