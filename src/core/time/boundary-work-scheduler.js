/**
 * @module core/time/boundary-work-scheduler
 *
 * src/core/time/boundary-work-scheduler.js
 *
 * Tiny deferred work queue for non-critical round-boundary presentation tasks.
 *
 * ## Design
 *
 * When `deferNonCriticalRoundBoundaryWork` is enabled, tasks queued via
 * `scheduleBoundaryWork()` are held until after the browser has painted the
 * new combat-tracker state (double-rAF yield). This ensures the GM client
 * sees the turn advance visually before chat messages and roll prompts appear.
 *
 * When the setting is disabled, tasks run immediately (same-microtask semantics
 * preserved for callers using `await scheduleBoundaryWork(...)`).
 *
 * ## Stale-check
 *
 * Each task carries a `{ combatId, round }` correlation key. Before execution
 * the scheduler checks `game.combat.id` and `game.combat.round`. Tasks whose
 * combat has ended or whose round has already advanced are dropped silently.
 * This prevents double-firing if the GM clicks Next Turn twice quickly.
 *
 * ## Usage
 *
 * ```js
 * await scheduleBoundaryWork(
 *   async () => { await _postRegenerationPrompts(combat, changed); },
 *   { combatId: combat.id, round: combat.round, label: "regenPrompts" }
 * );
 * ```
 *
 * Target: Foundry VTT v13.351
 */

import { createDebugLogger } from "../../utils/debug.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../utils/perf-tracker.js";
import { isBoundaryWorkDeferEnabled } from "../config/automation-policy.js";

const _debug = createDebugLogger("debugEnabled", "[UESRPG][BoundaryScheduler]");

/**
 * @typedef {object} BoundaryTask
 * @property {() => Promise<any>|any} fn    - Task function to execute
 * @property {string|null}            combatId - Combat id for stale check (null = skip check)
 * @property {number|null}            round    - Round number for stale check (null = skip check)
 * @property {string}                 label    - Debug label
 */

/** @type {BoundaryTask[]} */
const _queue = [];

/** Whether a double-rAF flush has already been scheduled */
let _rafScheduled = false;

// ─── Setting reader ───────────────────────────────────────────────────────────

function _isDeferEnabled() {
  return isBoundaryWorkDeferEnabled();
}

// ─── Queue management ─────────────────────────────────────────────────────────

/**
 * Execute all queued tasks that pass the stale check.
 * Called by the double-rAF and by `flushBoundaryWorkQueue()`.
 */
function _executeQueue() {
  if (!_queue.length) return;
  const tasks = _queue.splice(0);
  const _perf = isPerfEnabled();
  const _t0 = _perf ? monoMs() : 0;
  let executed = 0;
  let dropped = 0;

  for (const task of tasks) {
    // Stale check: drop if the combat has changed or round has advanced
    if (task.combatId !== null) {
      const currentCombatId = game.combat?.id ?? null;
      if (currentCombatId !== task.combatId) {
        _debug(`Dropping stale task "${task.label}" — combat changed (expected ${task.combatId}, got ${currentCombatId})`);
        dropped++;
        continue;
      }
    }
    if (task.round !== null) {
      const currentRound = Number(game.combat?.round ?? -1);
      if (currentRound !== task.round) {
        _debug(`Dropping stale task "${task.label}" — round advanced (expected ${task.round}, got ${currentRound})`);
        dropped++;
        continue;
      }
    }

    _debug(`Executing deferred task "${task.label}"`);
    try {
      const result = task.fn();
      if (result && typeof result.then === "function") {
        result.catch((err) =>
          console.warn(`UESRPG | BoundaryScheduler | Task "${task.label}" rejected`, err)
        );
      }
      executed++;
    } catch (err) {
      console.warn(`UESRPG | BoundaryScheduler | Task "${task.label}" threw synchronously`, err);
      executed++;
    }
  }

  if (_perf && (executed + dropped) > 0) {
    perfRecord({
      event: "boundaryScheduler.flush",
      executed,
      dropped,
      durationMs: monoMs() - _t0,
    });
  }

  _debug(`Flush complete — executed: ${executed}, dropped: ${dropped}`);
}

/**
 * Schedule the double-rAF flush if not already scheduled.
 * Idempotent — only one flush per task-accumulation window.
 */
function _scheduleRafFlush() {
  if (_rafScheduled) return;
  _rafScheduled = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      _rafScheduled = false;
      _executeQueue();
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Schedule a non-critical boundary task to run after the UI paints.
 *
 * When `deferNonCriticalRoundBoundaryWork` is disabled (default), `taskFn` is
 * called immediately and its return value (typically a Promise) is returned —
 * so `await scheduleBoundaryWork(...)` preserves synchronous semantics.
 *
 * When the setting is enabled, `taskFn` is queued and this function returns
 * `undefined` immediately. Callers awaiting this call will continue without
 * waiting for `taskFn` to execute.
 *
 * @param {() => Promise<any>|any} taskFn   - Async or sync task to perform
 * @param {object}                 [opts]
 * @param {string|null}            [opts.combatId] - Combat id for stale check
 * @param {number|null}            [opts.round]    - Round for stale check
 * @param {string}                 [opts.label]    - Debug label
 * @returns {Promise<any>|undefined} Immediate: return of taskFn. Deferred: undefined.
 */
export function scheduleBoundaryWork(taskFn, { combatId = null, round = null, label = "unnamed" } = {}) {
  if (!_isDeferEnabled()) {
    // Immediate path — preserve Promise semantics for the caller.
    return taskFn();
  }

  _debug(`Queuing deferred task "${label}" (combatId=${combatId}, round=${round})`);
  _queue.push({ fn: taskFn, combatId, round, label });
  _scheduleRafFlush();
  // Return undefined — callers will continue immediately.
}

/**
 * Force-flush the deferred queue now, bypassing the rAF yield.
 * Intended for testing and GM debug utilities only.
 * Safe to call when the queue is empty (no-op).
 */
export function flushBoundaryWorkQueue() {
  _executeQueue();
}

/**
 * Returns the number of tasks currently waiting in the deferred queue.
 * @returns {number}
 */
export function getBoundaryWorkQueueSize() {
  return _queue.length;
}
