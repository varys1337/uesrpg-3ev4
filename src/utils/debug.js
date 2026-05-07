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

/**
 * Create a small subsystem logger. Routine debug output is gated; warnings and
 * errors remain visible because they describe recoverable or blocking failures.
 *
 * @param {string} prefix
 * @param {object} [options]
 * @param {string|null} [options.debugSettingKey]
 * @param {Function|null} [options.debugEnabled]
 * @returns {{debug: Function, info: Function, warn: Function, error: Function}}
 */
export function createLogger(prefix, { debugSettingKey = null, debugEnabled = null } = {}) {
  const label = String(prefix ?? "").trim();
  const lead = label || "UESRPG";
  const canDebug = () => {
    if (typeof debugEnabled === "function") {
      try {
        return Boolean(debugEnabled());
      } catch (_e) {
        return false;
      }
    }
    return isDebugEnabled(debugSettingKey);
  };

  return {
    debug(...args) {
      if (!canDebug()) return;
      try { console.debug(lead, ...args); } catch (_e) { /* no-op */ }
    },
    info(...args) {
      try { console.info(lead, ...args); } catch (_e) { /* no-op */ }
    },
    warn(...args) {
      try { console.warn(lead, ...args); } catch (_e) { /* no-op */ }
    },
    error(...args) {
      try { console.error(lead, ...args); } catch (_e) { /* no-op */ }
    },
  };
}

// ─── Performance profiling helpers ───────────────────────────────────
// Gated behind the "perf" debug lane (requires master + perfDebug setting).
// When disabled, these are zero-overhead no-ops.

export function isSheetPerfTraceEnabled() {
  try {
    if (!_settingExists("sheetPerfTrace")) return false;
    return Boolean(game?.settings?.get?.(DEBUG_NAMESPACE, "sheetPerfTrace"));
  } catch (_e) {
    return false;
  }
}

/**
 * Emit a structured sheet performance trace line.
 *
 * @param {object} params
 * @param {string} params.sheet - Sheet/app name
 * @param {ClientDocument|null} params.document - Backing document (Actor/Item)
 * @param {string} params.stage - Lifecycle stage label
 * @param {number} params.startedAtMs - performance.now() start time
 * @param {object} [params.details] - Extra fields to include
 * @param {number|null} [params.warnThresholdMs] - Warn if elapsed exceeds threshold
 */
export function traceSheetPerf({ sheet, document, stage, startedAtMs, details = {}, warnThresholdMs = null }) {
  if (!isSheetPerfTraceEnabled()) return;

  const elapsedMs = Number((performance.now() - startedAtMs).toFixed(2));
  const payload = {
    sheet,
    documentId: document?.id ?? null,
    documentName: document?.name ?? null,
    documentType: document?.type ?? null,
    stage,
    elapsedMs,
    ...details,
  };

  const line = `UESRPG | sheetPerfTrace ${JSON.stringify(payload)}`;
  if (warnThresholdMs !== null && elapsedMs > warnThresholdMs) console.warn(line);
  else console.log(line);
}

/**
 * Convenience wrapper for timing an async operation.
 *
 * @param {string} label
 * @param {Function} fn
 * @returns {Promise<*>}
 */
export async function perfTime(label, fn) {
  if (!isSheetPerfTraceEnabled()) return await fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const elapsedMs = Number((performance.now() - t0).toFixed(2));
    console.log(`UESRPG | perfTime ${label} ${elapsedMs}ms`);
  }
}

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
