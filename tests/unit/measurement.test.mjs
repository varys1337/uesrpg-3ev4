import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginPerfMeasurement, measurePerfCall, summarizePerfEntries, PERF_COUNTER_KEYS,
} from "../../src/utils/perf-tracker-support.js";
import { projectSupportReport } from "../../src/utils/dev/support-report.js";

function measurement(times = [10, 15]) {
  const records = [], clock = times.values();
  return { records, options: {
    enabled: true, event: "sheet.signature", details: { requestedCount: 1 },
    now: () => clock.next().value, record: record => records.push(record),
  } };
}

describe("Diagnostic boundaries without native simulation", () => {
  it("imports without runtime globals", () => {
    assert.equal(globalThis.game, undefined); assert.equal(globalThis.foundry, undefined);
  });
  it("disabled calls execute once without reading clocks or recording", () => {
    let calls = 0;
    const result = measurePerfCall({ enabled: false,
      now: () => assert.fail("disabled clock"), record: () => assert.fail("disabled record") },
    () => { calls++; return 0; });
    assert.equal(result, 0); assert.equal(calls, 1);
  });
  it("preserves the exact synchronous return value", () => {
    const value = { saved: -2 }, state = measurement();
    assert.equal(measurePerfCall(state.options, () => value), value);
    assert.deepEqual(state.records, [{ event: "sheet.signature", requestedCount: 1, durationMs: 5, failed: false }]);
  });
  it("preserves thrown identity and records failure", () => {
    const error = new Error("expected"), state = measurement();
    assert.throws(() => measurePerfCall(state.options, () => { throw error; }), value => value === error);
    assert.equal(state.records[0].failed, true);
  });
  it("does not await or replace a returned Promise", async () => {
    const value = Promise.resolve("result"), state = measurement();
    assert.equal(measurePerfCall(state.options, () => value), value);
    assert.equal(state.records.length, 1); assert.equal(await value, "result");
  });
  it("explicit spans finish only once", () => {
    const state = measurement(), finish = beginPerfMeasurement(state.options);
    finish({ completedCount: 1 }); finish({ failedCount: 1 });
    assert.equal(state.records.length, 1);
    assert.equal(state.records[0].completedCount, 1); assert.equal(state.records[0].failedCount, undefined);
  });
  it("disabled spans never call diagnostic callbacks", () => {
    beginPerfMeasurement({ enabled: false, now: () => assert.fail(), record: () => assert.fail() })();
  });
  it("accepts a measured zero without substituting another duration", () => {
    const state = measurement([0, 0]); beginPerfMeasurement(state.options)();
    assert.equal(state.records[0].durationMs, 0);
  });
  for (const times of [[null, 1], [undefined, 1], ["1", 2], [NaN, 2], [1, Infinity], [5, 3]]) {
    it("leaves invalid clock evidence unavailable: " + String(times), () => {
      const state = measurement(times); beginPerfMeasurement(state.options)({ completedCount: 1 });
      assert.equal(Object.hasOwn(state.records[0], "durationMs"), false);
      assert.equal(state.records[0].completedCount, 1);
    });
  }
  it("clock errors cannot alter gameplay return values", () => {
    const state = measurement(); state.options.now = () => { throw new Error("clock"); };
    assert.equal(measurePerfCall(state.options, () => -5), -5);
    assert.equal(state.records[0].durationMs, undefined);
  });
  it("recorder errors cannot alter return values or thrown errors", () => {
    const state = measurement([0, 1, 2, 3]), failure = new Error("operation");
    state.options.record = () => { throw new Error("recorder"); };
    assert.equal(measurePerfCall(state.options, () => "kept"), "kept");
    assert.throws(() => measurePerfCall(state.options, () => { throw failure; }), value => value === failure);
  });
  it("keeps details and result objects unchanged", () => {
    const state = measurement(), result = Object.freeze({ completedCount: 1 });
    state.options.details = Object.freeze({ requestedCount: 1 });
    beginPerfMeasurement(state.options)(result);
    assert.deepEqual(state.options.details, { requestedCount: 1 }); assert.deepEqual(result, { completedCount: 1 });
  });
  it("aggregates only recorded new counters without changing legacy summaries", () => {
    const rows = [{ event: "sheet.queue", durationMs: 0, requestedCount: 1, completedCount: 1 },
      { event: "sheet.queue", durationMs: 4, requestedCount: 1, failedCount: 1, cancelledCount: 2 }];
    const before = structuredClone(rows), summary = summarizePerfEntries(rows)["sheet.queue"];
    assert.equal(summary.median, 2); assert.equal(summary.requestedCount, 2);
    assert.equal(summary.completedCount, 1); assert.equal(summary.failedCount, 1); assert.equal(summary.cancelledCount, 2);
    assert.deepEqual(rows, before); assert.equal(new Set(PERF_COUNTER_KEYS).size, PERF_COUNTER_KEYS.length);
  });
  it("exports fixed event/counter summaries without sheet, hook, Actor or task context", () => {
    const secret = "PRIVATE_SENTINEL";
    const rows = ["sheet.signature", "sheet.refresh.match", "sheet.refresh.lifecycle", "sheet.queue",
      "system.deferred.scheduled", "system.deferred.started", "system.deferred.finished",
      "sheet.render.SimpleItemSheetV2._prepareContext", "sheet.render.GroupSheetV2._onRender",
      "sheet.render.WarfareUnitSheetV2._onClose"].map(event => ({
      event, durationMs: 0, matchedCount: 1, registeredCount: 2, unregisteredCount: 2,
      label: secret, sheet: secret, actorUuid: secret, task: secret, phase: secret, stack: secret,
    }));
    rows.push({ event: "sheet.render." + secret + "._onRender", durationMs: 1 });
    const before = structuredClone(rows), output = projectSupportReport({ records: rows });
    assert.equal(Object.keys(output.performance).length, 10);
    assert.equal(JSON.stringify(output).includes(secret), false); assert.deepEqual(rows, before);
    assert.deepEqual(output.performance["sheet.refresh.lifecycle"].counters,
      { matchedCount: 1, registeredCount: 2, unregisteredCount: 2 });
  });
  it("keeps counter-only timing unavailable", () => {
    const output = projectSupportReport({ records: [{ event: "sheet.refresh.lifecycle", registeredCount: 2 }] });
    assert.equal(output.performance["sheet.refresh.lifecycle"].timing, null);
    assert.equal(output.performance["sheet.refresh.lifecycle"].counters.registeredCount, 2);
  });
});
