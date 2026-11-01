import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectPreparedDerivedExplanation } from "../../src/core/actors/prepare/derived-explanation.js";
const stat = (model, key) => model.find(row => row.key === key);
const field = (model, key) => model.fields.find(row => row.key === key);
describe("Read-only prepared values", () => {
  it("imports without Foundry globals", () => {
    assert.equal(globalThis.game, undefined); assert.equal(globalThis.foundry, undefined);
  });
  it("copies prepared values without inferring any equation", () => {
    const model = stat(projectPreparedDerivedExplanation({ hp: { base: 5, bonus: 2, max: 99, value: -1 } }), "hp");
    assert.equal(field(model, "base").value, 5); assert.equal(field(model, "bonus").value, 2);
    assert.equal(field(model, "max").value, 99); assert.equal(field(model, "value").value, -1);
  });
  it("preserves explicit zero and numeric strings", () => {
    const model = stat(projectPreparedDerivedExplanation({ initiative: { base: "0", bonus: "-2.5", value: "3" } }), "initiative");
    assert.deepEqual(field(model, "base"), { key: "base", labelKey: "UESRPG.Sheets.PreparedValues.Fields.base", value: 0, available: true });
    assert.equal(field(model, "bonus").value, -2.5); assert.equal(field(model, "value").value, 3);
  });
  for (const input of [null, [], 4, "invalid"]) it("handles malformed root " + JSON.stringify(input), () => {
    const model = projectPreparedDerivedExplanation(input);
    assert.equal(model.length, 7); assert.equal(field(model[0], "base").available, false);
  });
  it("does not turn malformed leaves into zero", () => {
    const model = stat(projectPreparedDerivedExplanation({ speed: { base: false, bonus: " ", max: Infinity, value: {} } }), "speed");
    assert.ok(model.fields.every(row => row.available === false && row.value === null));
  });
  it("never projects extra resources, source payloads or flags", () => {
    const input = { hp: { value: 1, private: "PRIVATE" }, private: "PRIVATE", flags: { secret: "PRIVATE" } };
    assert.equal(JSON.stringify(projectPreparedDerivedExplanation(input)).includes("PRIVATE"), false);
  });
  it("omits contribution entries unless explicitly requested", () => {
    const input = { ui: { featureModsByPath: { "system.speed.base": [{ value: 3, source: { itemName: "PRIVATE" } }] } } };
    assert.deepEqual(stat(projectPreparedDerivedExplanation(input), "speed").contributions, []);
    assert.deepEqual(stat(projectPreparedDerivedExplanation(input, { includeContributions: "true" }), "speed").contributions, []);
  });
  it("copies only selected prepared entries, not identifiers or raw rules", () => {
    const input = { ui: { featureModsByPath: {
      "system.speed.base": [{ value: "0", mode: "add", source: { itemName: "Saved source", itemUuid: "PRIVATE" }, rule: { name: "Rule", secret: "PRIVATE" }, secret: "PRIVATE" }],
      "system.secret.value": [{ value: 1, source: { itemName: "PRIVATE" } }],
    } } };
    const contributions = stat(projectPreparedDerivedExplanation(input, { includeContributions: true }), "speed").contributions;
    assert.equal(contributions.length, 1); assert.equal(contributions[0].label, "Saved source"); assert.equal(contributions[0].value, 0);
    assert.equal(contributions[0].modeLabelKey, "UESRPG.Sheets.PreparedValues.Modes.add");
    assert.equal(JSON.stringify(contributions).includes("PRIVATE"), false);
  });
  it("supports the canonical prepared Map without cloning or recalculating it", () => {
    const entries = new Map([["initiative.base", [{ value: -2, mode: "multiply", source: { itemName: "Existing" } }]]]);
    const input = { ui: { featureModsByPath: entries } }, before = structuredClone(input);
    const result = stat(projectPreparedDerivedExplanation(input, { includeContributions: true }), "initiative");
    assert.equal(result.contributions[0].value, -2); assert.deepEqual(input, before);
  });
  it("filters malformed entries and unrecognized modes", () => {
    const input = { ui: { featureModsByPath: { "hp.max": [null, [], 4, { value: "bad", mode: "PRIVATE", rule: { name: "Saved" } }] } } };
    const result = stat(projectPreparedDerivedExplanation(input, { includeContributions: true }), "hp");
    assert.equal(result.contributions.length, 1); assert.equal(result.contributions[0].available, false); assert.equal(result.contributions[0].modeLabelKey, null);
  });
});

