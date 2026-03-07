/**
 * src/core/skills/key-utils.js
 *
 * Shared key normalization helper for skills core modules.
 */

const _normalizeKeyCache = new Map();

export function normalizeKey(value) {
  const key = String(value ?? "");
  const cached = _normalizeKeyCache.get(key);
  if (cached != null) return cached;

  const normalized = key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_]/g, "");

  _normalizeKeyCache.set(key, normalized);
  return normalized;
}
