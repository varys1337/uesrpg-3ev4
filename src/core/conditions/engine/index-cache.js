/**
 * src/core/conditions/engine/index-cache.js
 *
 * Per-actor condition index cache.
 *
 * Builds a lookup index from actor.effects.contents once per actor lifecycle
 * and caches it on actor._conditionIndexCache. The cache is invalidated by
 * createActiveEffect / updateActiveEffect / deleteActiveEffect hooks registered
 * in registerConditionHooks() (engine/index.js).
 *
 * Index structure:
 *   { byFlag: Map<string, ActiveEffect[]>, byCore: Map<string, ActiveEffect[]> }
 *
 *   byFlag — effects recognized by system flag (flags[FLAG_SCOPE].condition.key).
 *   byCore — effects recognized by core status interop (core.statusId / statuses).
 *
 * Priority: byFlag takes precedence over byCore, matching _findConditionEffect semantics.
 * Both maps use normalized keys (see normalizeConditionKey in selectors.js).
 *
 * Circular-dep-safe: imports only from selectors.js and constants.js.
 */

import { FLAG_SCOPE } from "../constants.js";
import { normalizeConditionKey, getEffectsArray } from "./selectors.js";

/**
 * Build and return the condition index for an actor, using a cached copy if present.
 * @param {Actor} actor
 * @returns {{ byFlag: Map<string, ActiveEffect[]>, byCore: Map<string, ActiveEffect[]> }}
 */
export function getConditionIndex(actor) {
  if (!actor) return { byFlag: new Map(), byCore: new Map() };
  if (actor._conditionIndexCache) return actor._conditionIndexCache;

  const byFlag = new Map();
  const byCore = new Map();
  const effects = getEffectsArray(actor);

  for (const ef of effects) {
    if (!ef) continue;

    // Lane 1: system-flagged condition key (canonical, highest priority).
    let sysKey = null;
    try {
      const raw = ef.getFlag?.(FLAG_SCOPE, "condition")?.key;
      if (raw) sysKey = normalizeConditionKey(raw);
    } catch (_e) {}

    if (sysKey) {
      if (!byFlag.has(sysKey)) byFlag.set(sysKey, []);
      byFlag.get(sysKey).push(ef);
      continue; // Do not double-index in byCore.
    }

    // Lane 2: core status id / statuses Set or Array.
    const coreKeys = _getCoreStatusKeys(ef);
    for (const k of coreKeys) {
      if (!byCore.has(k)) byCore.set(k, []);
      byCore.get(k).push(ef);
    }
  }

  const idx = { byFlag, byCore };
  actor._conditionIndexCache = idx;
  return idx;
}

/**
 * Invalidate the cached condition index for an actor.
 * Called by AE lifecycle hooks after any effect is created, updated, or deleted.
 * @param {Actor|null} actor
 */
export function invalidateConditionIndex(actor) {
  if (!actor) return;
  actor._conditionIndexCache = null;
}

/**
 * Extract all normalized core-status keys contributed by a single effect.
 * Normalizes aliases (blind→blinded, deaf→deafened) so the index key space matches
 * the system's canonical condition keys.
 * @param {ActiveEffect} ef
 * @returns {Set<string>}
 */
function _getCoreStatusKeys(ef) {
  const keys = new Set();

  try {
    const statusId = ef.getFlag?.("core", "statusId");
    if (statusId) {
      const k = normalizeConditionKey(String(statusId));
      if (k) keys.add(k);
    }
  } catch (_e) {}

  try {
    const statuses = ef?.statuses;
    if (statuses && typeof statuses.has === "function") {
      for (const s of statuses) {
        const k = normalizeConditionKey(String(s || ""));
        if (k) keys.add(k);
      }
    } else if (Array.isArray(statuses)) {
      for (const s of statuses) {
        const k = normalizeConditionKey(String(s || ""));
        if (k) keys.add(k);
      }
    }
  } catch (_e) {}

  return keys;
}
