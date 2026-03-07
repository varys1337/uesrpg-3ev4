/**
 * src/core/wounds/engine/calc.js
 *
 * Pure computation helpers for wound engine.
 * No document mutations, no game/ui dependencies.
 */

import { SHOCK_MAGIC_TYPES, normalizeDamageTypeKey } from "../wound-schema.js";
import { FLAG_SCOPE } from "../../constants.js";

/**
 * Convert value to number with fallback
 */
export function toNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Get actor effects array
 */
export function getEffects(actor) {
  return actor?.effects?.contents ?? [];
}

/**
 * Extract wounds flag from effect
 */
export function getWoundsFlag(effect) {
  return effect?.getFlag?.(FLAG_SCOPE, "wounds") ?? effect?.flags?.[FLAG_SCOPE]?.wounds ?? null;
}

/**
 * Find effects by kind
 */
export function findEffectsByKind(actor, kind) {
  return getEffects(actor).filter(e => (e?.getFlag?.(FLAG_SCOPE, "wounds")?.kind === kind));
}

/**
 * Find first effect by kind
 */
export function findFirstEffectByKind(actor, kind) {
  return findEffectsByKind(actor, kind)[0] ?? null;
}

/**
 * Find first effect by application ID
 */
export function findFirstEffectByAppId(actor, applicationId) {
  const appId = String(applicationId ?? "").trim();
  if (!appId) return null;
  for (const ef of getEffects(actor)) {
    const wounds = ef?.getFlag?.(FLAG_SCOPE, "wounds") ?? null;
    if (!wounds || typeof wounds !== "object") continue;
    if (String(wounds.applicationId ?? "") === appId) return ef;
  }
  return null;
}

/**
 * Check if actor has any wound effects
 */
export function hasAnyWoundEffects(actor) {
  return findEffectsByKind(actor, "wound").length > 0;
}

/**
 * Compute dominant magic damage type for shock side effects
 */
export function computeDominantMagicType(damageAppliedByType = {}) {
  const entries = Object.entries(damageAppliedByType ?? {})
    .map(([k, v]) => [ normalizeDamageTypeKey(k), Number(v) || 0 ])
    .filter(([k, v]) => SHOCK_MAGIC_TYPES.includes(k) && v > 0);

  if (!entries.length) return { chosen: null, candidates: [] };

  let max = 0;
  for (const [, v] of entries) max = Math.max(max, v);
  const candidates = Array.from(new Set(entries.filter(([, v]) => v === max).map(([k]) => k)));
  return { chosen: candidates.length === 1 ? candidates[0] : null, candidates };
}

/**
 * Check if actor can naturally heal (no untreated wounds)
 */
export function canNaturalHeal(actor) {
  if (!actor) return false;
  const wounds = findEffectsByKind(actor, "wound");
  if (!wounds.length) return true;
  const untreated = wounds.some(ef => (ef.getFlag(FLAG_SCOPE, "wounds")?.treated !== true));
  return !untreated;
}
