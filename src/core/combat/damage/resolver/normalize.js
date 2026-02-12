/**
 * src/core/combat/damage/resolver/normalize.js
 * UESRPG 3e v4 — Damage Resolver Normalization Utilities
 *
 * Handles normalization of hit locations, damage types, and numeric values.
 */

import { DAMAGE_TYPES } from "../types.js";

/**
 * Normalize hit location values to engine keys used by damage-automation.js.
 * @param {string} hitLocation
 * @returns {string}
 */
export function normalizeHitLocation(hitLocation) {
  const v = String(hitLocation ?? "").trim();
  if (!v) return "Body";

  // Common aliases seen in cards / legacy sheets.
  const map = {
    head: "Head",
    body: "Body",
    torso: "Body",
    leftarm: "LeftArm",
    "left arm": "LeftArm",
    rightarm: "RightArm",
    "right arm": "RightArm",
    leftleg: "LeftLeg",
    "left leg": "LeftLeg",
    rightleg: "RightLeg",
    "right leg": "RightLeg",
  };

  const key = v.replace(/\s+/g, "").toLowerCase();
  return map[key] ?? v;
}

/**
 * Coerce user-facing damage type strings to known damage types.
 * @param {string} damageType
 * @returns {string}
 */
export function normalizeDamageType(damageType) {
  const v = String(damageType ?? "").trim().toLowerCase();
  if (!v) return DAMAGE_TYPES.PHYSICAL;

  // Prefer constants, but accept raw strings.
  const known = new Set(Object.values(DAMAGE_TYPES).map(x => String(x).toLowerCase()));
  if (known.has(v)) return v;

  // Allow some common aliases.
  const alias = {
    phys: DAMAGE_TYPES.PHYSICAL,
    physical: DAMAGE_TYPES.PHYSICAL,
  };
  return String(alias[v] ?? v).toLowerCase();
}

/**
 * Coerce value to number with defensive fallback parsing.
 * @param {any} v
 * @returns {number}
 */
export function asNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

/**
 * Coerce value to integer with defensive fallback parsing.
 * @param {any} v
 * @returns {number}
 */
export function asInt(v) {
  const n = Number(v);
  if (Number.isFinite(n)) return Math.floor(n);
  const m = String(v ?? "").match(/-?\d+/);
  return m ? Number(m[0]) : 0;
}
