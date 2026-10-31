/** Pure allow-listed support projection. Never accepts Documents as an export format. */
import { ACTOR_TYPE_MODEL_SEEDS, ITEM_TYPE_MODEL_SEEDS } from "../../core/data-models/defaults.generated.js";
import { MIGRATION_REVISIONS } from "../../core/migrations/revisions.js";
import { summarizePerfEntries, PERF_COUNTER_KEYS } from "../perf-tracker-support.js";

export const SUPPORT_SETTING_KEYS = Object.freeze([
  "debugEnabled", "debugClientEnabled", "timePerformanceDebug", "sheetPerfTrace", "perfDebug", "sheetDiagnostics",
]);
const EVENTS = new Set([
  "system.ready", "system.init.initHandler", "timeService.emit", "timeService.worldTimeUpdate",
  "spellTick.dispatch", "overtime.collect", "overtime.process", "combat.nextRound",
  "damage.application", "healing.visibleHP", "damage.health.commit", "authorityProxy.documentResult",
  "authorityProxy.updateDocument", "authorityProxy.createEmbedded", "authorityProxy.updateEmbedded",
  "authorityProxy.deleteEmbedded", "outcome.application", "outcome.stage", "outcome.receipt.persist",
  "outcome.chat.refresh", "outcome.chat.refreshRequested", "outcome.chat.refreshSkipped", "outcome.chat.render",
  "sheet.signature", "sheet.context", "sheet.refresh.match", "sheet.refresh.lifecycle", "sheet.queue",
  "system.deferred.scheduled", "system.deferred.started", "system.deferred.finished",
]);
const COUNTERS = PERF_COUNTER_KEYS;
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function version(value) {
  return typeof value === "string" && value.length <= 64 && /^v?\d+(?:\.\d+){1,3}(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?$/i.test(value) ? value : null;
}
function registered(value, allowed) {
  return Array.isArray(value) ? [...new Set(value.filter(key => allowed.has(key)))].sort() : null;
}
function knownEvent(value) {
  return EVENTS.has(value) || typeof value === "string"
    && /^sheet\.render\.(PCActorSheetV2|NpcSheetV2|SimpleItemSheetV2|GroupSheetV2|WarfareUnitSheetV2)\.(_prepareContext|_onRender|_onClose)$/.test(value);
}
function performanceSummary(input) {
  if (!Array.isArray(input)) return null;
  const records = input.slice(-500).filter(row => row && knownEvent(row.event)).map(row => {
    const result = { event: row.event };
    if (typeof row.durationMs === "number" && Number.isFinite(row.durationMs) && row.durationMs >= 0) result.durationMs = row.durationMs;
    for (const key of COUNTERS) if (Number.isSafeInteger(row[key]) && row[key] >= 0) result[key] = row[key];
    return result;
  });
  const summaries = summarizePerfEntries(records);
  const timings = summarizePerfEntries(records.filter(row => row.durationMs !== undefined));
  return Object.fromEntries(Object.keys(summaries).sort().map(event => [event, {
    records: records.filter(row => row.event === event).length,
    timing: timings[event] ? Object.fromEntries(["count", "min", "median", "mean", "p95", "max"].map(key => [key, timings[event][key]])) : null,
    counters: Object.fromEntries(COUNTERS.filter(key => summaries[event][key] !== undefined).map(key => [key, summaries[event][key]])),
  }]));
}
export function projectSupportReport(input = {}, { includeModules = false } = {}) {
  const data = object(input), settings = object(data.settings), models = object(data.models);
  return {
    formatVersion: 1,
    environment: { foundry: version(object(data.environment).foundry), system: version(object(data.environment).system) },
    models: data.models == null ? null : {
      Actor: registered(object(models.Actor).registered, new Set(Object.keys(ACTOR_TYPE_MODEL_SEEDS))),
      Item: registered(object(models.Item).registered, new Set(Object.keys(ITEM_TYPE_MODEL_SEEDS))),
    },
    pendingMigrations: registered(data.pendingMigrations, new Set(Object.keys(MIGRATION_REVISIONS))),
    settings: Object.fromEntries(SUPPORT_SETTING_KEYS.map(key => [key, typeof settings[key] === "boolean" ? settings[key] : null])),
    performance: performanceSummary(data.records),
    performanceRecordingEnabled: typeof settings.timePerformanceDebug === "boolean" ? settings.timePerformanceDebug : null,
    performanceOverwritten: typeof data.performanceOverwritten === "boolean" ? data.performanceOverwritten : null,
    modules: includeModules === true && Array.isArray(data.modules) ? data.modules.slice(0, 500)
      .filter(row => row?.active === true && typeof row.id === "string" && /^[a-z0-9][a-z0-9_-]{0,99}$/.test(row.id))
      .map(row => ({ id: row.id, version: version(row.version) })).sort((a, b) => a.id.localeCompare(b.id)) : null,
    errorCounts: null,
  };
}

