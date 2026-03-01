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

// ── Reach & Length Overhaul ──────────────────────────────────────────────────

/**
 * Returns true when the Reach & Length Overhaul homebrew is enabled.
 * @returns {boolean}
 */
export function isReachLengthHomebrewEnabled() {
  try {
    return Boolean(game.settings?.get(NAMESPACE, "homebrew.reachLength.enabled"));
  } catch {
    return false;
  }
}

/**
 * Returns the active reach model: "classic" | "simplified".
 * Falls back to "classic" if settings are unavailable.
 * @returns {"classic"|"simplified"}
 */
export function getReachLengthModel() {
  try {
    return game.settings?.get(NAMESPACE, "homebrew.reachLength.reachModel") ?? "classic";
  } catch {
    return "classic";
  }
}

/**
 * Returns true when Engagement & Flanking homebrew is enabled.
 * @returns {boolean}
 */
export function isEngagementFlankingHomebrewEnabled() {
  try {
    return Boolean(game.settings?.get(NAMESPACE, "homebrew.engagementFlanking.enabled"));
  } catch {
    return false;
  }
}

/**
 * Returns true when Engagement & Flanking should only run during active combat.
 * @returns {boolean}
 */
export function isEngagementFlankingOnlyInCombat() {
  try {
    return Boolean(game.settings?.get(NAMESPACE, "homebrew.engagementFlanking.onlyInCombat"));
  } catch {
    return true;
  }
}
