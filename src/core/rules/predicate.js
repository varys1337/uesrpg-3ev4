/**
 * src/core/rules/predicate.js
 *
 * Shared predicate evaluator for rule-element gating.
 * Supported shapes:
 * - null/undefined/[]  -> true
 * - "a:b"              -> option presence
 * - ["a:b", "c:d"]     -> AND
 * - [{or:[...]}]       -> logical object forms inside arrays
 * - {and:[...]}, {or:[...]}, {not:...}, {nor:[...]}, {nand:[...]}
 */

import { isDebugEnabled } from "../../utils/debug.js";
import { normalizeRollOption } from "./roll-options.js";

const MAX_DEPTH = 32;

function _isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function _debugPredicate(message, data = null) {
  if (!isDebugEnabled("ruleElementDebug")) return;
  if (data == null) {
    console.debug(`UESRPG | predicate | ${message}`);
    return;
  }
  console.debug(`UESRPG | predicate | ${message}`, data);
}

/**
 * Quick structural validation for predicate-like values.
 *
 * @param {*} predicate
 * @returns {boolean}
 */
export function isPredicate(predicate) {
  if (predicate == null) return true;
  if (typeof predicate === "string") return true;
  if (Array.isArray(predicate)) return predicate.every((node) => isPredicate(node));
  if (!_isObject(predicate)) return false;

  const keys = Object.keys(predicate);
  if (!keys.length) return false;
  if (keys.length !== 1) return false;

  const key = keys[0];
  const value = predicate[key];

  if (key === "not") return isPredicate(value);
  if (key === "and" || key === "or" || key === "nor" || key === "nand") {
    if (!Array.isArray(value)) return false;
    return value.every((node) => isPredicate(node));
  }

  return false;
}

function _coerceRollOptionSet(rollOptions) {
  if (rollOptions instanceof Set) {
    const normalized = new Set();
    for (const entry of rollOptions) {
      const n = normalizeRollOption(entry);
      if (n) normalized.add(n);
    }
    return normalized;
  }

  const normalized = new Set();
  const arr = Array.isArray(rollOptions) ? rollOptions : [];
  for (const entry of arr) {
    const n = normalizeRollOption(entry);
    if (n) normalized.add(n);
  }
  return normalized;
}

function _evaluateNode(node, optionsSet, { depth = 0 } = {}) {
  if (depth > MAX_DEPTH) return { ok: false, invalid: true, reason: "max-depth-exceeded" };

  if (node == null) return { ok: true, invalid: false };

  if (typeof node === "string") {
    const option = normalizeRollOption(node);
    if (!option) return { ok: false, invalid: true, reason: "invalid-option-string" };
    return { ok: optionsSet.has(option), invalid: false };
  }

  if (Array.isArray(node)) {
    // Top-level arrays and nested arrays are AND groups by design.
    for (const child of node) {
      const result = _evaluateNode(child, optionsSet, { depth: depth + 1 });
      if (result.invalid) return result;
      if (!result.ok) return { ok: false, invalid: false };
    }
    return { ok: true, invalid: false };
  }

  if (!_isObject(node)) return { ok: false, invalid: true, reason: "unsupported-node-type" };

  const keys = Object.keys(node);
  if (keys.length !== 1) return { ok: false, invalid: true, reason: "logic-node-must-have-single-key" };

  const op = keys[0];
  const value = node[op];

  if (op === "not") {
    const inner = _evaluateNode(value, optionsSet, { depth: depth + 1 });
    if (inner.invalid) return inner;
    return { ok: !inner.ok, invalid: false };
  }

  if (op === "and") {
    if (!Array.isArray(value)) return { ok: false, invalid: true, reason: "and-requires-array" };
    for (const child of value) {
      const result = _evaluateNode(child, optionsSet, { depth: depth + 1 });
      if (result.invalid) return result;
      if (!result.ok) return { ok: false, invalid: false };
    }
    return { ok: true, invalid: false };
  }

  if (op === "or") {
    if (!Array.isArray(value)) return { ok: false, invalid: true, reason: "or-requires-array" };
    for (const child of value) {
      const result = _evaluateNode(child, optionsSet, { depth: depth + 1 });
      if (result.invalid) return result;
      if (result.ok) return { ok: true, invalid: false };
    }
    return { ok: false, invalid: false };
  }

  if (op === "nor") {
    if (!Array.isArray(value)) return { ok: false, invalid: true, reason: "nor-requires-array" };
    for (const child of value) {
      const result = _evaluateNode(child, optionsSet, { depth: depth + 1 });
      if (result.invalid) return result;
      if (result.ok) return { ok: false, invalid: false };
    }
    return { ok: true, invalid: false };
  }

  if (op === "nand") {
    if (!Array.isArray(value)) return { ok: false, invalid: true, reason: "nand-requires-array" };
    for (const child of value) {
      const result = _evaluateNode(child, optionsSet, { depth: depth + 1 });
      if (result.invalid) return result;
      if (!result.ok) return { ok: true, invalid: false };
    }
    return { ok: false, invalid: false };
  }

  return { ok: false, invalid: true, reason: `unsupported-operator:${op}` };
}

/**
 * Evaluate a predicate against a roll-option set.
 *
 * @param {*} predicate
 * @param {Set<string>|string[]} rollOptions
 * @param {object} [options]
 * @returns {boolean}
 */
export function evaluatePredicate(predicate, rollOptions, options = {}) {
  const optionsSet = _coerceRollOptionSet(rollOptions);

  // Empty predicate means "always true".
  if (predicate == null) return true;
  if (Array.isArray(predicate) && predicate.length === 0) return true;

  const result = _evaluateNode(predicate, optionsSet, { depth: 0 });
  if (result.invalid) {
    _debugPredicate("Invalid predicate evaluated as false", {
      reason: result.reason,
      predicate
    });
    return false;
  }
  return Boolean(result.ok);
}

/**
 * Deterministic console self-test utility.
 * Exposed via game.uesrpg.rules.predicate.selfTest()
 *
 * @returns {{total:number, passed:number, failed:number, results:Array}}
 */
export function selfTestPredicate() {
  const tests = [
    { name: "null true", predicate: null, options: [], expected: true },
    { name: "string true", predicate: "test:type:skill", options: ["test:type:skill"], expected: true },
    { name: "string false", predicate: "test:type:skill", options: ["test:type:attack"], expected: false },
    { name: "array and true", predicate: ["a", "b"], options: ["a", "b", "c"], expected: true },
    { name: "array and false", predicate: ["a", "b"], options: ["a"], expected: false },
    { name: "or true", predicate: { or: ["a", "b"] }, options: ["b"], expected: true },
    { name: "or false", predicate: { or: ["a", "b"] }, options: ["c"], expected: false },
    { name: "not true", predicate: { not: "a" }, options: ["b"], expected: true },
    { name: "not false", predicate: { not: "a" }, options: ["a"], expected: false },
    { name: "nested", predicate: [{ and: ["a", { or: ["b", "c"] }] }], options: ["a", "c"], expected: true },
    { name: "nor", predicate: { nor: ["a", "b"] }, options: ["c"], expected: true },
    { name: "nand", predicate: { nand: ["a", "b"] }, options: ["a"], expected: true },
    { name: "invalid false", predicate: { maybe: ["a"] }, options: ["a"], expected: false }
  ];

  const results = tests.map((t) => {
    const actual = evaluatePredicate(t.predicate, t.options);
    return {
      name: t.name,
      expected: t.expected,
      actual,
      pass: actual === t.expected
    };
  });

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  return {
    total: results.length,
    passed,
    failed,
    results
  };
}

