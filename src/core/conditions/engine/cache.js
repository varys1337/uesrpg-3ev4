/**
 * src/core/conditions/engine/cache.js
 *
 * Stage 06: parsed-predicate cache boundary.
 *
 * The current condition engine implementation does not yet rely on an external
 * predicate language. This cache is added as an internal utility to enable a
 * future predicate parser to memoize its parse step without changing runtime
 * behavior today.
 */

const _cache = new Map();

export function getCachedParsedPredicate(key) {
  const k = String(key ?? "");
  if (!k) return undefined;
  return _cache.get(k);
}

export function setCachedParsedPredicate(key, value) {
  const k = String(key ?? "");
  if (!k) return;
  _cache.set(k, value);
}

export function clearPredicateCache() {
  _cache.clear();
}
