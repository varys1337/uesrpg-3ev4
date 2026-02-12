/**
 * @module traits/features/feature-mod
 * @description Central contract (JSDoc typedefs + factory) for feature-based modifiers.
 *
 * Every contribution from a Trait, Talent, or Power flows through a
 * FeatureMod so that stacking, aggregation, and the Feature Inspector can
 * reason about provenance deterministically.
 *
 * Design:
 *  - No schema changes — these are in-memory-only objects.
 *  - Soft validation behind the existing `activationDebug` setting.
 *  - Pure data — no mutations, no side-effects.
 */

import { normalizeTalentKey } from "../talents-api.js";

// ─── Domain constants ────────────────────────────────────────────────

/**
 * Semantic domains that a FeatureMod can target.
 * Each domain maps to a family of `path` values on `actor.system`.
 */
export const FEATURE_DOMAINS = Object.freeze({
  RESISTANCE:   "resistance",        // system.resistance.fireR, etc.
  WEAKNESS:     "weakness",          // inverse resistance (damage amplification)
  IMMUNITY:     "immunity",          // boolean immunity to damage type or condition
  SPEED:        "speed",             // system.speed.base / value
  INITIATIVE:   "initiative",        // system.initiative.base
  WOUND_THRESHOLD: "woundThreshold", // system.wound_threshold.base
  HP:           "hp",
  MP:           "mp",
  SP:           "sp",
  LP:           "lp",
  CARRY:        "carry",
  CHARACTERISTIC: "characteristic",  // system.characteristics.str.bonus, etc.
  FLAG:         "flag",              // boolean flags (undead, incorporeal, etc.)
  SKILL:        "skill",            // per-skill bonus
  MISC:         "misc",             // catch-all for edge cases
});

/**
 * Stacking rules for FeatureMods sharing the same path.
 * Mirrors Chapter 4 requirements:
 *  - Traits don't stack unless specified → "none"
 *  - X-traits use highest X → "highest"
 *  - Booleans use any → "any"
 *  - Explicitly stackable → "add"
 */
export const STACKING_MODES = Object.freeze({
  NONE:     "none",     // keep first / single instance
  HIGHEST:  "highest",  // keep max numeric value
  ANY:      "any",      // boolean OR
  ADD:      "add",      // sum numeric values
  OVERRIDE: "override", // last-wins (use sparingly)
});


// ─── JSDoc typedefs ──────────────────────────────────────────────────

/**
 * @typedef {Object} FeatureSource
 * @property {"trait"|"talent"|"power"|"ae"|"racial"} type   Source category.
 * @property {string}  key       Normalized feature key (e.g. "resistance.fire").
 * @property {string}  [itemName]  Display name of the source item.
 * @property {string}  [itemUuid]  UUID of the embedded item.
 * @property {string}  [itemId]    Short ID of the embedded item.
 */

/**
 * @typedef {Object} FeatureRuleMeta
 * @property {number}  [chapter]   Chapter reference (usually 4).
 * @property {string}  [name]      Human-readable rule citation.
 * @property {"none"|"add"|"highest"|"any"|"override"} [stacking]
 */

/**
 * @typedef {Object} FeatureMod
 * @property {string}  domain     One of FEATURE_DOMAINS values.
 * @property {string}  path       Dot-path on actor.system being modified.
 * @property {string}  mode       How the value is applied: "add", "set", "multiply", "boolean".
 * @property {number|boolean} value  The modification value.
 * @property {FeatureSource}  source  Provenance of this mod.
 * @property {FeatureRuleMeta} rule   Stacking / chapter metadata.
 */


// ─── Factory ─────────────────────────────────────────────────────────

let _debugEnabled = false;
let _debugChecked = false;

function _isDebug() {
  if (!_debugChecked) {
    try {
      _debugEnabled = game?.settings?.get?.("uesrpg-3ev4", "activationDebug") === true;
    } catch (_e) {
      _debugEnabled = false;
    }
    _debugChecked = true;
    // Re-check every 30s to pick up runtime setting changes.
    setTimeout(() => { _debugChecked = false; }, 30_000);
  }
  return _debugEnabled;
}

const REQUIRED_FIELDS = ["domain", "path", "mode", "value", "source"];

/**
 * Create a validated FeatureMod.
 *
 * @param {Partial<FeatureMod>} partial
 * @returns {FeatureMod}
 */
export function makeFeatureMod(partial) {
  const mod = {
    domain:  partial.domain  ?? FEATURE_DOMAINS.MISC,
    path:    partial.path    ?? "",
    mode:    partial.mode    ?? "add",
    value:   partial.value   ?? 0,
    source:  Object.freeze({
      type:     partial.source?.type     ?? "trait",
      key:      partial.source?.key      ?? "",
      itemName: partial.source?.itemName ?? "",
      itemUuid: partial.source?.itemUuid ?? "",
      itemId:   partial.source?.itemId   ?? "",
    }),
    rule:    Object.freeze({
      chapter:  partial.rule?.chapter  ?? 4,
      name:     partial.rule?.name     ?? "",
      stacking: partial.rule?.stacking ?? STACKING_MODES.NONE,
    }),
  };

  // Soft validation in debug mode only.
  if (_isDebug()) {
    for (const field of REQUIRED_FIELDS) {
      if (mod[field] === undefined || mod[field] === null || mod[field] === "") {
        if (field === "value") continue; // 0 is valid
        console.warn(`uesrpg | FeatureMod missing required field "${field}"`, mod);
      }
    }
    if (!Object.values(FEATURE_DOMAINS).includes(mod.domain)) {
      console.warn(`uesrpg | FeatureMod unknown domain "${mod.domain}"`, mod);
    }
  }

  return Object.freeze(mod);
}


// ─── Key normalization ───────────────────────────────────────────────

/**
 * Deterministic slug normalizer for feature keys.
 * Reuses the same algorithm as talents-api.js normalizeTalentKey for consistency.
 *
 * @param {string} str
 * @returns {string}
 */
export function normalizeFeatureKey(str) {
  return normalizeTalentKey(str);
}
