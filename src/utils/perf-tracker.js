/**
 * src/utils/perf-tracker.js
 *
 * Structured performance event tracker for UESRPG round-boundary profiling.
 * Gated behind the `timePerformanceDebug` world setting.
 *
 * Design:
 *  - Ring buffer holds the last BUFFER_SIZE records (oldest entry silently overwritten).
 *  - Monotonic timing via performance.now() for elapsed intervals.
 *  - Wall-clock Date.now() stored for log readability only.
 *  - Intentionally independent of the debug master gate so perf recording can
 *    be toggled in isolation without enabling all other debug lanes.
 *  - Zero overhead when disabled: isPerfEnabled() is a single settings read, and
 *    every instrumented call-site is guarded by it.
 *
 * Usage:
 *   1. Enable:  game.settings.set("uesrpg-3ev4", "timePerformanceDebug", true)
 *   2. Advance one or more rounds in combat.
 *   3. game.uesrpg.perf.summarize()    — mean/max/p95 by event name
 *   4. game.uesrpg.perf.records()      — raw event records
 *   5. game.uesrpg.perf.runBenchmark(5)— automated N-turn benchmark
 *   6. game.uesrpg.perf.help()         — full command reference
 *
 * Target: Foundry VTT v13.351
 */

import { SYSTEM_ID } from "../core/constants.js";

const PERF_SETTING = "timePerformanceDebug";

/** Maximum number of event records kept in the ring buffer. */
const BUFFER_SIZE = 500;

// ─── Ring Buffer ──────────────────────────────────────────────────────────────

/** @type {(object|null)[]} */
const _buf = new Array(BUFFER_SIZE).fill(null);

/** Points to the next write slot (mod BUFFER_SIZE). */
let _head = 0;

/** Total records emitted since last reset (may exceed BUFFER_SIZE). */
let _total = 0;

// ─── Gate ─────────────────────────────────────────────────────────────────────

/**
 * Returns true when the `timePerformanceDebug` world setting is enabled.
 *
 * Intentionally independent of `isDebugMasterEnabled()` so that perf recording
 * can be activated without enabling all other debug lanes.
 *
 * @returns {boolean}
 */
export function isPerfEnabled() {
  try {
    return Boolean(game?.settings?.get?.(SYSTEM_ID, PERF_SETTING));
  } catch (_e) {
    return false;
  }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

/**
 * Monotonic high-resolution timestamp in milliseconds.
 * Use for elapsed-interval measurement; never for absolute wall-clock times.
 *
 * @returns {number}
 */
export function monoMs() {
  return performance.now();
}

// ─── Record Emission ──────────────────────────────────────────────────────────

/**
 * Emit a structured perf record into the ring buffer.
 * Also logs to console so phase completions are immediately visible in DevTools.
 * No-op when `timePerformanceDebug` is disabled.
 *
 * Supported fields (all optional except `event`):
 *  - event              {string}  — event name / category (e.g. "timeService.emit")
 *  - eventId            {string}  — optional correlation key
 *  - combatId           {string}
 *  - round              {number}
 *  - turn               {number}
 *  - source             {string}  — time source ("worldTime", "combat", "combatRound", …)
 *  - actorId            {string}
 *  - trigger            {string}  — spell-tick trigger ("turnEnd", "roundStart", …)
 *  - handlerId          {string}
 *  - durationMs         {number}  — elapsed monotonic milliseconds
 *  - combatantsTotal    {number}
 *  - actorsScanned      {number}
 *  - effectsScanned     {number}
 *  - documentUpdatesAttempted {number}
 *  - documentUpdatesCompleted {number}
 *  - chatCount          {number}
 *  - listenerCount      {number}
 *  - handlerCount       {number}
 *  - wasRebuild         {boolean}
 *
 * @param {object} record
 */
export function perfRecord(record) {
  if (!isPerfEnabled()) return;
  const entry = Object.assign({}, record, { _wallMs: Date.now() });
  _buf[_head % BUFFER_SIZE] = entry;
  _head++;
  _total++;
  try {
    const durStr = entry.durationMs != null
      ? ` | ${Number(entry.durationMs).toFixed(2)}ms`
      : "";
    console.log(`[UESRPG][TimePref] ${String(entry.event ?? "perf")}${durStr}`, entry);
  } catch (_e) { /* no-op */ }
}

// ─── Buffer Access ────────────────────────────────────────────────────────────

/**
 * Return all records currently in the ring buffer, oldest first.
 *
 * @returns {object[]}
 */
export function getPerfRecords() {
  const count = Math.min(_total, BUFFER_SIZE);
  if (count === 0) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const entry = _buf[(_head - count + i + BUFFER_SIZE) % BUFFER_SIZE];
    if (entry != null) out.push(entry);
  }
  return out;
}

/**
 * Clear the ring buffer.
 */
export function resetPerfRecords() {
  _buf.fill(null);
  _head = 0;
  _total = 0;
}

// ─── Summarize ────────────────────────────────────────────────────────────────

/**
 * Summarize records grouped by `event`: count, min, mean, p95, max durationMs.
 *
 * @param {object[]} [records] — defaults to the current buffer
 * @returns {Record<string, {count: number, min: number, mean: number, p95: number, max: number}>}
 */
export function summarizePerfRecords(records) {
  const src = records ?? getPerfRecords();

  /** @type {Map<string, number[]>} */
  const byEvent = new Map();
  for (const r of src) {
    if (!r) continue;
    const ev = String(r.event ?? "unknown");
    const dur = Number(r.durationMs ?? 0);
    let arr = byEvent.get(ev);
    if (!arr) { arr = []; byEvent.set(ev, arr); }
    arr.push(dur);
  }

  /** @type {Record<string, object>} */
  const result = {};
  for (const [ev, durations] of byEvent) {
    const sorted = durations.slice().sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const p95Idx = Math.min(Math.floor(count * 0.95), count - 1);
    result[ev] = {
      count,
      min:  +(sorted[0] ?? 0).toFixed(3),
      mean: +(count > 0 ? sum / count : 0).toFixed(3),
      p95:  +(count > 0 ? sorted[p95Idx] : 0).toFixed(3),
      max:  +(sorted[count - 1] ?? 0).toFixed(3),
    };
  }
  return result;
}

// ─── Benchmark Harness ────────────────────────────────────────────────────────

/**
 * Initialize and expose the perf API at `game.uesrpg.perf`.
 * Called once during system ready phase (from system.js).
 *
 * @returns {object} The frozen API surface.
 */
export function initializePerfApi() {
  const api = Object.freeze({

    /** Returns true when timePerformanceDebug is enabled. */
    enabled: isPerfEnabled,

    /** Clear the record ring buffer. */
    reset: resetPerfRecords,

    /** Return all buffered records (oldest first). */
    records: getPerfRecords,

    /** Return mean/max/p95 summary grouped by event name. */
    summarize: summarizePerfRecords,

    /** Print command reference to the console. */
    help() {
      console.log(
        "[UESRPG][TimePref] Perf API reference:\n\n" +
        "  game.uesrpg.perf.enabled()           — true when recording is on\n" +
        "  game.uesrpg.perf.reset()              — clear the ring buffer\n" +
        "  game.uesrpg.perf.records()            — dump raw event records (array)\n" +
        "  game.uesrpg.perf.summarize()          — mean/max/p95 per event (console.table)\n" +
        "  game.uesrpg.perf.runBenchmark(n=5)   — N Next Turn advances + summary\n\n" +
        "Enable:   game.settings.set('uesrpg-3ev4', 'timePerformanceDebug', true)\n" +
        "Disable:  game.settings.set('uesrpg-3ev4', 'timePerformanceDebug', false)\n\n" +
        "Key event names:\n" +
        "  timeService.emit / timeService.worldTimeUpdate / timeService.combatIntent / timeService.combatTurnChange\n" +
        "  spellTick.dispatch / spellTick.handler\n" +
        "  overtime.ensureIndex / overtime.collect / overtime.process\n" +
        "  turnTicker.endTurnTick / turnTicker.expireEffects / turnTicker.regenPrompts / turnTicker.silencedCheck / turnTicker.round\n" +
        "  combat.startCombat / combat.nextRound / combat.resetAllAP\n" +
        "  authorityProxy.updateDocument / authorityProxy.deleteEmbedded"
      );
    },

    /**
     * Run N deterministic Next Turn advances on the active combat,
     * then print mean/max/p95 by phase.
     *
     * @param {number} [n=5] Number of advances (clamped to 1–50).
     * @returns {Promise<{elapsed: number, summary: object, records: object[]}|null>}
     */
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
          "[UESRPG][TimePref] timePerformanceDebug is off.\n" +
          "  Enable: game.settings.set('uesrpg-3ev4', 'timePerformanceDebug', true)"
        );
        return null;
      }

      resetPerfRecords();
      const count = Math.max(1, Math.min(Number(n) || 5, 50));
      console.log(`[UESRPG][TimePref] Benchmark: running ${count} Next Turn advance(s)…`);

      const t0 = performance.now();
      for (let i = 0; i < count; i++) {
        await combat.nextTurn();
        // Brief settle so async work (doc writes, hooks) completes before next advance.
        await new Promise(r => setTimeout(r, 150));
      }
      const elapsed = performance.now() - t0;

      const summary = summarizePerfRecords();
      console.log(
        `[UESRPG][TimePref] Benchmark complete — ${count} advance(s) in ${elapsed.toFixed(1)}ms total`
      );
      console.table(summary);
      return { elapsed, summary, records: getPerfRecords() };
    }
  });

  if (!game.uesrpg) game.uesrpg = {};
  game.uesrpg.perf = api;
  return api;
}
