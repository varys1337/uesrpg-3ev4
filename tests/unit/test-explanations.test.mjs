import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectOpposedResolutionExplanation, projectOpposedTestExplanation } from "../../src/core/combat/opposed/explanation.js";
import { renderOpposedTestDetails } from "../../src/ui/combat/test-explanation.js";
const participant = () => ({
  result: { rollTotal: 0, target: "40", isSuccess: false, degree: -1, secret: "PRIVATE" },
  tn: { baseTN: 45, totalMod: -5, finalTN: 40, breakdown: [{ label: "Saved effect", value: "-5", effectUuid: "PRIVATE" }] },
  flags: "PRIVATE",
});
describe("Saved opposed-test explanations", () => {
  it("imports production projections and formatter without runtime globals", () => {
    assert.equal(globalThis.game, undefined); assert.equal(globalThis.foundry, undefined);
  });
  it("public projection excludes TN sources and raw extras", () => {
    assert.deepEqual(projectOpposedTestExplanation(participant()), { roll: 0, target: 40, degree: -1, success: false });
  });
  it("requires literal explicit component inclusion", () => {
    assert.equal(projectOpposedTestExplanation(participant(), { includeComponents: "true" }).components, undefined);
  });
  it("copies GM values without repairing inconsistent totals", () => {
    const source = participant(); source.tn.finalTN = 999;
    const model = projectOpposedTestExplanation(source, { includeComponents: true });
    assert.equal(model.finalTN, 999); assert.equal(model.target, 40);
    assert.deepEqual(model.components, [{ label: "Saved effect", value: -5 }]);
    assert.equal(JSON.stringify(model).includes("PRIVATE"), false);
  });
  it("retains zero, negative and numeric text without clamping", () => {
    const source = participant(); source.tn.breakdown = [{ label: "Zero", value: "0" }, { label: "Negative", value: -3 }];
    assert.deepEqual(projectOpposedTestExplanation(source, { includeComponents: true }).components, [{ label: "Zero", value: 0 }, { label: "Negative", value: -3 }]);
  });
  it("does not substitute a saved final TN for an absent test target", () => {
    const source = participant(); delete source.result.target;
    const model = projectOpposedTestExplanation(source, { includeComponents: true });
    assert.equal(model.target, null); assert.equal(model.finalTN, 40);
  });
  for (const value of [null, undefined, [], 7, "bad"]) it("handles missing or malformed participant " + String(value), () => {
    assert.deepEqual(projectOpposedTestExplanation(value), { roll: null, target: null, degree: null, success: null });
  });
  it("filters invalid rows and leaves malformed leaves unavailable", () => {
    const source = { result: { rollTotal: Infinity, isSuccess: "true" }, tn: { modifiers: [null, [], 4, { label: {}, value: "1d6" }] } };
    const model = projectOpposedTestExplanation(source, { includeComponents: true });
    assert.equal(model.roll, null); assert.equal(model.success, null);
    assert.deepEqual(model.components, [{ label: null, value: null }]);
  });
  it("preserves input", () => {
    const source = participant(), before = structuredClone(source);
    projectOpposedTestExplanation(source, { includeComponents: true }); assert.deepEqual(source, before);
  });
  it("public choice projection copies only existing choice fields", () => {
    const model = projectOpposedResolutionExplanation({ attacker: { variantLabel: "Attack", manualMod: -2, tn: participant().tn }, defender: { defenseType: "evade", result: { duelingBonus: 0 } }, advantage: { attacker: "0", defender: null } });
    assert.equal(model.variation, "Attack"); assert.equal(model.manual, -2); assert.equal(model.attackerAdvantage, 0);
    assert.equal(model.defenderAdvantage, null); assert.equal(model.duelingBonus, 0); assert.equal(model.components, undefined);
  });
  it("does not manufacture missing manual or advantage values", () => {
    const model = projectOpposedResolutionExplanation();
    assert.equal(model.manual, null); assert.equal(model.attackerAdvantage, null);
  });
  it("routes labels through the escaping boundary and retains unavailable/zero values", () => {
    const model = projectOpposedTestExplanation({ ...participant(), tn: { breakdown: [{ label: "<script>private</script>", value: 0 }] } }, { includeComponents: true });
    const html = renderOpposedTestDetails(model, { localize: (_key, fallback) => fallback, escape: value => encodeURIComponent(String(value)) });
    assert.equal(html.includes("<script>"), false); assert.ok(html.includes("%3Cscript%3E"));
    assert.ok(html.includes("Not%20recorded")); assert.ok(html.includes(">0<"));
  });
});

