/**
 * src/core/skills/opposed/docs.js
 * Document resolution helpers (actors, tokens)
 */

import { getActorFromResolvedDocument, resolveUuidSync } from "../../../../utils/uuid-cache.js";

function _resolveWithResolver(uuid, resolver = null) {
  if (resolver?.resolveSync) return resolver.resolveSync(uuid);
  return resolveUuidSync(uuid);
}

export function _resolveDoc(uuid, { resolver = null } = {}) {
  if (!uuid) return null;
  if (typeof uuid === "object" && uuid?.uuid) return uuid;
  return _resolveWithResolver(uuid, resolver);
}

export function _resolveActor(docOrUuid, { resolver = null } = {}) {
  if (!docOrUuid) return null;
  const doc = (typeof docOrUuid === "string") ? _resolveDoc(docOrUuid, { resolver }) : docOrUuid;
  return getActorFromResolvedDocument(doc);
}

export function _resolveToken(docOrUuid, { resolver = null } = {}) {
  if (!docOrUuid) return null;
  const doc = (typeof docOrUuid === "string") ? _resolveDoc(docOrUuid, { resolver }) : docOrUuid;
  if (!doc) return null;
  if (doc.documentName === "Token" || doc.documentName === "TokenDocument") return doc;
  return null;
}

