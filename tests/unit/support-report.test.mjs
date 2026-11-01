import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectSupportReport, SUPPORT_SETTING_KEYS } from "../../src/utils/dev/support-report.js";
const secret = "PRIVATE_SENTINEL";
const input = () => ({
  environment: { foundry: "14.369", system: "14.2.0", address: secret, user: secret },
  models: { Actor: { registered: ["Player Character", secret] }, Item: { registered: ["skill", secret] } },
  settings: { timePerformanceDebug: false, debugEnabled: true, credential: secret },
  pendingMigrations: ["actors", secret],
  records: [{ event: "system.ready", durationMs: 0, actorName: secret, actorUuid: secret, error: secret }],
  modules: [{ id: "example-module", version: "v1.2.3", active: true, settings: secret }],
  logs: secret, userId: secret, chat: { content: secret }, world: secret, performanceOverwritten: true,
});
describe("Sanitized support projection", () => {
  it("imports without runtime globals", () => {
    assert.equal(globalThis.game, undefined); assert.equal(globalThis.foundry, undefined); assert.equal(globalThis.document, undefined);
  });
  it("copies allowed facts without raw private payloads", () => {
    const report = projectSupportReport(input());
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.deepEqual(report.environment, { foundry: "14.369", system: "14.2.0" });
    assert.deepEqual(report.models, { Actor: ["Player Character"], Item: ["skill"] });
    assert.deepEqual(report.pendingMigrations, ["actors"]);
    assert.equal(report.settings.debugEnabled, true);
    assert.equal(report.performanceRecordingEnabled, false);
    assert.equal(report.performanceOverwritten, true);
    assert.equal(report.errorCounts, null);
  });
  it("preserves input when including modules", () => {
    const source = input(), before = structuredClone(source);
    projectSupportReport(source, { includeModules: true }); assert.deepEqual(source, before);
  });
  it("omits modules by default", () => assert.equal(projectSupportReport(input()).modules, null));
  it("includes only active IDs and versions on opt-in", () => {
    const source = input();
    source.modules.push({ id: "inactive", active: false, version: "2.0" }, { id: "https://private", active: true }, { id: "other", version: secret, active: true });
    assert.deepEqual(projectSupportReport(source, { includeModules: true }).modules, [
      { id: "example-module", version: "v1.2.3" }, { id: "other", version: null },
    ]);
  });
  it("requires literal opt-in", () => assert.equal(projectSupportReport(input(), { includeModules: "true" }).modules, null));
  it("distinguishes missing and recorded empty evidence", () => {
    const missing = projectSupportReport();
    for (const key of ["models", "pendingMigrations", "performance", "performanceRecordingEnabled", "performanceOverwritten"]) assert.equal(missing[key], null);
    assert.deepEqual(projectSupportReport({ records: [], pendingMigrations: [] }).performance, {});
    assert.deepEqual(projectSupportReport({ records: [], pendingMigrations: [] }).pendingMigrations, []);
  });
  for (const invalid of [null, [], 42, "bad"]) it("handles malformed root " + JSON.stringify(invalid), () => {
    assert.equal(projectSupportReport(invalid).environment.foundry, null);
  });
  it("rejects non-version strings and unapproved settings", () => {
    const report = projectSupportReport({ environment: { foundry: secret, system: "https://private" }, settings: { debugEnabled: "false", perfDebug: 1, secret } });
    assert.deepEqual(report.environment, { foundry: null, system: null });
    assert.equal(report.settings.debugEnabled, null); assert.equal(report.settings.perfDebug, null);
    assert.deepEqual(Object.keys(report.settings), [...SUPPORT_SETTING_KEYS]);
    assert.equal(JSON.stringify(report).includes(secret), false);
  });
  it("deduplicates known model/revision keys", () => {
    const report = projectSupportReport({ models: { Actor: { registered: ["Player Character", "Player Character"] } }, pendingMigrations: ["actors", "actors", "__proto__"] });
    assert.deepEqual(report.models.Actor, ["Player Character"]); assert.equal(report.models.Item, null); assert.deepEqual(report.pendingMigrations, ["actors"]);
  });
});
describe("Bounded numeric diagnostic summaries", () => {
  it("preserves measured zero and reuses the summary owner", () => {
    const report = projectSupportReport({ records: [{ event: "system.ready", durationMs: 0 }, { event: "system.ready", durationMs: 10, renderCount: 2 }] });
    assert.deepEqual(report.performance["system.ready"], { records: 2, timing: { count: 2, min: 0, median: 5, mean: 5, p95: 10, max: 10 }, counters: { renderCount: 2 } });
  });
  it("does not manufacture absent timings/counters", () => {
    const report = projectSupportReport({ records: [{ event: "system.ready", durationMs: "9", renderCount: null, requestId: secret }] });
    assert.deepEqual(report.performance["system.ready"], { records: 1, timing: null, counters: {} });
  });
  it("rejects unknown event names and arbitrary suffixes", () => {
    assert.deepEqual(projectSupportReport({ records: [{ event: secret, durationMs: 1 }, { event: "sheet.render.PCActorSheetV2.phase." + secret, durationMs: 1 }] }).performance, {});
  });
  it("rejects invalid numbers without clamping", () => {
    const report = projectSupportReport({ records: [{ event: "system.ready", durationMs: Infinity, renderCount: -3 }, { event: "system.ready", durationMs: -1, refreshCount: NaN }] });
    assert.deepEqual(report.performance["system.ready"], { records: 2, timing: null, counters: {} });
  });
  it("excludes missing timings from a measured distribution", () => {
    const summary = projectSupportReport({ records: [{ event: "system.ready" }, { event: "system.ready", durationMs: 6 }] }).performance["system.ready"];
    assert.equal(summary.timing.count, 1); assert.equal(summary.timing.mean, 6); assert.equal(summary.records, 2);
  });
  it("bounds projection to the newest 500 input records", () => {
    const records = [{ event: "system.ready", durationMs: 999 }, ...Array.from({ length: 500 }, () => ({ event: "system.ready", durationMs: 1 }))];
    const summary = projectSupportReport({ records }).performance["system.ready"];
    assert.equal(summary.records, 500); assert.equal(summary.timing.max, 1);
  });
});

