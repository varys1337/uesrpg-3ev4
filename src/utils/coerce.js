/**
 * @module utils/coerce
 * @description Canonical low-level coercion helpers.
 *
 * Consolidates `_num`, `_numOrNull`, `_bool`, `_str`, `_strTrim`, `_lower`
 * which were previously duplicated across 8+ subsystem files.
 *
 * Target: Foundry VTT v13.351
 */

// ── Number coercion ──────────────────────────────────────────────────────────

/**
 * Safely coerce a value to a finite number.
 * @param {*} v - Value to coerce
 * @param {number|null} [d=0] - Fallback when coercion produces NaN / ±Infinity
 * @returns {number|null}
 */
export function _num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * Like {@link _num}, but returns `null` (or custom fallback) when coercion fails.
 * Treats explicit `null` / `undefined` input as the fallback without attempting
 * `Number()` coercion (avoids `Number(null) === 0` surprise).
 * @param {*} v
 * @param {null|number} [d=null]
 * @returns {number|null}
 */
export function _numOrNull(v, d = null) {
  if (v === null || v === undefined) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// ── Boolean coercion ─────────────────────────────────────────────────────────

/**
 * Safely coerce a value to a boolean with comprehensive keyword support.
 *
 * Truthy: `true`, `"true"`, `"1"`, `"yes"`, `"y"`, `"on"`
 * Falsy:  `false`, `"false"`, `"0"`, `"no"`, `"n"`, `"off"`, `""`
 * Unknown: returns `false` (deterministic — no `Boolean(v)` fallback).
 *
 * @param {*} v - Value to coerce
 * @returns {boolean}
 */
export function _bool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "y" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n" || s === "off" || s === "") return false;
  return false;
}

// ── String coercion ──────────────────────────────────────────────────────────

/**
 * Safely coerce a value to a string.  Returns `""` for `null` / `undefined`.
 * Does **not** trim whitespace.
 * @param {*} v
 * @returns {string}
 */
export function _str(v) {
  return v === undefined || v === null ? "" : String(v);
}

/**
 * Safely coerce a value to a **trimmed** string.  Returns `""` for
 * `null` / `undefined`.
 * @param {*} v
 * @returns {string}
 */
export function _strTrim(v) {
  return String(v ?? "").trim();
}

/**
 * Lowercase + trim a value, coercing nullish to empty string.
 * @param {*} v
 * @returns {string}
 */
export function _lower(v) {
  return String(v ?? "").toLowerCase().trim();
}
