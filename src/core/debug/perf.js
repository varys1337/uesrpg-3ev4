/**
 * src/core/debug/perf.js
 *
 * Lightweight, debug-gated performance helpers.
 *
 * This module is a no-op unless the client setting "sheetPerfTrace" is enabled.
 */

const NAMESPACE = "uesrpg-3ev4";

export function isSheetPerfTraceEnabled() {
  try {
    return Boolean(game?.settings?.get?.(NAMESPACE, "sheetPerfTrace"));
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
