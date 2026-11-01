import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTION_STATUSES, createActionResult, withActionResult, getActionResult, aggregateActionResults,
  actionResultFromReceipt, actionResultFromEvidence, addActionErrorContext } from "../../src/application/action-results.js";
import { result as hudResult, routeFeatureActivation } from "../../src/integrations/token-action-hud/helpers.js";

const result = overrides => createActionResult({ owner: "fixture", scope: "application", status: "complete", ...overrides });
describe("transient action result contract", () => {
  for (const status of Object.values(ACTION_STATUSES)) it(`reports ${status} without truthy-object success`, () => {
    const value = result({ status });
    assert.equal(value.ok, status === "complete");
    assert.equal(value.status, status);
    assert.equal(value.version, 1);
  });
  for (const status of ["pending", "processing"]) it(`distinguishes accepted ${status} from completion`, () => {
    const value = withActionResult({ ok: true, success: true }, { ...result({ status }), accepted: true });
    assert.equal(value.ok, false); assert.equal(value.success, false); assert.equal(value.actionResult.accepted, true);
  });
  for (const status of ["cancelled", "blocked", "rejected"]) it(`retains paid costs after ${status}`, () => {
    assert.equal(result({ status, commitment: "confirmed" }).status, "partial");
  });
  it("does not turn a known no-effect completion into a write", () => {
    assert.equal(result().commitment, "none"); assert.equal(result().ok, true);
  });
  it("uncertain acknowledgement requires inspection even after apparent success", () => {
    assert.equal(result({ status: "complete", commitment: "uncertain" }).status, "needsReview");
  });
  it("only copies allowed references and sanitized text", () => {
    const value = result({ reason: "x\n<script>", references: { operationId: "op", actorUuid: "Actor.a", payload: { private: true } } });
    assert.deepEqual(value.references, { operationId: "op", actorUuid: "Actor.a" });
    assert.equal(value.reason, "x <script>");
  });
  it("reads an authority data envelope without treating its transport ok as application evidence", () => {
    const evidence = result({ status: "pending" });
    assert.equal(getActionResult({ ok: true, data: { actionResult: evidence } }), evidence);
    assert.equal(getActionResult({ ok: true }), null);
  });
  it("rejects unsupported descriptor versions", () => {
    assert.equal(getActionResult({ ...result(), version: 2 }), null);
  });
  it("does not decorate native objects", () => {
    class NativeValue {}
    assert.throws(() => withActionResult(new NativeValue(), result()), TypeError);
  });
  it("preserves input and underlying rule fields", () => {
    const original = { success: true, rollSuccess: false, damage: 0 };
    const value = withActionResult(original, result({ status: "pending" }));
    assert.deepEqual(original, { success: true, rollSuccess: false, damage: 0 });
    assert.equal(value.rollSuccess, false); assert.equal(value.damage, 0);
  });
  it("preserves exception identity and cause", () => {
    const cause = new Error("native failure"); const error = new Error("application", { cause });
    assert.equal(addActionErrorContext(error, result({ status: "needsReview", commitment: "uncertain" })), error);
    assert.equal(error.cause, cause); assert.equal(error.actionResult.ok, false);
  });
  for (const [states, expected] of [
    [["complete", "complete"], "complete"], [["complete", "pending"], "pending"],
    [["complete", "blocked"], "partial"], [["rejected", "pending"], "partial"],
    [["processing", "pending"], "processing"], [["complete", "needsReview"], "needsReview"],
    [["cancelled", "cancelled"], "cancelled"], [["blocked", "rejected"], "rejected"],
  ]) it(`aggregates ${states.join("/")} as ${expected}`, () => {
    const combined = aggregateActionResults(states.map(status => result({ status })), { owner: "batch", scope: "all targets" });
    assert.equal(combined.status, expected); assert.equal(combined.targets.length, states.length);
  });
  it("rejects a batch lacking explicit evidence", () => {
    assert.throws(() => aggregateActionResults([result(), {}], { owner: "batch", scope: "all" }), TypeError);
  });
  for (const [status, expected] of [["applied", "complete"], ["partial", "needsReview"], ["processing", "processing"],
    ["waitingGM", "pending"], ["failed", "rejected"]]) it(`projects receipt ${status} as ${expected}`, () => {
    assert.equal(actionResultFromReceipt({ status }, { owner: "receipt", scope: "application" }).status, expected);
  });
  it("retains interrupted-stage evidence independently of the parent status", () => {
    assert.equal(actionResultFromReceipt({ status: "applied", stages: { write: { status: "started" } } },
      { owner: "receipt", scope: "application" }).status, "needsReview");
  });
  it("preparation and observed current values do not establish commitment", () => {
    const receipt = { status: "applied", stages: { prepare: { status: "applied", result: { prepared: true } } }, hp: 0 };
    assert.equal(actionResultFromReceipt(receipt, { owner: "receipt", scope: "application" }).commitment, "none");
  });
  it("a completed replay uses only the recorded confirmed execution", () => {
    const receipt = { status: "applied", stages: { health: { status: "applied", result: { execution: { committed: true } } } } };
    assert.equal(actionResultFromReceipt(receipt, { owner: "receipt", scope: "application" }).commitment, "confirmed");
  });
});

describe("action owner evidence and caller propagation", () => {
  for (const [name, evidence, expected, commitment] of [
    ["no required write", {}, "complete", "none"],
    ["confirmed health", { confirmed: true }, "complete", "confirmed"],
    ["queued targets after payment", { confirmed: true, pending: true }, "pending", "confirmed"],
    ["active authority", { processing: true }, "processing", "none"],
    ["permission refusal", { rejected: true }, "rejected", "none"],
    ["rule gate", { blocked: true }, "blocked", "none"],
    ["explicit cancellation", { cancelled: true }, "cancelled", "none"],
    ["cancellation after payment", { confirmed: true, cancelled: true }, "partial", "confirmed"],
    ["partly completed targets", { confirmed: true, partial: true }, "partial", "confirmed"],
    ["unacknowledged write", { uncertain: true }, "needsReview", "uncertain"],
    ["query failure after payment", { confirmed: true, uncertain: true }, "needsReview", "uncertain"],
  ]) it(name, () => {
    const original = structuredClone(evidence);
    const value = actionResultFromEvidence({ ...evidence, owner: "fixture", scope: "selected work" });
    assert.equal(value.status, expected); assert.equal(value.commitment, commitment); assert.deepEqual(evidence, original);
  });
  for (const [name, overrides] of [["inconsistent ok", { status: "pending", ok: true }], ["uncertain complete", { commitment: "uncertain" }],
    ["confirmed rejection", { status: "rejected", ok: false, commitment: "confirmed" }], ["unaccepted completion", { accepted: false }]]) {
    it(`refuses ${name} from a transport`, () => assert.equal(getActionResult({ data: { actionResult: { ...result(), ...overrides } } }), null));
  }
  for (const status of ["complete", "pending", "blocked", "cancelled", "partial", "needsReview"]) {
    it(`HUD preserves ${status} instead of its dispatch success flag`, async () => {
      const actionResult = result({ status });
      const returned = { ok: actionResult.ok, actionResult };
      assert.equal(hudResult(true, "casting", { result: returned }).ok, actionResult.ok);
      let calls = 0;
      const forwarded = await routeFeatureActivation({ item: { type: "talent" },
        activateTalentFromItemSheet: async () => { calls++; return returned; } });
      assert.equal(calls, 1); assert.equal(forwarded.actionResult, actionResult); assert.equal(forwarded.ok, actionResult.ok);
    });
  }
  it("a handler without evidence does not become a completed feature", async () => {
    const returned = await routeFeatureActivation({ item: { type: "talent" }, activateTalentFromItemSheet: async () => undefined });
    assert.equal(returned.ok, false); assert.equal(returned.actionResult.status, "needsReview");
  });
  it("batch transport descriptors survive a JSON round trip with their existing authority code", () => {
    const value = result({ status: "rejected", code: "STALE_REVISION", references: { requestId: "request-1", operationId: "op-1" } });
    const copied = JSON.parse(JSON.stringify({ ok: false, data: { actionResult: value } }));
    assert.deepEqual(getActionResult(copied), value);
  });
  it("has no commitment evidence merely because the saved result is truthy", () => {
    const value = actionResultFromReceipt({ status: "applied", result: { currentHP: 0, effects: [{}], damage: 100 } },
      { owner: "receipt", scope: "application" });
    assert.equal(value.commitment, "none");
  });
  for (const disposition of ["resolved", "abandoned"]) it(`retains GM ${disposition} reconciliation as terminal evidence`, () => {
    const value = actionResultFromReceipt({ status: "applied", stages: { write: { status: "partial" } },
      reconciliation: { version: 1, disposition, reason: "Manually inspected." } }, { owner: "receipt", scope: "application" });
    assert.equal(value.ok, true); assert.equal(value.commitment, "none"); assert.equal(value.reason, "Manually inspected.");
  });
  it("an unsupported reconciliation format does not erase uncertain writes", () => {
    const value = actionResultFromReceipt({ status: "applied", stages: { write: { status: "partial" } },
      reconciliation: { version: 2, disposition: "resolved" } }, { owner: "receipt", scope: "application" });
    assert.equal(value.status, "needsReview");
  });
});
