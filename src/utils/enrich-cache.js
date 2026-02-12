/**
 * src/utils/enrich-cache.js
 *
 * Lightweight in-memory cache for TextEditor.enrichHTML results.
 * Avoids re-enriching identical raw text on every sheet render.
 *
 * Cache is keyed per sheet instance via a WeakMap, so entries are
 * garbage-collected when the sheet is destroyed.
 *
 * No schema changes, no document mutations.
 */

/** @type {WeakMap<object, Map<string, {raw: string, html: string}>>} */
const _sheetCaches = new WeakMap();

/**
 * Return cached enriched HTML, or enrich and cache the result.
 *
 * @param {object} owner - Sheet instance (or any stable object) used as cache scope.
 * @param {string} cacheKey - Stable label (e.g. "bio", "desc", "notes").
 * @param {string} rawText - Raw source text to enrich.
 * @param {function(string): Promise<string>} enrichFn - The enrichment function.
 * @returns {Promise<string>} Enriched HTML string.
 */
export async function cachedEnrichHTML(owner, cacheKey, rawText, enrichFn) {
  if (!owner) return enrichFn(rawText ?? "");

  let cache = _sheetCaches.get(owner);
  if (!cache) {
    cache = new Map();
    _sheetCaches.set(owner, cache);
  }

  const raw = rawText ?? "";
  const entry = cache.get(cacheKey);

  // Cache hit: identical raw text → return cached enriched HTML.
  if (entry && entry.raw === raw) return entry.html;

  // Cache miss or stale: re-enrich and store.
  const html = await enrichFn(raw);
  cache.set(cacheKey, { raw, html });
  return html;
}

/**
 * Invalidate all cached entries for a given sheet instance.
 *
 * @param {object} owner - Sheet instance whose cache should be cleared.
 */
export function invalidateEnrichCache(owner) {
  if (owner) _sheetCaches.delete(owner);
}
