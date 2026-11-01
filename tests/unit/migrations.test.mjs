import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  getAppliedMigrationRevision, getMigrationFailureCount, getPendingMigrationKeys,
  isMigrationRevisionApplied, markMigrationRevisionApplied,
} from "../../src/core/migrations/state.js";
import { MIGRATION_REVISIONS, STARTUP_PENDING_MIGRATION_KEYS } from "../../src/core/migrations/revisions.js";
import { createMigrationCoordinator, executeMigrationPasses } from "../../src/core/migrations/execution.js";
import { assertDocumentWriteConfirmed, getUnconfirmedDocumentIds } from "../../src/utils/authority-proxy/shared.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/legacy-data.json", import.meta.url), "utf8"));

describe("Migration revision interpretation with explicit state", () => {
  for (const [key, expected] of [["numeric", 3], ["current", 2], ["numericString", 2], ["legacyText", 1], ["legacyRecord", 1], ["legacyBoolean", 1], ["notApplied", 0], ["malformedRevision", 1], ["missing", 0]]) {
    it(`reads ${key} as revision ${expected}`, () => {
      const state = structuredClone(fixture.migrationState);
      const before = structuredClone(state);
      assert.equal(getAppliedMigrationRevision(key, state), expected);
      assert.deepEqual(state, before);
    });
  }

  it("requires the recorded revision to meet the requested revision", () => {
    const state = structuredClone(fixture.migrationState);
    assert.equal(isMigrationRevisionApplied("current", 1, state), true);
    assert.equal(isMigrationRevisionApplied("current", 2, state), true);
    assert.equal(isMigrationRevisionApplied("current", 3, state), false);
    assert.equal(isMigrationRevisionApplied("numericString", "2", state), true);
    assert.equal(isMigrationRevisionApplied("missing", 1, state), false);
  });

  it("does not treat a legacy version stamp as a modern revision number", () => {
    const state = structuredClone(fixture.migrationState);
    assert.equal(isMigrationRevisionApplied("legacyText", 1, state), true);
    assert.equal(isMigrationRevisionApplied("legacyText", 2, state), false);
    assert.equal(isMigrationRevisionApplied("legacyRecord", 2, state), false);
  });

  it("handles absent or invalid explicit state without reading world settings", () => {
    for (const state of [null, {}, { key: null }, { key: false }, { key: Infinity }]) {
      assert.equal(getAppliedMigrationRevision("key", state), 0);
      assert.equal(isMigrationRevisionApplied("key", 1, state), false);
    }
    assert.equal(isMigrationRevisionApplied("missing", 0, {}), true);
  });

  it("leaves state and metadata unchanged after repeated comparisons", () => {
    const state = structuredClone(fixture.migrationState);
    const before = structuredClone(state);
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal(isMigrationRevisionApplied("current", 2, state), true);
      assert.equal(isMigrationRevisionApplied("notApplied", 1, state), false);
    }
    assert.deepEqual(state, before);
  });
});

describe("Migration completion evidence", () => {
  const completeState = () => Object.fromEntries(Object.entries(MIGRATION_REVISIONS).map(([key, revision]) => [key, { revision }]));

  it("requires all 21 registered revisions in empty state", () => {
    assert.equal(Object.keys(MIGRATION_REVISIONS).length, 21);
    assert.deepEqual(getPendingMigrationKeys(MIGRATION_REVISIONS, {}), Object.keys(MIGRATION_REVISIONS));
    assert.deepEqual(getPendingMigrationKeys({}, {}), []);
    assert.deepEqual(getPendingMigrationKeys([], {}), []);
  });

  it("accepts complete state and identifies exactly one missing revision", () => {
    const state = completeState();
    assert.deepEqual(getPendingMigrationKeys(MIGRATION_REVISIONS, state), []);
    delete state.items;
    assert.deepEqual(getPendingMigrationKeys(MIGRATION_REVISIONS, state), ["items"]);
  });

  it("uses canonical revisions for the unchanged startup notice membership", () => {
    const state = completeState();
    state.activeEffectDurationV14.revision = 1;
    state.timeDefaultsCompositeOrchestratorV1 = null;
    state.automationProfileRemovalDefaultsV2 = null;
    assert.equal(STARTUP_PENDING_MIGRATION_KEYS.length, 19);
    assert.deepEqual(getPendingMigrationKeys(STARTUP_PENDING_MIGRATION_KEYS, state), ["activeEffectDurationV14"]);
    assert.deepEqual(getPendingMigrationKeys(["unknown", "items"], state), []);
  });

  for (const [name, metadata, count] of [
    ["positive failures", { failures: 2 }, 2],
    ["nested failed writes", { result: { failed: 3 } }, 3],
    ["numeric legacy failure count", { failures: "1" }, 1],
    ["nested numeric legacy count", { result: { failed: "2" } }, 2],
    ["zero top-level count with nested failures", { failures: 0, result: { failed: 4 } }, 4],
    ["overlapping counters", { failures: 2, result: { failed: 2 } }, 2],
    ["failure with review advice", { failures: 1, reviewRequired: true }, 1],
  ]) {
    it(`keeps ${name} pending without lowering or rewriting its revision`, () => {
      const state = { items: { revision: 99, appliedAt: 123, ...structuredClone(metadata) } };
      const before = structuredClone(state);
      assert.equal(getMigrationFailureCount(state.items), count);
      assert.equal(getAppliedMigrationRevision("items", state), 99);
      for (let attempt = 0; attempt < 3; attempt++) {
        assert.equal(isMigrationRevisionApplied("items", 1, state), false);
        assert.deepEqual(getPendingMigrationKeys(["items"], state), ["items"]);
      }
      assert.deepEqual(state, before);
    });
  }

  for (const [name, record] of [
    ["review advice", { revision: 1, reviewRequired: true }],
    ["zero counters", { revision: 1, failures: 0, result: { failed: 0 } }],
    ["negative counters", { revision: 1, failures: -1, result: { failed: -2 } }],
    ["legacy metadata", { systemVersion: "14.0.0" }],
    ["legacy text", "14.0.0"],
    ["legacy Boolean", true],
  ]) {
    it(`preserves completion interpretation for ${name}`, () => {
      assert.equal(getMigrationFailureCount(record), 0);
      assert.equal(isMigrationRevisionApplied("items", 1, { items: record }), true);
    });
  }

  it("does not use an informational version stamp as revision completion", () => {
    const state = { worldDataVersion: "999.999.999", systemVersion: "999.999.999" };
    const before = structuredClone(state);
    assert.deepEqual(getPendingMigrationKeys(MIGRATION_REVISIONS, state), Object.keys(MIGRATION_REVISIONS));
    assert.deepEqual(state, before);
  });

  for (const extra of [{ failures: 1 }, { result: { failed: 1 } }]) {
    it(`rejects a completion marker with ${JSON.stringify(extra)} before accessing Foundry`, () => {
      const state = { items: { revision: 1, failures: 1, appliedAt: 123 } };
      const before = structuredClone(state);
      assert.throws(() => markMigrationRevisionApplied(state, "items", 1, extra), error => {
        assert.match(error.message, /known failures/);
        assert.deepEqual(error.migrationTelemetry, { key: "items", ...extra });
        return true;
      });
      assert.deepEqual(state, before);
    });
  }

  it("a successful explicit retry can replace failure evidence without changing its revision", async () => {
    const state = { items: { revision: 1, failures: 1 } };
    const result = await executeMigrationPasses({
      passes: [{ name: "manual-items", run: async () => { state.items = { revision: 1, failures: 0 }; } }],
      canRun: () => true,
      getPendingKeys: () => getPendingMigrationKeys(["items"], state),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.pendingKeys, []);
    assert.equal(state.items.revision, 1);
  });
});

describe("Native document acknowledgement decisions", () => {
  for (const [name, expected, confirmed, missing] of [
    ["empty work", [], undefined, []],
    ["all acknowledged", ["a", "b"], ["b", "a"], []],
    ["no acknowledgement", ["a", "b"], undefined, ["a", "b"]],
    ["cancelled batch", ["a", "b"], [], ["a", "b"]],
    ["partial acknowledgement", ["a", "b", "c"], ["a", "c"], ["b"]],
    ["unrelated IDs", ["a", "b"], ["x", "y"], ["a", "b"]],
    ["duplicate acknowledgement", ["a", "b"], ["a", "a"], ["b"]],
    ["duplicate requested ID", ["a", "a", "b"], ["a"], ["b"]],
    ["invalid returned ID", ["a"], [null, undefined, 0], ["a"]],
  ]) {
    it(`handles ${name} using explicit ID arrays`, () => {
      const expectedBefore = structuredClone(expected);
      const confirmedBefore = structuredClone(confirmed);
      assert.deepEqual(getUnconfirmedDocumentIds(expected, confirmed), missing);
      assert.deepEqual(expected, expectedBefore);
      assert.deepEqual(confirmed, confirmedBefore);
    });
  }

  it("rejects invalid expected IDs instead of silently dropping required writes", () => {
    for (const ids of [null, "a", [""], [null], [1]]) {
      assert.throws(() => getUnconfirmedDocumentIds(ids, []), TypeError);
    }
  });

  it("preserves missing document references on an unconfirmed native result", () => {
    assert.throws(() => assertDocumentWriteConfirmed(["a", "b"], undefined, "Actor.pc.Item"), error => {
      assert.deepEqual(error.unconfirmedDocumentIds, ["a", "b"]);
      assert.deepEqual(error.documentReferences, ["Actor.pc.Item.a", "Actor.pc.Item.b"]);
      return true;
    });
  });
});

describe("Migration pass decisions with ordinary callbacks", () => {
  it("checks persisted revisions after a pass rather than accepting its success claim", async () => {
    const state = {};
    let reads = 0;
    const result = await executeMigrationPasses({
      passes: [{ name: "items", run: async () => ({ ok: true }) }],
      canRun: () => true,
      getPendingKeys: () => { reads++; return getPendingMigrationKeys(["items"], state); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "pending-revisions");
    assert.deepEqual(result.pendingKeys, ["items"]);
    assert.equal(result.failedPass, null);
    assert.equal(reads, 1);
  });

  it("accepts a no-work sequence only when persisted required revisions are complete", async () => {
    const result = await executeMigrationPasses({ passes: [], canRun: () => true, getPendingKeys: () => [] });
    assert.deepEqual(result, { ok: true, pendingKeys: [], failedPass: null });
  });

  it("propagates a failed pass and preserves its detailed failure references", async () => {
    const error = new Error("partial native update");
    error.documentReferences = ["Actor.a", "Actor.b"];
    const calls = [];
    const result = await executeMigrationPasses({
      passes: [
        { name: "actors", run: async () => { calls.push("actors"); throw error; } },
        { name: "items", run: async () => { calls.push("items"); } },
      ],
      canRun: () => true, getPendingKeys: () => ["actors", "items"],
    });
    assert.equal(result.ok, false);
    assert.equal(result.err, error);
    assert.equal(result.failedPass, "actors");
    assert.deepEqual(result.pendingKeys, ["actors", "items"]);
    assert.deepEqual(calls, ["actors"]);
  });

  it("does not swallow a pass's explicit rejection", async () => {
    const result = await executeMigrationPasses({
      passes: [{ name: "settings", run: async () => ({ ok: false, reason: "not-active-gm" }) }],
      canRun: () => true, getPendingKeys: () => ["settings"],
    });
    assert.equal(result.ok, false);
    assert.equal(result.failedPass, "settings");
    assert.equal(result.err.passResult.reason, "not-active-gm");
  });

  it("checks authority before every pass and before aggregate success", async () => {
    for (const finalPass of [false, true]) {
      let authority = true;
      const calls = [];
      const passes = [{ name: "settings", run: async () => { calls.push("settings"); authority = false; } }];
      if (!finalPass) passes.push({ name: "items", run: async () => { calls.push("items"); } });
      const result = await executeMigrationPasses({ passes, canRun: () => authority, getPendingKeys: () => ["items"] });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "not-active-gm");
      assert.deepEqual(calls, ["settings"]);
    }
  });

  it("does not execute a pass when authority is unavailable", async () => {
    let called = false;
    const result = await executeMigrationPasses({
      passes: [{ name: "actors", run: async () => { called = true; } }],
      canRun: () => false, getPendingKeys: () => ["actors"],
    });
    assert.equal(called, false);
    assert.equal(result.reason, "not-active-gm");
    assert.equal(result.failedPass, "actors");
  });

  it("retains the original pass error when inspecting pending revisions also fails", async () => {
    const original = new Error("write failed");
    const inspection = new Error("state unavailable");
    const result = await executeMigrationPasses({
      passes: [{ name: "items", run: async () => { throw original; } }], canRun: () => true,
      getPendingKeys: () => { throw inspection; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.err, original);
    assert.equal(result.stateError, inspection);
  });

  it("does not report success when the final revision read fails", async () => {
    const result = await executeMigrationPasses({
      passes: [], canRun: () => true, getPendingKeys: () => { throw new Error("unavailable"); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "error");
  });

  it("leaves historical failures intact when startup skips their existing pass", async () => {
    const state = { items: { revision: 1, failures: 1, appliedAt: 123 } };
    const before = structuredClone(state);
    const result = await executeMigrationPasses({
      passes: [{ name: "existing-startup-pass", run: async () => { throw new Error("must not run"); } }],
      canRun: () => true, getPendingKeys: () => getPendingMigrationKeys(["items"], state),
      shouldRun: () => getMigrationFailureCount(state.items) === 0,
    });
    assert.equal(result.reason, "pending-revisions");
    assert.deepEqual(state, before);
  });
});

describe("Migration startup/manual coordination", () => {
  it("joins duplicate requests for the same queued scope", async () => {
    const coordinator = createMigrationCoordinator();
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let calls = 0;
    const first = coordinator.run("manual", async () => { calls++; entered.resolve(); await release.promise; return "complete"; });
    try {
      await entered.promise;
      const second = coordinator.run("manual", async () => { calls++; return "duplicate"; });
      assert.equal(second, first);
      assert.equal(coordinator.isRunning(), true);
    } finally { release.resolve(); }
    assert.equal(await first, "complete");
    assert.equal(calls, 1);
    assert.equal(coordinator.isRunning(), false);
  });

  it("runs the full manual sequence queued behind startup", async () => {
    const coordinator = createMigrationCoordinator();
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const events = [];
    const startup = coordinator.run("startup", async () => {
      events.push("startup-settings"); entered.resolve(); await release.promise;
      events.push("startup-armor"); return { scope: "startup" };
    });
    await entered.promise;
    const manual = coordinator.run("manual", async () => {
      events.push("manual-settings", "manual-actors", "manual-items", "manual-armor", "manual-combat");
      return { scope: "full-manual" };
    });
    try { assert.deepEqual(events, ["startup-settings"]); } finally { release.resolve(); }
    assert.equal((await startup).scope, "startup");
    assert.equal((await manual).scope, "full-manual");
    assert.deepEqual(events, ["startup-settings", "startup-armor", "manual-settings", "manual-actors", "manual-items", "manual-armor", "manual-combat"]);
    assert.equal(coordinator.isRunning(), false);
  });

  it("allows explicit retry after failure and does not poison a queued manual request", async () => {
    const coordinator = createMigrationCoordinator();
    const first = coordinator.run("startup", async () => { throw new Error("startup interrupted"); });
    const manual = coordinator.run("manual", async () => "manual complete");
    await assert.rejects(first, /startup interrupted/);
    assert.equal(await manual, "manual complete");
    assert.equal(await coordinator.run("startup", async () => "explicit retry"), "explicit retry");
    assert.equal(coordinator.isRunning(), false);
  });

  it("re-evaluates fresh pending state when a queued scope starts", async () => {
    const coordinator = createMigrationCoordinator();
    const state = {};
    const startup = coordinator.run("startup", async () => { state.items = { revision: 1 }; });
    const manual = coordinator.run("manual", () => executeMigrationPasses({
      passes: [], canRun: () => true, getPendingKeys: () => getPendingMigrationKeys(["items"], state),
    }));
    await startup;
    assert.equal((await manual).ok, true);
  });
});
