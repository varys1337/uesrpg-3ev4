/**
 * src/core/combat/opposed/helpers/docs.js
 * Document resolution utilities extracted from opposed-workflow.js monolith
 */

import { getMeleeReachMeters, anyOtherTokensInMeleeOfEither } from "../../../traits/combat-proximity.js";
import { measureTokenDistance as _measureTokenDistance } from "../range.js";
import { getActorFromResolvedDocument, resolveUuidSync } from "../../../../utils/uuid-cache.js";

export function _resolveDoc(uuid) {
  return resolveUuidSync(uuid);
}

export function _resolveActor(docOrUuid) {
  const doc = typeof docOrUuid === "string" ? _resolveDoc(docOrUuid) : docOrUuid;
  return getActorFromResolvedDocument(doc);
}

/**
 * Resolve an actor, preferring the token's synthetic actor when a tokenUuid is available.
 * For unlinked NPC tokens, the stored actorUuid points to the base/prototype world actor,
 * but the token's synthetic actor has the actual equipped items and current state.
 * @param {string|null} actorUuid - The stored actor UUID (may be a base actor for unlinked tokens)
 * @param {string|null} tokenUuid - The token UUID (Scene.x.Token.y) — used to get the synthetic actor
 * @returns {Actor|null}
 */
export function _resolveActorViaToken(actorUuid, tokenUuid) {
  if (tokenUuid) {
    const tokenDoc = _resolveDoc(tokenUuid);
    if (tokenDoc?.documentName === "Token" && tokenDoc.actor) return tokenDoc.actor;
  }
  return _resolveActor(actorUuid);
}

/**
 * Resolve an embedded item (weapon, spell, ammo, etc.) by UUID, with a fallback
 * to direct lookup in the given actor's items collection.
 *
 * For unlinked tokens, `item.uuid` returns `Actor.{baseId}.Item.{itemId}` which
 * resolves through the base world actor. If that actor was deleted or the item
 * only exists on the token delta, `fromUuidSync` returns null. The fallback
 * extracts the item ID from the UUID and finds it directly in the actor's items.
 *
 * @param {string|null} itemUuid - The item UUID to resolve
 * @param {Actor|null} [actor=null] - Actor whose items to search as fallback
 * @returns {Item|null}
 */
export function _resolveItemViaActor(itemUuid, actor = null) {
  if (!itemUuid) return null;
  const uuid = String(itemUuid).trim();
  if (!uuid) return null;
  const direct = resolveUuidSync(uuid);
  if (direct) return direct;
  // Fallback: extract item ID from UUID and look up in actor's items
  if (actor?.items) {
    const match = uuid.match(/\.Item\.([^.]+)$/);
    if (match) return actor.items.get(match[1]) ?? null;
  }
  return null;
}

export function _resolveToken(docOrUuid) {
  const doc = typeof docOrUuid === "string" ? _resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  // TokenDocument
  if (doc.documentName === "Token") return doc.object ?? null;
  // Token
  if (doc.actor && doc.document) return doc;
  return null;
}

// Re-export for compatibility with existing code
export { _measureTokenDistance };

export function _isIsolatedDuelByTokens(tokenA, tokenB) {
  try {
    if (!tokenA || !tokenB) return false;
    if (!globalThis?.canvas?.ready) return false;
    const reachA = getMeleeReachMeters(tokenA.actor);
    const reachB = getMeleeReachMeters(tokenB.actor);
    // If there are any tokens within melee range of either combatant (excluding the duel pair), duel is not isolated.
    return !anyOtherTokensInMeleeOfEither(tokenA, tokenB, { reachMetersA: reachA, reachMetersB: reachB });
  } catch (_e) {
    return false;
  }
}
