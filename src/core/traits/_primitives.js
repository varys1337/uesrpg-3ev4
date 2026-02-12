/**
 * @module traits/_primitives
 * @description Shared private helpers for the traits subsystem.
 *
 * Coercion helpers are re-exported from the canonical `src/utils/coerce.js`.
 * Trait-specific pipeline helpers remain defined here.
 *
 * **Not part of the public API** — only imported by sibling modules inside
 * `src/core/traits/`.
 *
 * Target: Foundry VTT v13.351
 */

// ── Coercion helpers (canonical source: src/utils/coerce.js) ─────────────────

import { _num } from "../../utils/coerce.js";
export { _num };
export { _lower } from "../../utils/coerce.js";

// ── Combat pipeline helpers ──────────────────────────────────────────────────

/**
 * @typedef {object} SituationalMod
 * @property {string} key    - Machine-readable modifier key.
 * @property {string} label  - Human-readable label for the modifier.
 * @property {number} value  - Numeric modifier value.
 * @property {string} source - Always `"talent"`.
 */

/**
 * Build a standardised situational modifier object for the combat pipeline.
 *
 * Consolidates identical copies from combat-talents and weapon-expertise-handlers.
 *
 * @param {string} key   - Machine-readable modifier key.
 * @param {string} label - Human-readable label (falls back to `key`).
 * @param {*}      value - Numeric value to coerce.
 * @returns {SituationalMod}
 */
export function _buildSituationalMod(key, label, value) {
  return {
    key: String(key ?? ""),
    label: String(label ?? key ?? ""),
    value: _num(value, 0),
    source: "talent"
  };
}

// ── Prompt / DoS helpers ─────────────────────────────────────────────────────

/**
 * Check whether the current user may prompt for a given actor
 * (either GM or the actor's owner).
 *
 * Consolidates identical copies from intellectual-talents and social-talents.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function _canPromptForActor(actor) {
  return Boolean(game.user?.isGM) || Boolean(actor?.isOwner);
}

/**
 * @typedef {object} DoSOverrideOpts
 * @property {string} source - Human-readable source label (e.g. talent name).
 * @property {string} mode   - Override mode descriptor.
 * @property {number} value  - Replacement DoS/DoF value (clamped ≥ 1).
 */

/**
 * Apply a Degree-of-Success override to a roll result object.
 *
 * Consolidates identical copies from intellectual-talents and social-talents.
 *
 * @param {object} result               - Mutable `doTestRoll` result.
 * @param {DoSOverrideOpts} opts        - Override parameters.
 */
export function _applyDoSOverride(result, { source, mode, value }) {
  if (!result) return;
  const v = Math.max(1, Number(value ?? 0) || 0);
  result.degree = v;
  result.textual = result.isSuccess ? `${v} DoS` : `${v} DoF`;
  result.uesrpgDosOverride = { source, mode, value: v };
}
