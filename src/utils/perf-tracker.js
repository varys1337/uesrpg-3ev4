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
  exportPerfEntries,
  resetPerfEntries,
  summarizePerfEntries,
  summarizeRenderImpact,
  getPerfHelpText
} from "./perf-tracker-support.js";

const PERF_SETTING = "timePerformanceDebug";
let _consoleEnabled = true;
const _healthRefreshes = new Map();
const _applicationContexts = new Map();
const _documentActivities = new Map();
const _noop = () => {};

/** Diagnostic correlation only; never authorizes work or selects document values. */
export function perfApplicationContext(actorOrUuid) {
  if (!isPerfEnabled()) return {};
  const uuid = typeof actorOrUuid === "string" ? actorOrUuid : actorOrUuid?.uuid;
  return _applicationContexts.get(uuid) ?? {};
}

export function perfTrackApplication(actor, application) {
  if (!isPerfEnabled() || !actor?.uuid) return _noop;
  const previous = _applicationContexts.get(actor.uuid);
  const context = { applicationId: application.id, receiptId: application.receiptId,
    messageId: application.messageId ?? previous?.messageId ?? null, requestId: application.requestId, kind: application.kind,
    outcomeId: application.outcomeId ?? previous?.outcomeId ?? null,
    outcomeStartedAt: application.outcomeStartedAt ?? previous?.outcomeStartedAt ?? null };
  _applicationContexts.set(actor.uuid, context);
  return () => {
    if (_applicationContexts.get(actor.uuid) !== context) return;
    if (previous) _applicationContexts.set(actor.uuid, previous);
    else _applicationContexts.delete(actor.uuid);
  };
}

/** Count confirmed helper results in a stage without retaining documents or buffer entries. */
export function perfTrackDocumentActivity(actor) {
  if (!isPerfEnabled() || !actor?.uuid) return () => ({});
  const uuid = actor.uuid;
  const activity = { writeAttemptCount: 0, confirmedChangeCount: 0, confirmedNoopCount: 0 };
  const activities = _documentActivities.get(uuid) ?? new Set();
  activities.add(activity);
  _documentActivities.set(uuid, activities);
  return () => {
    activities.delete(activity);
    if (!activities.size) _documentActivities.delete(uuid);
    return { ...activity, changedDocuments: activity.confirmedChangeCount > 0,
      changeCoverage: "owned-document-helpers-and-npc-status" };
  };
}

function _recordDocumentActivity(record) {
  if (record.event !== "authorityProxy.documentResult" && ![
    "authorityProxy.createEmbedded", "authorityProxy.updateEmbedded", "authorityProxy.deleteEmbedded", "status.npc.documentResult",
  ].includes(record.event)) return;
  const docUuid = String(record.docUuid ?? "");
  for (const [uuid, activities] of _documentActivities) {
    if (docUuid !== uuid && !docUuid.startsWith(`${uuid}.`)) continue;
    for (const activity of activities) {
      activity.writeAttemptCount += Number(record.writeAttemptCount ?? 0);
      activity.confirmedChangeCount += Number(record.confirmedChangeCount ?? record.confirmedCount ?? 0);
      activity.confirmedNoopCount += Number(record.confirmedNoopCount ?? 0);
    }
  }
}

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
  _recordDocumentActivity(record);
  const entry = recordPerfEntry({ ...perfApplicationContext(record.actorUuid ?? record.docUuid), ...record });
  if (!_consoleEnabled) return;
  try {
    const durStr = entry.durationMs != null
      ? ` | ${Number(entry.durationMs).toFixed(2)}ms`
      : "";
    console.log(`[UESRPG][TimePref] ${String(entry.event ?? "perf")}${durStr}`, entry);
  } catch (_e) {
    /* no-op */
  }
}

/** Measure an owned workflow stage without collecting documents or enabling diagnostics. */
export async function measurePerfStage(kind, stage, context, run) {
  if (!isPerfEnabled()) return run();
  const startedAt = monoMs();
  let failed = false;
  try {
    const result = await run();
    failed = result === false || result?.ok === false || result?.failed === true ||
      (Array.isArray(result?.failed) && result.failed.length > 0) ||
      ["partial", "failed"].includes(result?.execution?.status);
    return result;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    perfRecord({ ...context, event: `${kind}.${stage}`, kind, stage, failed, durationMs: monoMs() - startedAt });
  }
}

export function getPerfRecords() {
  return readPerfEntries();
}

export function resetPerfRecords() {
  resetPerfEntries();
  _healthRefreshes.clear();
}

export function summarizePerfRecords(records, options) {
  return summarizePerfEntries(records, options);
}

/** Diagnostic-only state; never drives a resource value or requests a render. */
export function perfExpectHealthRefresh(actor, application, newHP) {
  if (!isPerfEnabled() || !actor?.uuid || !Number.isFinite(newHP)) return () => {};
  const entry = {
    actorUuid: actor.uuid, applicationId: application?.id ?? null,
    receiptId: application?.receiptId ?? null, messageId: application?.messageId ?? null,
    kind: application?.kind ?? "damage", newHP, startedAt: monoMs(), confirmedAt: null,
    outcomeStartedAt: perfApplicationContext(actor).outcomeStartedAt ?? null,
    outcomeId: perfApplicationContext(actor).outcomeId ?? null,
  };
  // One outstanding visible value per Actor; newer commits supersede old views.
  _healthRefreshes.set(actor.uuid, entry);
  if (_healthRefreshes.size > 100) _healthRefreshes.delete(_healthRefreshes.keys().next().value);
  return (confirmed) => {
    if (_healthRefreshes.get(actor.uuid) !== entry) return;
    if (!confirmed) { _healthRefreshes.delete(actor.uuid); return; }
    entry.confirmedAt = monoMs();
    for (const app of foundry.applications.instances.values()) {
      if (app.document?.uuid === actor.uuid && app.rendered) perfRecordHealthRefresh(app);
    }
  };
}

/** Called from the documented AppV2 _onRender lifecycle and confirmed commit. */
export function perfRecordHealthRefresh(sheet) {
  if (!isPerfEnabled()) return;
  const actor = sheet?.document;
  const entry = _healthRefreshes.get(actor?.uuid);
  if (!entry || entry.confirmedAt === null || entry.paintPending) return;
  if (monoMs() - entry.startedAt > 60_000) { _healthRefreshes.delete(actor.uuid); return; }
  const input = sheet.element?.querySelector?.('input[name="system.hp.value"]');
  if (!input || !input.getClientRects().length || Number(input.value) !== entry.newHP) return;
  entry.paintPending = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    entry.paintPending = false;
    if (!isPerfEnabled() || _healthRefreshes.get(actor.uuid) !== entry) return;
    if (!sheet.rendered || !input.isConnected || !input.getClientRects().length || Number(actor.system?.hp?.value) !== entry.newHP
      || Number(input.value) !== entry.newHP) return;
    _healthRefreshes.delete(actor.uuid);
    perfRecord({
      event: `${entry.kind}.visibleHP`, kind: entry.kind, actorUuid: actor.uuid,
      applicationId: entry.applicationId, receiptId: entry.receiptId, messageId: entry.messageId,
      sheetId: sheet.id, durationMs: monoMs() - entry.startedAt,
      afterCommitMs: monoMs() - entry.confirmedAt,
      outcomeId: entry.outcomeId,
      outcomeToVisibleMs: entry.outcomeStartedAt === null ? null : monoMs() - entry.outcomeStartedAt,
    });
  }));
}

export function initializePerfApi() {
  const api = Object.freeze({
    enabled: isPerfEnabled,
    reset: resetPerfRecords,
    records: getPerfRecords,
    exportBatch: exportPerfEntries,
    summarize: summarizePerfRecords,
    console(enabled = true) { _consoleEnabled = enabled !== false; return _consoleEnabled; },
    renderImpact(windowMs = 500) {
      return summarizeRenderImpact(getPerfRecords(), windowMs);
    },

    async runSheetBenchmark(n = 5) {
      if (!isPerfEnabled()) {
        console.warn(`[UESRPG][TimePref] Enable ${PERF_SETTING} before running sheet benchmarks.`);
        return null;
      }

      const registry = foundry?.applications?.instances;
      if (typeof registry?.values !== "function") return null;
      const count = Math.max(1, Math.min(Number(n) || 5, 20));
      const wanted = ["player-character", "npc", "item"];
      const sheets = new Map();
      for (const app of registry.values()) {
        if (!app?.rendered || typeof app?.render !== "function") continue;
        const classes = app?.element?.classList;
        const kind = wanted.find((name) => classes?.contains?.(name));
        if (kind && !sheets.has(kind)) sheets.set(kind, app);
      }

      if (!sheets.size) {
        console.warn("[UESRPG][TimePref] Open an Actor, NPC, or Item sheet before running the sheet benchmark.");
        return null;
      }

      const results = {};
      const previousConsole = _consoleEnabled;
      _consoleEnabled = false;
      try {
        for (const [kind, app] of sheets) {
          const durations = [];
          for (let index = 0; index < count; index += 1) {
            const startedAt = monoMs();
            await app.render();
            durations.push(monoMs() - startedAt);
          }
          const sorted = durations.slice().sort((a, b) => a - b);
          const middle = Math.floor(sorted.length / 2);
          const median = sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
          results[kind] = {
            count,
            median: Number(median.toFixed(3)),
            min: Number(sorted[0].toFixed(3)),
            max: Number(sorted.at(-1).toFixed(3)),
            p95: Number(sorted[Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1)].toFixed(3)),
          };
        }
      } finally { _consoleEnabled = previousConsole; }
      console.table(results);
      return results;
    },

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
