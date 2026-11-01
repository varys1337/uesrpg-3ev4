import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  createSpecialActionOperation, planSpecialActionSource, specialActionEligibility, specialActionIntent,
  specialActionOperationId, specialActionRecoveryDecision, specialActionResolutionSignature,
  specialActionReviewSignature, validateSpecialActionOperation, validateSpecialActionReconciliation, planSpecialAdvantageSource,
} from "../../src/core/combat/special-action-operations.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/special-actions.json", import.meta.url), "utf8"));
const plan = (state = fixture.state, entries = [], extra = {}) => planSpecialActionSource({
  sourceUuid: fixture.sourceUuid, sourceKind: fixture.sourceKind, state: structuredClone(state), entries: structuredClone(entries), ...extra,
});
const asOutcome = entry => ({ ...structuredClone(entry), id: entry.operation.id, adapter: "combat.special" });
const freshOutcome = () => asOutcome(plan()[0]);
const recover = (outcome, receipt = null, extra = {}) => specialActionRecoveryDecision({
  outcome, receipt, processorUserId: "generated-gm", processorSession: "generated-session", ...extra,
});

describe("Special-action identities and committed result generations", () => {
  it("imports the canonical helpers without Foundry globals", () => {
    assert.equal(globalThis.game, undefined);
    assert.equal(globalThis.foundry, undefined);
  });
  it("uses the exact encoded source, family, revision, slot and action identity", () => {
    const outcome = freshOutcome();
    assert.equal(outcome.id, "special:ChatMessage.generated-special-result:skillOpposed:1:action:bash");
    assert.equal(specialActionOperationId(outcome.operation), outcome.id);
    assert.equal(validateSpecialActionOperation(outcome), null);
  });
  it("gives duplicate events and two requesters the same planned identity", () => {
    assert.deepEqual(plan(), plan());
    assert.deepEqual(plan(fixture.state, [asOutcome(plan()[0])]), []);
  });
  it("does not create a generation for content, timestamps, author or general sequence changes", () => {
    const state = structuredClone(fixture.state);
    state.context.updatedSeq = 999;
    state.context.updatedAt = 2000;
    state.context.updatedBy = "another-requester";
    state.outcome.text = "Changed presentation";
    state.attacker.name = "Different display name";
    assert.equal(specialActionResolutionSignature(state), specialActionResolutionSignature(fixture.state));
    assert.deepEqual(plan(state, [asOutcome(plan()[0])]), []);
  });
  it("does not derive identity from native Roll serialization or result labels", () => {
    const state = structuredClone(fixture.state);
    state.attacker.result.roll = { formula: "1d100", total: 18 };
    state.attacker.result.textual = "Changed label";
    assert.equal(specialActionResolutionSignature(state), specialActionResolutionSignature(fixture.state));
  });
  it("accepts a real reroll even when its numeric result is the same", () => {
    const first = freshOutcome();
    const state = structuredClone(fixture.state);
    state.attacker.rollMessageId = "generated-reroll-a";
    const next = plan(state, [first]);
    assert.equal(next.length, 1);
    assert.equal(next[0].operation.resultRevision, 2);
    assert.equal(next[0].operation.id, "special:ChatMessage.generated-special-result:skillOpposed:2:action:bash");
  });
  it("creates a distinct generation for a changed committed result", () => {
    const state = structuredClone(fixture.state);
    state.defender.result.rollTotal = 80;
    assert.equal(plan(state, [freshOutcome()])[0].operation.resultRevision, 2);
  });
  it("keeps source families and advantage slots independent", () => {
    const payload = freshOutcome().payload;
    const first = createSpecialActionOperation({ sourceUuid: fixture.sourceUuid, sourceKind: "advantage.attacker", slot: "attacker:0", payload });
    const second = createSpecialActionOperation({ sourceUuid: fixture.sourceUuid, sourceKind: "advantage.defender", slot: "defender:0", payload });
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.id, createSpecialActionOperation({ sourceUuid: fixture.sourceUuid, sourceKind: "advantage.attacker", slot: "attacker:1", payload }).id);
  });
  it("does not apply an unresolved or tied result", () => {
    assert.deepEqual(plan({ ...fixture.state, outcome: null }), []);
    assert.deepEqual(plan({ ...fixture.state, outcome: { winner: "tie" } }), []);
  });
  it("plans the existing In Close failure reaction instead of toggling In Close", () => {
    const entries = plan({ ...fixture.state, specialActionId: "inClose", outcome: { winner: "defender" } });
    assert.equal(entries[0].payload.followUp, "inCloseFailure");
    assert.equal(specialActionEligibility(entries[0].payload), "reaction");
  });
  it("rejects malformed revisions and unknown actions", () => {
    const payload = freshOutcome().payload;
    for (const resultRevision of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createSpecialActionOperation({ sourceUuid: fixture.sourceUuid, resultRevision, payload }), TypeError);
    assert.deepEqual(plan({ ...fixture.state, specialActionId: "not-an-action" }), []);
  });
  it("preserves source state and existing entries", () => {
    const state = structuredClone(fixture.state);
    const entries = [freshOutcome()];
    const before = structuredClone({ state, entries });
    plan(state, entries);
    assert.deepEqual({ state, entries }, before);
  });
  for (const specialActionId of ["arise", "bash", "blindOpponent", "disarm", "feint", "forceMovement", "grapple", "resist", "trip", "inClose"]) {
    it(`plans the existing ${specialActionId} action without running an effect`, () => {
      const entry = plan({ ...fixture.state, specialActionId })[0];
      assert.equal(entry.payload.specialActionId, specialActionId);
      assert.equal(entry.targetUuid, ["arise", "resist"].includes(specialActionId) ? "Actor.generated-a" : "Actor.generated-b");
      assert.equal(specialActionEligibility(entry.payload), "effect");
    });
  }
  it("quarantines a resolved source with missing committed rolls", () => {
    const entry = plan({ ...fixture.state, defender: { ...fixture.state.defender, result: null } })[0];
    assert.equal(entry.operation.legacy, "review");
    assert.equal(entry.status, "partial");
  });
});

describe("Advantage selection recovery identities", () => {
  const advantagePlan = (extra = {}) => planSpecialAdvantageSource({ sourceUuid: fixture.sourceUuid, state: fixture.state,
    role: "attacker", specialActionId: "bash", index: 0, actorUuid: "Actor.generated-a", opponentUuid: "Actor.generated-b",
    actorTokenUuid: "Scene.generated.Token.a", opponentTokenUuid: "Scene.generated.Token.b", ...extra });
  it("flags a selection saved before its mode prompt for review", () => {
    const entry = advantagePlan();
    assert.equal(entry.status, "partial");
    assert.equal(entry.operation.legacy, "review");
    assert.equal(entry.autoEligible, false);
    assert.equal(entry.payload.launch, null);
  });
  it("reserves the same identity used after mode selection is persisted", () => {
    const pending = advantagePlan();
    const operation = createSpecialActionOperation({ ...pending.operation, payload: {
      ...pending.payload, isAutoWin: true, launch: { mode: "autowin", apCost: 1 },
    }, legacy: null });
    assert.equal(operation.id, pending.operation.id);
    assert.equal(advantagePlan({ entries: [{ operation }] }), null);
  });
  it("keeps separate targets, roles and selection slots independent", () => {
    const first = advantagePlan();
    assert.notEqual(advantagePlan({ index: 1 }).operation.id, first.operation.id);
    assert.notEqual(advantagePlan({ opponentTokenUuid: "Scene.generated.Token.other" }).operation.id, first.operation.id);
    assert.notEqual(advantagePlan({ role: "defender" }).operation.id, first.operation.id);
  });
  it("allocates one new revision for a genuine result change", () => {
    const first = advantagePlan();
    const state = structuredClone(fixture.state);
    state.attacker.rollMessageId = "new-generated-roll";
    assert.equal(advantagePlan({ state, entries: [first] }).operation.resultRevision, 2);
  });
  it("does not overwrite unknown prior operation versions", () => {
    const first = advantagePlan();
    first.operation.version = 2;
    assert.equal(advantagePlan({ entries: [first] }), null);
  });
});

describe("Immutable special-action intent and eligibility", () => {
  for (const key of ["specialActionId", "actorUuid", "targetUuid", "actorTokenUuid", "targetTokenUuid", "isAutoWin", "launch", "activation"]) {
    it(`rejects an operation-ID collision that changes ${key}`, () => {
      const outcome = freshOutcome();
      outcome.payload[key] = key === "isAutoWin" ? true : key === "launch" ? { mode: "free", apCost: 0 } : key === "activation" ? { actionType: "free" } : "changed";
      assert.ok(validateSpecialActionOperation(outcome));
    });
  }
  it("binds an Actor receipt to its saved operation", () => {
    const outcome = freshOutcome();
    const operation = structuredClone(outcome.operation);
    operation.intent.targetUuid = "Actor.other";
    assert.match(validateSpecialActionOperation(outcome, { operation }), /different choices/);
    assert.match(validateSpecialActionOperation(outcome, { status: "processing" }), /no matching operation/);
  });
  it("rejects future operation versions without normalizing them", () => {
    const outcome = freshOutcome();
    outcome.operation.version = 2;
    const before = structuredClone(outcome);
    assert.equal(recover(outcome).action, "review");
    assert.deepEqual(outcome, before);
  });
  it("distinguishes ordinary results, auto-wins and defender free-action launches", () => {
    assert.equal(specialActionEligibility({ specialActionId: "trip", opposedResult: { winner: "defender" } }), "none");
    assert.equal(specialActionEligibility({ specialActionId: "trip", isAutoWin: true, opposedResult: { winner: "defender" } }), "effect");
    assert.equal(specialActionEligibility({ specialActionId: "trip", launch: { mode: "free" }, opposedResult: { winner: "defender" } }), "launch");
    assert.equal(specialActionEligibility({ specialActionId: "unknown", isAutoWin: true }), "unavailable");
  });
  it("ignores presentation and preparation when binding the original choices", () => {
    const payload = freshOutcome().payload;
    assert.deepEqual(specialActionIntent({ ...payload, prepared: { bashResult: { prone: true } }, message: "changed" }), specialActionIntent(payload));
  });
  it("takes its own copy of nested choices before binding an operation", () => {
    const payload = { ...freshOutcome().payload, launch: { mode: "autowin", apCost: 1 } };
    const operation = createSpecialActionOperation({ sourceUuid: fixture.sourceUuid, payload });
    payload.launch.apCost = 0;
    assert.equal(operation.intent.launch.apCost, 1);
    assert.ok(validateSpecialActionOperation({ id: operation.id, operation, payload }));
  });
  it("handles malformed nullable inputs without Foundry access", () => {
    assert.equal(specialActionEligibility(null), "unavailable");
    assert.equal(specialActionIntent(null).actorUuid, "");
    assert.equal(specialActionRecoveryDecision().action, "review");
    assert.equal(typeof specialActionResolutionSignature(null), "string");
  });
});

describe("Saved-checkpoint failure and recovery decisions", () => {
  for (const entry of fixture.recoveryCases) {
    it(entry.name, () => {
      const outcome = freshOutcome();
      outcome.status = entry.sourceStatus;
      const receipt = entry.receiptStatus ? { operation: structuredClone(outcome.operation), status: entry.receiptStatus,
        processorUserId: entry.changedProcessor ? "other-gm" : "generated-gm", processorSession: entry.changedSession ? "old-session" : "generated-session",
        stages: entry.stageStatus ? { "bash.ap": { status: entry.stageStatus, result: { paid: true } } } : {} } : null;
      const before = structuredClone({ outcome, receipt });
      assert.equal(recover(outcome, receipt).action, entry.expected);
      assert.deepEqual({ outcome, receipt }, before);
    });
  }
  it("requires review when an uncommitted target is deleted", () => {
    assert.equal(recover(freshOutcome(), null, { hasTarget: false }).action, "review");
  });
  it("requires review when a completed card lacks a receipt even after target deletion", () => {
    assert.equal(recover({ ...freshOutcome(), status: "applied" }, null, { hasTarget: false }).action, "review");
  });
  it("supersedes an older unstarted result without applying it", () => {
    assert.equal(recover(freshOutcome(), null, { current: false }).action, "superseded");
  });
  it("requires review when a result changes after a confirmed consequence", () => {
    const outcome = freshOutcome();
    const receipt = { operation: outcome.operation, status: "waitingGM", stages: { "bash.ap": { status: "applied", result: { paid: true } } } };
    assert.equal(recover(outcome, receipt, { current: false }).action, "review");
  });
  it("does not infer completion from an empty observed-change set", () => {
    const outcome = freshOutcome();
    const receipt = { operation: outcome.operation, status: "partial", stages: { "bash.ap": { status: "started", observedChanges: [] } } };
    assert.equal(recover(outcome, receipt).action, "review");
  });
  it("requires review for untracked legacy results without a completed receipt", () => {
    const old = freshOutcome();
    delete old.operation;
    assert.equal(recover(old).action, "review");
    assert.equal(recover({ ...old, status: "applied" }).action, "review");
    assert.equal(recover(old, { status: "applied" }).action, "replay");
    const legacy = asOutcome(plan(fixture.state, [], { legacy: "review" })[0]);
    assert.equal(legacy.status, "partial");
    assert.equal(recover(legacy).action, "review");
  });
  it("requires review for a legacy completed marker without a receipt", () => {
    const legacy = asOutcome(plan(fixture.state, [], { legacy: "complete" })[0]);
    assert.equal(legacy.status, "applied");
    assert.equal(recover(legacy).action, "review");
  });
});

describe("GM reconciliation decisions", () => {
  const valid = () => ({ isGM: true, reason: "Inspected and repaired manually", processorStopped: true, disposition: "resolved", expected: "saved-view", actual: "saved-view" });
  it("accepts both explicit terminal dispositions", () => {
    assert.equal(validateSpecialActionReconciliation(valid()), null);
    assert.equal(validateSpecialActionReconciliation({ ...valid(), disposition: "abandoned" }), null);
  });
  for (const patch of [{ isGM: false }, { processorStopped: false }, { reason: " " }, { disposition: "retry" }, { actual: "changed-view" }]) {
    it(`rejects incomplete or stale reconciliation ${JSON.stringify(patch)}`, () => assert.ok(validateSpecialActionReconciliation({ ...valid(), ...patch })));
  }
  it("changes its review signature when receipt evidence changes", () => {
    const outcome = freshOutcome();
    const receipt = { status: "partial", stages: { "bash.ap": { status: "started" } } };
    const signature = specialActionReviewSignature(outcome, receipt);
    assert.match(signature, /^[0-9a-f]{32}$/);
    receipt.stages["bash.ap"].status = "applied";
    assert.notEqual(specialActionReviewSignature(outcome, receipt), signature);
  });
});
