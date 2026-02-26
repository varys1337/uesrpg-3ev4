/**
 * src/core/system/homebrew.js
 *
 * Shared helpers for reading Homebrew world settings.
 * Guards safely against early calls before game.settings is available.
 */

const NAMESPACE = "uesrpg-3ev4";

/**
 * Returns true when the homebrew Speed formula (SB + AB) is enabled.
 * @returns {boolean}
 */
export function isSpeedFormulaSBABEnabled() {
  try {
    return Boolean(game.settings?.get(NAMESPACE, "homebrew.speedFormulaSBAB"));
  } catch {
    return false;
  }
}

/**
 * Returns the Agility Bonus multiplier for the Speed base formula.
 * - RAW (default): 2  →  speed.base = SB + (2 × AB) + bonus
 * - Homebrew:      1  →  speed.base = SB + AB + bonus
 * @returns {1|2}
 */
export function getSpeedAgiMultiplier() {
  return isSpeedFormulaSBABEnabled() ? 1 : 2;
}
