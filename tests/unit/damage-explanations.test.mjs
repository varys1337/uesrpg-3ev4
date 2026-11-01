import assert from "node:assert/strict";


import { describe, it } from "node:test";
import {
  recordedDamageNumber, projectWeaponDamageExplanation, selectDamageExplanationLane, projectGmDamageExplanation,
  projectRecordedMessageRolls, projectStandaloneDamageEvidence,
} from "../../src/core/combat/damage/explanation.js";

// Synthetic saved-state examples, not native Documents or observed campaign records.
const report = () => ({
  panelKey: "generated-panel", totalDamage: 5, hitLocation: "Body",
  hp: { value: 14, max: 20, delta: 5 }, tempHp: { value: 0, absorbed: 2 },
  buffers: [{ pool: "physical", remaining: 1, absorbed: 3 }],
  woundTriggered: false, woundThreshold: 4, defeated: false,
  segments: [{ damageType: "physical", rawDamage: 8, reductionTotal: 3, applied: 5,
    sourceNotes: ["Unverified source +999"], reductionNotes: ["Unverified armor 999"] }],
  traitNotes: ["Unverified trait 999"], privateOtherData: "secret",
});
const receipt = () => ({
  id: "generated-receipt", kind: "damage", status: "applied", result: {
    damage: 5, settledHP: 14, oldHP: 19, settledTempHP: 0, oldTempHP: 2, tempHPAbsorbed: 2,
    gmDamageReport: report(),
    components: [{ damageType: "physical", sourceLabel: "Generated weapon", rawDamage: 8, dosBonus: 0, weaponBonus: 0,
      reductions: { armor: 2, resistance: 0, toughness: 1, penetrated: 1, total: 3 }, finalDamage: 5, finalApplied: 5 }],
  },
});
const lane = (extra = {}) => ({ actorUuid: "Actor.generated", tokenUuid: "Scene.generated.Token.a",
  targetUuid: "Actor.generated", outcomeId: "generated-operation", damage: { gmDamageReport: report() }, ...extra });

describe("Recorded damage values", () => {
  it("imports production projections without Foundry globals", () => {
    assert.equal(globalThis.game, undefined);
    assert.equal(globalThis.foundry, undefined);
    assert.equal(globalThis.document, undefined);
  });
  for (const [name, input, expected] of [
    ["zero", 0, 0], ["negative", -4, -4], ["decimal", 1.25, 1.25],
    ["string zero", "0", 0], ["signed string", " -2.5 ", -2.5], ["exponent", "1e2", 100],
    ["missing", undefined, null], ["null", null, null], ["empty", "", null], ["blank", "  ", null],
    ["boolean", false, null], ["object", { value: 5 }, null], ["array", [5], null],
    ["NaN", NaN, null], ["infinity", Infinity, null], ["overflow", "1e999", null],
    ["malformed", "5 damage", null], ["hex", "0x10", null], ["formula", "1d6", null],
  ]) it(`preserves or rejects ${name} without a numeric default`, () => assert.equal(recordedDamageNumber(input), expected));
});

describe("Public weapon evidence", () => {
  it("copies recorded rolls and result without selecting a winner or recomputing totals", () => {
    assert.deepEqual(projectWeaponDamageExplanation({ damageString: "1d8+2", rollATotal: 3, rollBTotal: 10,
      finalDamage: 7, hitLocation: "custom location", damageComponents: [{ sourceLabel: "Weapon", damageType: "custom", amount: -1 }] }), {
      formula: "1d8+2", rollA: 3, rollB: 10, result: 7, hitLocation: "custom location",
      components: [{ label: "Weapon", damageType: "custom", amount: -1 }],
    });
  });
  it("does not traverse GM reports, receipts, apply payloads or arbitrary properties", () => {
    const input = { finalDamage: 0, hidden: "secret", damageComponents: [{ amount: 0, privateData: "secret" }] };
    for (const key of ["gmDamageReport", "receipt", "applyPayload"]) Object.defineProperty(input, key, {
      get() { throw new Error(`Public projection traversed ${key}`); },
    });
    assert.deepEqual(projectWeaponDamageExplanation(input), { formula: null, rollA: null, rollB: null,
      result: 0, hitLocation: null, components: [{ label: null, damageType: null, amount: 0 }] });
  });
  it("does not use private payload totals to fill a missing attack result", () => {
    assert.equal(projectWeaponDamageExplanation({ applyPayload: { damage: 100 } }).result, null);
  });
  it("retains multiple valid rows and marks malformed amounts unavailable", () => {
    assert.deepEqual(projectWeaponDamageExplanation({ damageComponents: [null, false, [],
      { displayLabel: "Preferred", sourceLabel: "Other", amount: "0", damageType: "silver" },
      { source: "Ammo", amount: "bad" }] }).components, [
      { label: "Preferred", damageType: "silver", amount: 0 }, { label: "Ammo", damageType: null, amount: null },
    ]);
  });
  it("handles absent and malformed old card data", () => {
    for (const value of [undefined, null, [], "bad"]) assert.deepEqual(projectWeaponDamageExplanation(value), {
      formula: null, rollA: null, rollB: null, result: null, hitLocation: null, components: [],
    });
  });
  it("preserves inputs and returns detached component rows", () => {
    const input = { finalDamage: "5", damageComponents: [{ amount: 3, sourceLabel: "Generated" }] };
    const before = structuredClone(input);
    const model = projectWeaponDamageExplanation(input);
    model.components[0].amount = 99;
    assert.deepEqual(input, before);
  });
});

describe("Exact damage source matching", () => {
  it("requires identity instead of choosing the first report", () => {
    assert.equal(selectDamageExplanationLane([lane()]), null);
  });
  it("matches every supplied operation, panel, Actor and Token constraint", () => {
    const saved = lane();
    assert.equal(selectDamageExplanationLane([saved], { targetUuid: saved.actorUuid, tokenUuid: saved.tokenUuid,
      outcomeId: saved.outcomeId, panelKey: "generated-panel" }), saved);
  });
  for (const identity of [{ targetUuid: "Actor.other" }, { tokenUuid: "Scene.generated.Token.other" },
    { outcomeId: "another-operation" }, { panelKey: "stale-panel" }]) {
    it(`rejects mismatched ${Object.keys(identity)[0]} even when the target matches`, () => {
      assert.equal(selectDamageExplanationLane([lane()], { targetUuid: "Actor.generated", ...identity }), null);
    });
  }
  it("rejects duplicate target lanes without enough distinguishing evidence", () => {
    assert.equal(selectDamageExplanationLane([lane(), lane({ tokenUuid: "Scene.generated.Token.b" })], {
      targetUuid: "Actor.generated",
    }), null);
  });
  it("distinguishes two linked tokens using the supplied Token identity", () => {
    const second = lane({ tokenUuid: "Scene.generated.Token.b" });
    assert.equal(selectDamageExplanationLane([lane(), second], { targetUuid: "Actor.generated", tokenUuid: second.tokenUuid }), second);
  });
  it("distinguishes independent unlinked Actor targets", () => {
    const second = lane({ actorUuid: "Scene.generated.Token.b.Actor.synthetic", targetUuid: "Scene.generated.Token.b.Actor.synthetic" });
    assert.equal(selectDamageExplanationLane([lane(), second], { targetUuid: second.targetUuid }), second);
  });
  it("uses the declared counterattack victim instead of the original defender", () => {
    const counter = lane({ targetUuid: "Actor.attacker" });
    assert.equal(selectDamageExplanationLane([counter], { targetUuid: "Actor.generated" }), null);
    assert.equal(selectDamageExplanationLane([counter], { targetUuid: "Actor.attacker" }), counter);
  });
  it("rejects duplicate panel keys instead of trusting their first occurrence", () => {
    assert.equal(selectDamageExplanationLane([lane(), lane()], { panelKey: "generated-panel" }), null);
  });
  it("allows a unique same-lane historical report without an operation ID", () => {
    const historical = lane({ outcomeId: undefined });
    assert.equal(selectDamageExplanationLane([historical], { targetUuid: historical.targetUuid, panelKey: "generated-panel" }), historical);
  });
  it("handles missing candidates without mutating their identity", () => {
    const candidates = [lane()];
    const before = structuredClone(candidates);
    selectDamageExplanationLane(candidates, { targetUuid: "Actor.other" });
    assert.deepEqual(candidates, before);
    assert.equal(selectDamageExplanationLane(null, { targetUuid: "Actor.generated" }), null);
    assert.equal(selectDamageExplanationLane(candidates, null), null);
  });
});

describe("GM structured application evidence", () => {
  it("copies canonical fields exactly without performing damage arithmetic", () => {
    const model = projectGmDamageExplanation({ receipt: receipt() });
    assert.equal(model.source, "receipt");
    assert.equal(model.status, "applied");
    assert.equal(model.total, 5);
    assert.deepEqual(model.hp, { before: 19, value: 14, max: 20, delta: 5, absorbed: null });
    assert.deepEqual(model.tempHp, { before: 2, value: 0, max: null, delta: null, absorbed: 2 });
    assert.deepEqual(model.segments, [{ label: "Generated weapon", damageType: "physical", raw: 8, dosBonus: 0, weaponBonus: 0,
      armor: 2, resistance: 0, toughness: 1, penetrated: 1, reduction: 3, finalDamage: 5, applied: 5 }]);
  });
  it("never fills an incomplete receipt from a previous report", () => {
    const model = projectGmDamageExplanation({ receipt: { status: "partial", result: {} }, report: report() });
    assert.equal(model.source, "receipt");
    assert.equal(model.status, "partial");
    assert.equal(model.total, null);
    assert.equal(model.hp, null);
    assert.deepEqual(model.segments, []);
  });
  it("rejects contradictory panel evidence without falling back or claiming completion", () => {
    const model = projectGmDamageExplanation({ receipt: receipt(), report: report(), panelKey: "stale-panel" });
    assert.equal(model.source, "unavailable");
    assert.equal(model.status, null);
    assert.equal(model.total, null);
    assert.equal(model.hp, null);
    assert.deepEqual(model.segments, []);
  });
  it("uses a saved health-stage result only when the receipt has no final result", () => {
    const model = projectGmDamageExplanation({ receipt: { status: "processing", stages: { health: { result: { damage: 0, newHP: 20 } } } } });
    assert.equal(model.total, 0);
    assert.equal(model.hp.value, 20);
    assert.equal(model.status, "processing");
    assert.equal(model.hp.delta, null);
  });
  it("identifies historical fallback after a receipt has been pruned", () => {
    const model = projectGmDamageExplanation({ report: report(), status: "applied" });
    assert.equal(model.source, "historical");
    assert.equal(model.total, 5);
    assert.equal(model.segments[0].reduction, 3);
    assert.equal(model.segments[0].armor, null);
    assert.equal(model.hp.before, null);
  });
  it("does not turn an unknown application status into completion", () => {
    assert.equal(projectGmDamageExplanation({ report: report() }).status, null);
    for (const status of ["partial", "processing", "pending", "waitingGM", "failed"]) {
      assert.equal(projectGmDamageExplanation({ receipt: { status } }).status, status);
    }
  });
  it("omits opaque source, reduction and trait attribution and private metadata", () => {
    const model = projectGmDamageExplanation({ report: report() });
    const serialized = JSON.stringify(model);
    assert.equal(serialized.includes("999"), false);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(Object.hasOwn(model.segments[0], "sourceNotes"), false);
  });
  it("does not fabricate HP for warfare-style reports with no HP snapshot", () => {
    const model = projectGmDamageExplanation({ report: { totalDamage: 2, hp: null, segments: [] } });
    assert.equal(model.hp, null);
    assert.equal(model.tempHp, null);
  });
  it("does not infer defeated status or HP loss from current values", () => {
    const model = projectGmDamageExplanation({ receipt: { result: { oldHP: 10, newHP: 0 } } });
    assert.equal(model.defeated, null);
    assert.equal(model.hp.delta, null);
  });
  it("preserves negative, zero and missing recorded values independently", () => {
    const saved = receipt();
    saved.result.damage = -1;
    saved.result.components[0].rawDamage = "0";
    saved.result.components[0].finalApplied = -3;
    saved.result.components[0].reductions.armor = "bad";
    const model = projectGmDamageExplanation({ receipt: saved });
    assert.equal(model.total, -1);
    assert.equal(model.segments[0].raw, 0);
    assert.equal(model.segments[0].applied, -3);
    assert.equal(model.segments[0].armor, null);
  });
  it("does not replace an explicitly empty component result with legacy rows", () => {
    const saved = receipt();
    saved.result.components = [];
    assert.deepEqual(projectGmDamageExplanation({ receipt: saved }).segments, []);
  });
  it("allows multiple independently recorded components and buffer rows", () => {
    const saved = receipt();
    saved.result.components.push({ damageType: "custom", rawDamage: 2, finalApplied: 0 });
    const model = projectGmDamageExplanation({ receipt: saved });
    assert.equal(model.segments.length, 2);
    assert.equal(model.segments[1].applied, 0);
    assert.deepEqual(model.buffers, [{ pool: "physical", remaining: 1, absorbed: 3 }]);
    assert.equal(model.total, 5);
  });
  it("preserves saved inputs and returns detached projection data", () => {
    const saved = receipt();
    const before = structuredClone(saved);
    const model = projectGmDamageExplanation({ receipt: saved });
    model.segments[0].raw = 999;
    model.buffers[0].remaining = 999;
    assert.deepEqual(saved, before);
  });
  it("changes presentation signatures for changed evidence at the same status", () => {
    const saved = receipt();
    const before = JSON.stringify(projectGmDamageExplanation({ receipt: saved }));
    saved.result.components[0].rawDamage = 9;
    assert.notEqual(JSON.stringify(projectGmDamageExplanation({ receipt: saved })), before);
  });
});


describe("Standalone saved damage evidence", () => {
  const state = () => ({
    outcomes: [{ id: "entry", targetUuid: "Actor.right", adapter: "damage.resolved", kind: "damage", status: "applied", result: { gmDamageReport: report() } }],
    outcomeId: "entry", targetUuid: "Actor.right", messageId: "msg", expectedReceiptId: "stable",
    receipt: { ...receipt(), id: "stable", outcomeId: "entry", messageId: "msg", targetUuid: "Actor.right" },
  });
  it("projects the exactly matched structured receipt", () => {
    const model = projectStandaloneDamageEvidence(state());
    assert.equal(model.source, "receipt"); assert.equal(model.total, 5); assert.equal(model.hp.value, 14);
  });
  for (const [field, value] of [["id", "old"], ["outcomeId", "other"], ["messageId", "old"], ["targetUuid", "Actor.other"]]) {
    it("rejects inconsistent receipt " + field + " without historical fill", () => {
      const input = state(); input.receipt[field] = value;
      assert.equal(projectStandaloneDamageEvidence(input).source, "unavailable");
    });
  }
  it("does not fill incomplete receipts from the same old report", () => {
    const input = state(); input.receipt.result = {};
    const model = projectStandaloneDamageEvidence(input);
    assert.equal(model.source, "receipt"); assert.equal(model.total, null); assert.equal(model.hp, null);
  });
  it("allows a uniquely matched historical report when the receipt is pruned", () => {
    const input = state(); input.receipt = null;
    assert.equal(projectStandaloneDamageEvidence(input).source, "historical");
  });
  it("rejects duplicate IDs even when one duplicate targets another Actor", () => {
    const input = state(); input.outcomes.push({ ...input.outcomes[0], targetUuid: "Actor.other" });
    assert.equal(projectStandaloneDamageEvidence(input).source, "unavailable");
  });
  it("rejects stale target, missing ID and unrelated kinds", () => {
    for (const patch of [{ targetUuid: "Actor.old" }, { outcomeId: "" }, { messageId: null }]) {
      assert.equal(projectStandaloneDamageEvidence({ ...state(), ...patch }).source, "unavailable");
    }
    const input = state(); input.outcomes[0].kind = "healing";
    assert.equal(projectStandaloneDamageEvidence(input).source, "unavailable");
  });
  it("matches an explicitly resolved synthetic Actor alias without inferring it", () => {
    const input = state(); input.receipt.targetUuid = "Scene.a.Token.b.Actor.c";
    assert.equal(projectStandaloneDamageEvidence({ ...input, receiptTargetUuid: input.receipt.targetUuid }).source, "receipt");
    assert.equal(projectStandaloneDamageEvidence(input).source, "unavailable");
  });
  it("retains partial application status and source immutability", () => {
    const input = state(); input.receipt.status = "partial"; const before = structuredClone(input);
    assert.equal(projectStandaloneDamageEvidence(input).status, "partial"); assert.deepEqual(input, before);
  });
  it("public message Roll projection never copies receipts or payloads", () => {
    const input = [{ formula: "1d6-2", total: -1, payload: { private: "secret" } }, { formula: "0", total: "0", receipt: receipt() }, { formula: false, total: Infinity }];
    const before = structuredClone(input);
    assert.deepEqual(projectRecordedMessageRolls(input), [{ formula: "1d6-2", total: -1 }, { formula: "0", total: 0 }, { formula: null, total: null }]);
    assert.deepEqual(input, before);
  });
});

