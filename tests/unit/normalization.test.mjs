import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { applyDefaults } from "../../src/core/migrations/apply-defaults.js";
import { normalizeHitLocation } from "../../src/core/combat/damage/resolver/normalize.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/legacy-data.json", import.meta.url), "utf8"));

describe("Legacy input normalization using native Node cloning", () => {
  it("normalizes recognized nested legacy values and retains extra data", () => {
    const { source, defaults } = structuredClone(fixture);
    const before = structuredClone({ source, defaults });
    const result = applyDefaults(source, defaults, { strict: true });
    assert.equal(result.changed, true);
    assert.deepEqual(result.result, fixture.normalized);
    assert.deepEqual({ source, defaults }, before);
    assert.notEqual(result.result, source);
  });

  it("is idempotent after normalization", () => {
    const first = applyDefaults(structuredClone(fixture.source), fixture.defaults, { strict: true });
    const second = applyDefaults(first.result, fixture.defaults, { strict: true });
    assert.equal(second.changed, false);
    assert.deepEqual(second.result, fixture.normalized);
  });

  for (const [name, patch, expected] of [
    ["numeric field", { value: "invalid" }, /numeric field: system\.profile\.value/],
    ["Boolean field", { enabled: "invalid" }, /Boolean field: system\.profile\.enabled/],
    ["array field", { entries: { name: "not an array" } }, /array field: system\.profile\.entries/],
    ["sparse indexed array", { entries: { 1: "missing zero" } }, /array field: system\.profile\.entries/],
  ]) {
    it(`rejects an unrecognized legacy ${name} in strict mode`, () => {
      const source = structuredClone(fixture.normalized);
      Object.assign(source.profile, patch);
      const before = structuredClone(source);
      assert.throws(() => applyDefaults(source, fixture.defaults, { strict: true }), expected);
      assert.deepEqual(source, before);
    });
  }

  it("rejects an array where a nested object is required", () => {
    assert.throws(() => applyDefaults({ profile: [] }, fixture.defaults, { strict: true }), /object field: system\.profile/);
  });

  it("can refuse scalar coercion without changing the original input", () => {
    const source = structuredClone(fixture.normalized);
    source.profile.value = "3";
    assert.throws(() => applyDefaults(source, fixture.defaults, { strict: true, coerce: false }), /numeric field/);
    assert.equal(source.profile.value, "3");
  });

  it("preserves ignored fields even when they have a legacy shape", () => {
    const source = structuredClone(fixture.normalized);
    source.profile.value = "leave this field";
    const result = applyDefaults(source, fixture.defaults, { strict: true, ignorePaths: ["profile.value"] });
    assert.equal(result.result.profile.value, "leave this field");
    assert.equal(result.changed, false);
  });

  it("fills missing nested defaults and retains meaningful null-default values", () => {
    const result = applyDefaults(null, fixture.defaults, { strict: true });
    assert.deepEqual(result.result, fixture.defaults);
    assert.equal(result.changed, true);
    for (const value of ["Retained", 0, false, null]) {
      const source = structuredClone(fixture.normalized);
      source.profile.optional = value;
      assert.equal(applyDefaults(source, fixture.defaults, { strict: true }).result.profile.optional, value);
    }
  });

  it("mutates only a caller-owned copy when clone is explicitly disabled", () => {
    const source = structuredClone(fixture.source);
    const result = applyDefaults(source, fixture.defaults, { strict: true, clone: false });
    assert.equal(result.result, source);
    assert.deepEqual(source, fixture.normalized);
    assert.equal(fixture.source.profile.value, "3");
  });

  it("normalizes damage location aliases without changing unknown locations", () => {
    for (const [input, expected] of [[null, "Body"], [" ", "Body"], ["torso", "Body"], ["LEFT ARM", "LeftArm"], ["right leg", "RightLeg"], ["Head", "Head"], ["Custom Location", "Custom Location"]]) {
      assert.equal(normalizeHitLocation(input), expected);
    }
  });
});
