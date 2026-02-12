/**
 * src/core/characteristics/opposed/docs.js
 * Document resolution helpers (actors, tokens) for characteristic opposed
 */

export function _resolveDoc(uuid) {
  if (!uuid) return null;
  if (typeof uuid === "object" && uuid?.uuid) return uuid;
  try {
    return fromUuidSync(uuid);
  } catch {
    return null;
  }
}

export function _resolveActor(docOrUuid) {
  if (!docOrUuid) return null;
  const doc = (typeof docOrUuid === "string") ? _resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  if (doc.documentName === "Actor") return doc;
  return doc.actor ?? null;
}

export function _resolveToken(docOrUuid) {
  if (!docOrUuid) return null;
  const doc = (typeof docOrUuid === "string") ? _resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  if (doc.documentName === "Token" || doc.documentName === "TokenDocument") return doc;
  return null;
}
