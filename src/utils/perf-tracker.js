/**
 * src/utils/perf-tracker.js
 *
 * Structured performance event tracker for UESRPG round-boundary profiling.
 * Gated behind the `timePerformanceDebug` world setting.
 */

import { SYSTEM_ID } from "../core/constants.js";
import { registerReadyRuntimeApi } from "../api/runtime-registration.js";
import {
  recordPerfEntry,
  readPerfEntries,
  resetPerfEntries,
  summarizePerfEntries,
  getPerfHelpText
} from "./perf-tracker-support.js";

const PERF_SETTING = "timePerformanceDebug";

export function isPerfEnabled() {
  try {
    return Boolean(game?.settings?.get?.(SYSTEM_ID, PERF_SETTING));
  } catch (_e) {
    return false;
  }
}

export function monoMs() {
  return performance.now();
}

export function perfRecord(record) {
  if (!isPerfEnabled()) return;
  recordPerfEntry(record);
  const entry = readPerfEntries().at(-1) ?? record;
  try {
    const durStr = entry.durationMs != null
      ? ` | ${Number(entry.durationMs).toFixed(2)}ms`
      : "";
    console.log(`[UESRPG][TimePref] ${String(entry.event ?? "perf")}${durStr}`, entry);
  } catch (_e) {
    /* no-op */
  }
}

export function getPerfRecords() {
  return readPerfEntries();
}

export function resetPerfRecords() {
  resetPerfEntries();
}

export function summarizePerfRecords(records) {
  return summarizePerfEntries(records);
}

export function initializePerfApi() {
  const api = Object.freeze({
    enabled: isPerfEnabled,
    reset: resetPerfRecords,
    records: getPerfRecords,
    summarize: summarizePerfRecords,

    help() {
      console.log(getPerfHelpText(SYSTEM_ID));
    },

    async runBenchmark(n = 5) {
      if (!game.user?.isGM) {
        console.warn("[UESRPG][TimePref] GM required for runBenchmark.");
        return null;
      }
      const combat = game.combat;
      if (!combat?.started) {
        console.warn("[UESRPG][TimePref] No active started combat. Start one first.");
        return null;
      }
      if (!isPerfEnabled()) {
        console.warn(
          `[UESRPG][TimePref] ${PERF_SETTING} is off.\n` +
          `  Enable: game.settings.set('${SYSTEM_ID}', '${PERF_SETTING}', true)`
        );
        return null;
      }

      resetPerfRecords();
      const count = Math.max(1, Math.min(Number(n) || 5, 50));
      console.log(`[UESRPG][TimePref] Benchmark: running ${count} Next Turn advance(s)...`);

      const t0 = performance.now();
      for (let i = 0; i < count; i++) {
        await combat.nextTurn();
        await new Promise(r => setTimeout(r, 150));
      }
      const elapsed = performance.now() - t0;

      const summary = summarizePerfRecords();
      console.log(
        `[UESRPG][TimePref] Benchmark complete - ${count} advance(s) in ${elapsed.toFixed(1)}ms total`
      );
      console.table(summary);
      return { elapsed, summary, records: getPerfRecords() };
    }
  });

  registerReadyRuntimeApi({ rootApi: { perf: api } });
  return api;
}
