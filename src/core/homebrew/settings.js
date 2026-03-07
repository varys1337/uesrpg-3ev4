import { SYSTEM_ID } from "../constants.js";

export const HOMEBREW_NAMESPACE = SYSTEM_ID;

export function getHomebrewSetting(key, fallback) {
  try {
    if (!game?.settings || typeof game.settings.get !== "function") return fallback;
    const value = game.settings.get(HOMEBREW_NAMESPACE, key);
    return value === undefined ? fallback : value;
  } catch (_e) {
    return fallback;
  }
}

export function getHomebrewSnapshot(keys, { fallback } = {}) {
  const out = {};
  const list = Array.isArray(keys) ? keys : [];
  for (const key of list) {
    out[key] = getHomebrewSetting(key, fallback);
  }
  return out;
}

/**
 * Returns true when the homebrew Speed formula (SB + AB) is enabled.
 * @returns {boolean}
 */
export function isSpeedFormulaSBABEnabled() {
  return Boolean(getHomebrewSetting("homebrew.speedFormulaSBAB", false));
}

/**
 * Returns the Agility Bonus multiplier for the Speed base formula.
 * - RAW (default): 2  ->  speed.base = SB + (2 x AB) + bonus
 * - Homebrew:      1  ->  speed.base = SB + AB + bonus
 * @returns {1|2}
 */
export function getSpeedAgiMultiplier() {
  return isSpeedFormulaSBABEnabled() ? 1 : 2;
}

/**
 * Returns true when the Reach & Length Overhaul homebrew is enabled.
 * @returns {boolean}
 */
export function isReachLengthHomebrewEnabled() {
  return Boolean(getHomebrewSetting("homebrew.reachLength.enabled", false));
}

/**
 * Returns the active reach model: "classic" | "simplified".
 * Falls back to "classic" if settings are unavailable.
 * @returns {"classic"|"simplified"}
 */
export function getReachLengthModel() {
  return getHomebrewSetting("homebrew.reachLength.reachModel", "classic");
}

/**
 * Returns true when Length Advantage bonuses are attacker-only.
 * When enabled, defender-side positive Length modifiers are suppressed.
 * @returns {boolean}
 */
export function isReachLengthAttackerAdvantageOnlyEnabled() {
  return Boolean(getHomebrewSetting("homebrew.reachLength.attackerAdvantageOnly", false));
}

/**
 * Returns true when Engagement & Flanking homebrew is enabled.
 * @returns {boolean}
 */
export function isEngagementFlankingHomebrewEnabled() {
  return Boolean(getHomebrewSetting("homebrew.engagementFlanking.enabled", false));
}

/**
 * Returns true when Engagement & Flanking should only run during active combat.
 * @returns {boolean}
 */
export function isEngagementFlankingOnlyInCombat() {
  return Boolean(getHomebrewSetting("homebrew.engagementFlanking.onlyInCombat", true));
}
