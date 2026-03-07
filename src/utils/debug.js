/**
 * src/utils/debug.js
 * Centralized debug-gating helpers for UESRPG.
 */
import { SYSTEM_ID } from "../core/constants.js";

const DEBUG_NAMESPACE = SYSTEM_ID;
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

function _resolveConsoleMethod(method = "log") {
  const resolved = console?.[method];
  if (typeof resolved === "function") return resolved.bind(console);
  return console.log.bind(console);
}

function _createDebugLogger(settingKey, prefix = "", method = "log") {
  const write = _resolveConsoleMethod(method);
  if (prefix) {
    return function _debug(...args) {
      if (!isDebugEnabled(settingKey)) return;
      try { write(prefix, ...args); } catch (_e) { /* no-op */ }
    };
  }
  return function _debug(...args) {
    if (!isDebugEnabled(settingKey)) return;
    try { write(...args); } catch (_e) { /* no-op */ }
  };
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
  return _createDebugLogger(settingKey, prefix, "log");
}

/**
 * Create a debug logger gated by a Foundry setting that preserves the chosen
 * console severity for existing module-local wrappers.
 *
 * @param {string} settingKey
 * @param {string} [prefix=""]
 * @param {"log"|"debug"|"warn"} [method="log"]
 * @returns {function(...*): void}
 */
export function createSeverityDebugLogger(settingKey, prefix = "", method = "log") {
  return _createDebugLogger(settingKey, prefix, method);
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
