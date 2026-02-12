/**
 * src/core/combat/opposed/helpers/docs.js
 * Document resolution utilities extracted from opposed-workflow.js monolith
 */

import { getMeleeReachMeters, anyOtherTokensInMeleeOfEither } from "../../../traits/combat-proximity.js";
import { measureTokenDistance as _measureTokenDistance } from "../range.js";

export function _resolveDoc(uuid) {
  if (!uuid) return null;
  try {
    return fromUuidSync(uuid);
  } catch (_e) {
    return null;
  }
}

export function _resolveActor(docOrUuid) {
  const doc = typeof docOrUuid === "string" ? _resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  if (doc.documentName === "Actor") return doc;
  if (doc.documentName === "Token") return doc.actor ?? null;
  if (doc.actor) return doc.actor;
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
