import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluatePredicate, isPredicate, selfTestPredicate } from "../../src/core/rules/predicate.js";

describe("Existing predicate contracts", () => {
  it("retains the canonical console self-test cases", () => {
    const result = selfTestPredicate();
    assert.equal(result.total, 13);
    assert.equal(result.failed, 0);
    assert.equal(result.passed, 13);
    for (const row of result.results) assert.equal(row.pass, true, row.name);
  });

  it("accepts empty predicates and normalizes string options", () => {
    for (const empty of [null, undefined, []]) assert.equal(evaluatePredicate(empty, []), true);
    assert.equal(evaluatePredicate(" Test:Skill ", ["TEST:SKILL"]), true);
    assert.equal(evaluatePredicate("test:skill", new Set([" TEST:SKILL "])), true);
    assert.equal(evaluatePredicate("missing", ["other"]), false);
  });

  const cases = [
    { name: "array AND", predicate: ["a", "b"], options: ["a", "b"], expected: true },
    { name: "AND missing member", predicate: { and: ["a", "b"] }, options: ["a"], expected: false },
    { name: "OR hit", predicate: { or: ["a", "b"] }, options: ["b"], expected: true },
    { name: "OR miss", predicate: { or: ["a", "b"] }, options: [], expected: false },
    { name: "NOT hit", predicate: { not: "a" }, options: ["a"], expected: false },
    { name: "NOT miss", predicate: { not: "a" }, options: [], expected: true },
    { name: "NOR hit", predicate: { nor: ["a", "b"] }, options: ["a"], expected: false },
    { name: "NOR miss", predicate: { nor: ["a", "b"] }, options: [], expected: true },
    { name: "NAND complete", predicate: { nand: ["a", "b"] }, options: ["a", "b"], expected: false },
    { name: "NAND incomplete", predicate: { nand: ["a", "b"] }, options: ["a"], expected: true },
    { name: "nested groups", predicate: ["a", { or: ["b", { not: "c" }] }], options: ["a"], expected: true },
  ];
  for (const row of cases) {
    it(`evaluates ${row.name} without mutating its inputs`, () => {
      const { predicate, options } = structuredClone(row);
      const before = structuredClone({ predicate, options });
      assert.equal(evaluatePredicate(predicate, options), row.expected);
      assert.deepEqual({ predicate, options }, before);
    });
  }

  it("distinguishes structural validation from empty option evaluation", () => {
    for (const value of [null, "", "a", [], ["a", { not: "b" }]]) assert.equal(isPredicate(value), true);
    assert.equal(evaluatePredicate("", ["a"]), false);
    for (const value of [0, false, {}, { and: "a" }, { unknown: [] }, { and: [], or: [] }, ["a", 42]]) {
      assert.equal(isPredicate(value), false);
      assert.equal(evaluatePredicate(value, ["a"]), false);
    }
  });

  it("rejects evaluated predicates exceeding the existing nesting limit", () => {
    let predicate = "a";
    for (let depth = 0; depth < 40; depth++) predicate = { not: predicate };
    assert.equal(evaluatePredicate(predicate, ["a"]), false);
  });

  it("treats unsupported option containers as an empty set", () => {
    assert.equal(evaluatePredicate("a", { a: true }), false);
    assert.equal(evaluatePredicate("a", undefined), false);
  });
});
