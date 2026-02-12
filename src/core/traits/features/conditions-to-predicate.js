/**
 * src/core/traits/features/conditions-to-predicate.js
 *
 * Compile legacy rule-element conditions[] entries into roll-option predicates.
 */

function _slug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9:_-]/g, "");
}

function _cloneCondition(condition) {
  if (typeof foundry !== "undefined" && foundry?.utils?.deepClone) {
    return foundry.utils.deepClone(condition ?? {});
  }
  if (typeof structuredClone === "function") {
    return structuredClone(condition ?? {});
  }
  return { ...(condition ?? {}) };
}

/**
 * Compile legacy conditions[] to a predicate array where possible.
 * Results are memoized by a stable key derived from the conditions array
 * to avoid re-computation on each roll.
 *
 * @param {Array} conditions
 * @param {object} [_options]
 * @returns {{predicate:Array, residualConditions:Array}}
 */

/** @type {Map<string, {predicate:Array, residualConditions:Array}>} */
const _compiledCache = new Map();
const _COMPILED_CACHE_MAX = 256;

export function compileConditionsToPredicate(conditions, _options = {}) {
  const list = Array.isArray(conditions) ? conditions : [];

  // Build a stable cache key from the conditions array.
  let cacheKey;
  try {
    cacheKey = JSON.stringify(list);
  } catch (_e) {
    cacheKey = null;
  }

  if (cacheKey && _compiledCache.has(cacheKey)) {
    // Return a shallow clone to prevent mutation of cached values.
    const cached = _compiledCache.get(cacheKey);
    return { predicate: [...cached.predicate], residualConditions: cached.residualConditions.map(_cloneCondition) };
  }

  const predicate = [];
  const residualConditions = [];
  for (const cond of list) {
    const type = String(cond?.type ?? "").trim();
    if (!type) continue;

    if (type === "attackMode") {
      const mode = _slug(cond?.mode);
      if (!mode) {
        residualConditions.push(_cloneCondition(cond));
        continue;
      }
      predicate.push(`attack:mode:${mode}`);
      continue;
    }

    if (type === "attackVariant") {
      const variant = _slug(cond?.variant);
      if (!variant) {
        residualConditions.push(_cloneCondition(cond));
        continue;
      }
      predicate.push(`attack:variant:${variant}`);
      continue;
    }

    if (type === "hidden") {
      predicate.push("state:hidden");
      continue;
    }

    if (type === "inCombat") {
      predicate.push("state:incombat");
      continue;
    }

    if (type === "skillTest") {
      const skill = _slug(cond?.skillName);
      if (!skill) {
        residualConditions.push(_cloneCondition(cond));
        continue;
      }
      predicate.push(`test:skill:${skill}`);
      continue;
    }

    // "weaponType" in current authoring usually means melee/ranged mode.
    // Reuse attack:mode until a dedicated weapon option taxonomy is introduced.
    if (type === "weaponType") {
      const mode = _slug(cond?.mode);
      if (!mode) {
        residualConditions.push(_cloneCondition(cond));
        continue;
      }
      predicate.push(`attack:mode:${mode}`);
      continue;
    }

    // Keep complex or unknown condition types in residual runtime checks.
    residualConditions.push(_cloneCondition(cond));
  }

  const result = { predicate, residualConditions };

  // Store in cache (bounded size).
  if (cacheKey && _compiledCache.size < _COMPILED_CACHE_MAX) {
    _compiledCache.set(cacheKey, result);
  }

  return result;
}
