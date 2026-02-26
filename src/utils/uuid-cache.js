/**
 * src/utils/uuid-cache.js
 *
 * Ephemeral per-workflow UUID resolution cache.
 *
 * Creates a lightweight resolver instance backed by a Map. The resolver deduplicates
 * repeated fromUuid / fromUuidSync calls within a single workflow invocation without
 * any global state — the Map is garbage-collected with the closure when the workflow ends.
 *
 * Usage:
 *   const resolver = createUuidResolver();
 *   const actor = resolver.resolveSync(actorUuid);       // sync
 *   const item  = await resolver.resolve(itemUuid);      // async
 *
 * Rules:
 *   - Attach to a per-workflow context object (e.g., ctx._uuidResolver) or a local variable.
 *   - Do NOT store on game, CONFIG, or any long-lived global.
 *   - Each workflow invocation should create its own resolver to prevent stale results.
 */

/**
 * @typedef {{ resolveSync: (uuid: string|null|undefined) => any, resolve: (uuid: string|null|undefined) => Promise<any>, clear: () => void }} UuidResolver
 */

/**
 * Create a new ephemeral UUID resolver instance.
 * @returns {UuidResolver}
 */
export function createUuidResolver() {
  /** @type {Map<string, any>} */
  const _cache = new Map();

  return {
    /**
     * Synchronously resolve a UUID using fromUuidSync, caching the result.
     * Returns null for falsy / unresolvable inputs.
     * @param {string|null|undefined} uuid
     * @returns {any}
     */
    resolveSync(uuid) {
      if (!uuid) return null;
      if (_cache.has(uuid)) return _cache.get(uuid);
      let doc = null;
      try { doc = fromUuidSync(uuid) ?? null; } catch (_e) { doc = null; }
      _cache.set(uuid, doc);
      return doc;
    },

    /**
     * Asynchronously resolve a UUID using fromUuid, caching the result.
     * Returns null for falsy / unresolvable inputs.
     * @param {string|null|undefined} uuid
     * @returns {Promise<any>}
     */
    async resolve(uuid) {
      if (!uuid) return null;
      if (_cache.has(uuid)) return _cache.get(uuid);
      let doc = null;
      try { doc = (await fromUuid(uuid)) ?? null; } catch (_e) { doc = null; }
      _cache.set(uuid, doc);
      return doc;
    },

    /**
     * Evict all cached entries (useful if the same resolver instance is reused
     * across a step boundary where documents may have changed).
     */
    clear() { _cache.clear(); }
  };
}
