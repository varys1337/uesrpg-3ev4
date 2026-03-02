/**
 * src/utils/debug.js
 * Centralized debug-gating helpers for UESRPG.
 */

const DEBUG_NAMESPACE = "uesrpg-3ev4";
const DEBUG_MASTER_SETTING = "debugEnabled";

function _settingExists(key) {
  try {
    return game?.settings?.settings?.has?.(`${DEBUG_NAMESPACE}.${key}`) !== false;
  } catch (_e) {
    return false;
  }
}

function _getSettingBool(key, fallback = false) {
  try {
    if (!_settingExists(key)) return fallback;
    return Boolean(game?.settings?.get?.(DEBUG_NAMESPACE, key));
  } catch (_e) {
    return fallback;
  }
}

/**
 * Master debug gate.
 * When disabled, all debug lanes are suppressed.
 */
function isDebugMasterEnabled() {
  return _getSettingBool(DEBUG_MASTER_SETTING, false);
}

/**
 * Check whether a specific debug lane is enabled.
 * Requires the master gate and lane toggle.
 *
 * @param {string|null} laneSettingKey
 * @param {{runtimeToggle?: boolean}} options
 * @returns {boolean}
 */
export function isDebugEnabled(laneSettingKey = null, { runtimeToggle = false } = {}) {
  if (!isDebugMasterEnabled()) return false;
  if (runtimeToggle === true) return true;
  if (!laneSettingKey) return true;
  return _getSettingBool(String(laneSettingKey), false);
}

/**
 * True when any lane in the list is enabled (while master is enabled).
 *
 * @param {string[]} laneSettingKeys
 * @returns {boolean}
 */
export function isAnyDebugEnabled(laneSettingKeys = []) {
  if (!isDebugMasterEnabled()) return false;
  for (const key of laneSettingKeys) {
    if (_getSettingBool(String(key), false)) return true;
  }
  return false;
}

/**
 * Create a debug-log function gated by a Foundry world setting.
 *
 * Usage:
 * ```js
 * const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][Dispel]");
 * _debug("checking targets", targets);  // only logs when setting is on
 * ```
 *
 * @param {string} settingKey - Debug setting key registered via `game.settings`
 *                              (e.g. `"debugMagicRouting"`, `"aeLifecycleDebug"`)
 * @param {string} [prefix=""] - Console prefix (e.g. `"[UESRPG][Dispel]"`)
 * @returns {function(...*): void} A `_debug(...)` function
 */
export function createDebugLogger(settingKey, prefix = "") {
  if (prefix) {
    return function _debug(...args) {
      if (!isDebugEnabled(settingKey)) return;
      try { console.log(prefix, ...args); } catch (_e) { /* no-op */ }
    };
  }
  return function _debug(...args) {
    if (!isDebugEnabled(settingKey)) return;
    try { console.log(...args); } catch (_e) { /* no-op */ }
  };
}

// ─── Performance profiling helpers ───────────────────────────────────
// Gated behind the "perf" debug lane (requires master + perfDebug setting).
// When disabled, these are zero-overhead no-ops.

const _PERF_SETTING = "perfDebug";

/**
 * Start a performance timing label.
 * Only logs when the `perfDebug` debug lane is enabled.
 *
 * @param {string} label - Timer label for `console.time`
 */
export function perfStart(label) {
  if (!isDebugEnabled(_PERF_SETTING)) return;
  try { console.time(`[UESRPG][perf] ${label}`); } catch (_e) { /* no-op */ }
}

/**
 * End a performance timing label.
 * Only logs when the `perfDebug` debug lane is enabled.
 *
 * @param {string} label - Timer label for `console.timeEnd`
 */
export function perfEnd(label) {
  if (!isDebugEnabled(_PERF_SETTING)) return;
  try { console.timeEnd(`[UESRPG][perf] ${label}`); } catch (_e) { /* no-op */ }
}
