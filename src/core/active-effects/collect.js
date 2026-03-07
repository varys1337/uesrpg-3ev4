import { isItemEffectActive } from "./transfer.js";

/**
 * Collect currently-applicable effects from actor + transferable embedded item effects.
 * Uses the system's transfer gating helper when available.
 *
 * @param {import("foundry").documents.BaseActor} actor
 * @param {{dedupeByOrigin?:boolean, debug?:boolean}} [options]
 * @returns {any[]} Array of ActiveEffect-like objects
 */
export function collectApplicableEffects(actor, { dedupeByOrigin = true, debug = false } = {}) {
  // Filter out disabled actor effects — a disabled effect must not contribute
  // changes to modifier totals (matches actors/ae/modifiers.js behavior).
  const actorEffects = Array.from(actor.effects ?? []).filter(e => e && !e.disabled);

  // Index origins already present directly on the actor.
  const actorOrigins = new Set(
    actorEffects.map(e => e?.origin).filter(o => typeof o === "string" && o.length > 0)
  );

  /** @type {any[]} */
  const transferable = [];

  // Collect transfer effects from embedded items (actor-owned).
  for (const item of actor.items ?? []) {
    const itemEffects = Array.from(item?.effects ?? []);
    for (const effect of itemEffects) {
      // Respect existing gating helper if present, otherwise fallback to transfer flag.
      let isActive = false;
      try {
        // Use the system's deterministic transfer gating (same as actor-sheet TN breakdown).
        isActive = isItemEffectActive(actor, item, effect);
      } catch (err) {
        if (debug) console.debug("[UESRPG|AE] Transfer gating threw; skipping effect", { err, effect, item });
        isActive = false;
      }

      if (!isActive) continue;

      if (dedupeByOrigin) {
        const origin = effect?.origin;
        if (origin && actorOrigins.has(origin)) {
          if (debug) console.debug("[UESRPG|AE] Dedupe transfer effect by origin", { origin, effect, item });
          continue;
        }
      }

      transferable.push(effect);
    }
  }

  return actorEffects.concat(transferable);
}

/**
 * Return applicable effects for an actor, using a per-actor ephemeral cache.
 *
 * The cache is stored as `actor._aeApplicableCache = { effects }` and is cleared
 * by AE lifecycle hooks when ActiveEffects/items/equip-state changes on the actor.
 *
 * Only supports the default `dedupeByOrigin: true` path. Callers that need
 * `dedupeByOrigin: false` should call `collectApplicableEffects` directly.
 *
 * @param {import("foundry").documents.BaseActor} actor
 * @returns {any[]} Array of ActiveEffect-like objects
 */
export function getApplicableEffectsCached(actor) {
  const cache = actor?._aeApplicableCache;
  if (cache?.effects) return cache.effects;
  const effects = collectApplicableEffects(actor, { dedupeByOrigin: true, debug: false });
  if (actor) actor._aeApplicableCache = { effects };
  return effects;
}
