/**
 * src/utils/clone.js
 *
 * Centralized deep-clone helpers for UESRPG.
 * Two distinct exports cover the two main cloning scenarios in this codebase:
 *
 *   clonePlain   — for plain JavaScript objects (item data, workflow DTOs, etc.)
 *                  Prefers foundry.utils.deepClone for speed and correctness.
 *
 *   cloneFlagState — for values read from Foundry document flags (Proxy-backed objects).
 *                    MUST use JSON round-trip: foundry.utils.deepClone preserves
 *                    read-only property descriptors from v13 flag proxies, which
 *                    causes "Cannot assign to read only property" errors in mergeObject.
 */

/**
 * Deep-clone a plain JavaScript object.
 * Prefers foundry.utils.deepClone → structuredClone → JSON round-trip.
 *
 * Do NOT pass Foundry document flag objects to this function — use cloneFlagState instead.
 *
 * @param {any} value
 * @returns {any}
 */
export function clonePlain(value) {
  if (typeof foundry?.utils?.deepClone === "function") {
    return foundry.utils.deepClone(value);
  }
  if (typeof structuredClone === "function") {
    try { return structuredClone(value); } catch (_e) { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Clone a value read from a Foundry document's flags (or any Proxy-backed object).
 *
 * Uses JSON round-trip to strip read-only property descriptors imposed by Foundry v13
 * flag proxy objects. foundry.utils.deepClone preserves those descriptors, causing
 * "Cannot assign to read only property" errors when the cloned object is later mutated
 * (e.g., via mergeObject) during opposed-workflow card updates.
 *
 * @param {any} value
 * @returns {any}
 */
export function cloneFlagState(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_e) {
    if (typeof structuredClone === "function") {
      try { return structuredClone(value); } catch (_e2) { /* fall through */ }
    }
    return value;
  }
}
