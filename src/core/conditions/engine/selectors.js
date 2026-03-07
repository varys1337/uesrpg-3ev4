/**
 * src/core/conditions/engine/selectors.js
 *
 * Stage-06 boundary: pure condition lookup helpers.
 *
 * These functions are read-only (no document mutation) and have no upstream
 * dependencies within the conditions subsystem, so they can be safely imported
 * by engine/index-cache.js without creating circular dependencies.
 *
 * engine/index.js re-imports these under underscore aliases to keep its
 * internal call sites unchanged.
 */

import { FLAG_SCOPE } from "../constants.js";

/**
 * Normalize a condition key to lowercase canonical form.
 * Maps core aliases (blind→blinded, deaf→deafened) and strips numeric suffixes.
 * @param {string} key
 * @returns {string}
 */
export function normalizeConditionKey(key) {
  let k = String(key || "").trim().toLowerCase();
  if (!k) return "";

  // Normalize common core ↔ system naming differences.
  if (k === "blind") k = "blinded";
  if (k === "deaf") k = "deafened";

  // Strip any accidental numeric suffixes from ids/names (e.g., 'bleeding (1)').
  k = k.replace(/\s*\(\s*\d+\s*\)\s*$/, "").trim();
  return k;
}

/**
 * Get all active effects from an actor as a plain array.
 * @param {Actor} actor
 * @returns {ActiveEffect[]}
 */
export function getEffectsArray(actor) {
  return actor?.effects?.contents ?? [];
}

/**
 * Check if an effect matches a given core status key via statusId flag or statuses Set/Array.
 * @param {ActiveEffect} effect
 * @param {string} key - Already-normalized lowercase key.
 * @returns {boolean}
 */
export function effectHasCoreStatus(effect, key) {
  const k = String(key || "").trim().toLowerCase();
  if (!effect || !k) return false;

  try {
    const statusId = effect.getFlag?.("core", "statusId");
    if (String(statusId || "").toLowerCase() === k) return true;
  } catch (_e) {}

  try {
    const statuses = effect?.statuses;
    if (statuses && typeof statuses.has === "function") return statuses.has(k);
    if (Array.isArray(statuses)) return statuses.map(s => String(s).toLowerCase()).includes(k);
  } catch (_e) {}

  return false;
}

/**
 * Return canonical + core aliases for a condition key.
 * Used to match effects that may use Foundry core aliases (e.g., "blind" for "blinded").
 * @param {string} key
 * @returns {string[]}
 */
export function coreStatusAliasesForKey(key) {
  const k = normalizeConditionKey(key);
  if (!k) return [];
  // Foundry core uses 'blind'/'deaf' while the system uses 'blinded'/'deafened'.
  if (k === "blinded") return ["blinded", "blind"];
  if (k === "deafened") return ["deafened", "deaf"];
  return [k];
}

/**
 * Find the first effect on an actor matching a condition key via core status lanes (aliases included).
 * @param {Actor} actor
 * @param {string} key
 * @returns {ActiveEffect|null}
 */
export function findCoreStatusEffect(actor, key) {
  const aliases = coreStatusAliasesForKey(key);
  if (!aliases.length) return null;
  const effects = getEffectsArray(actor);
  for (const k of aliases) {
    const hit = effects.find(e => effectHasCoreStatus(e, k));
    if (hit) return hit;
  }
  return null;
}

/**
 * Find all effects on an actor matching a condition key via core status lanes (aliases included).
 * @param {Actor} actor
 * @param {string} key
 * @returns {ActiveEffect[]}
 */
export function findCoreStatusEffects(actor, key) {
  const aliases = coreStatusAliasesForKey(key);
  if (!aliases.length) return [];
  const out = [];
  const effects = getEffectsArray(actor);
  for (const ef of effects) {
    if (!ef) continue;
    for (const k of aliases) {
      if (effectHasCoreStatus(ef, k)) {
        out.push(ef);
        break;
      }
    }
  }
  return out;
}
