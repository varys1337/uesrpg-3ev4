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

export function resolveUuidSync(uuid, { cache } = {}) {
  if (!uuid || typeof uuid !== "string") return null;
  if (cache?.has?.(uuid)) return cache.get(uuid) ?? null;

  let doc = null;
  try { doc = fromUuidSync(uuid) ?? null; } catch (_e) { doc = null; }

  cache?.set?.(uuid, doc);
  return doc;
}

export function getActorFromResolvedDocument(doc) {
  if (!doc) return null;
  if (doc?.documentName === "Actor") return doc;
  if (doc?.actor) return doc.actor ?? null;
  const parent = doc?.parent ?? null;
  if (parent?.documentName === "Actor") return parent;
  return null;
}

export function resolveActorFromUuidSync(uuid, { cache } = {}) {
  return getActorFromResolvedDocument(resolveUuidSync(uuid, { cache }));
}

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
      return resolveUuidSync(uuid, { cache: _cache });
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
