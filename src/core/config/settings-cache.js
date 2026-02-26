/**
 * src/core/config/settings-cache.js
 *
 * Lightweight snapshot cache for Foundry world settings that are read in hot
 * paths (e.g. actor-sheet _prepareContext on every render).
 *
 * Only caches settings that appear in render/prepare hot paths. Debug settings
 * intentionally stay live-read (see src/utils/debug.js — correctness over speed).
 *
 * Usage:
 *   1. Call initSettingsCache() once during Hooks.once("ready").
 *   2. Register onChange handlers (done in register-settings.js) so the cache
 *      stays in sync when the user changes a setting.
 *   3. In hot paths, replace game.settings.get(NAMESPACE, key) with getCachedSetting(key).
 */

const NAMESPACE = "uesrpg-3ev4";

/** @type {Record<string, any>} */
const _cache = {};

/**
 * Setting keys that live in _prepareContext hot paths and benefit from caching.
 * All others are read live.
 */
const HOT_SETTING_KEYS = [
  "showFeatureInspector",
  "useRawChargenWizard",
];

/**
 * Populate the cache for all hot settings.
 * Call once during Hooks.once("ready"), after settings have been registered.
 */
export function initSettingsCache() {
  for (const key of HOT_SETTING_KEYS) {
    try {
      _cache[key] = game.settings.get(NAMESPACE, key);
    } catch (_e) {
      _cache[key] = undefined;
    }
  }
}

/**
 * Read a cached setting value.
 * Falls back to a live game.settings.get() if the key was not pre-cached.
 *
 * @param {string} key - Setting key (without namespace prefix)
 * @returns {any}
 */
export function getCachedSetting(key) {
  if (Object.prototype.hasOwnProperty.call(_cache, key)) {
    return _cache[key];
  }
  // Safe fallback for non-hot keys
  try {
    return game.settings.get(NAMESPACE, key);
  } catch (_e) {
    return undefined;
  }
}

/**
 * Refresh a single cached setting from the live value.
 * Called from onChange handlers in register-settings.js.
 *
 * @param {string} key
 */
export function invalidateCachedSetting(key) {
  try {
    _cache[key] = game.settings.get(NAMESPACE, key);
  } catch (_e) {
    // leave stale value rather than crashing
  }
}
