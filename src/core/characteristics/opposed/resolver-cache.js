import { _resolveActor, _resolveDoc, _resolveToken } from "./docs.js";

export function createActionUuidResolver() {
  const cache = new Map();
  return {
    resolveSync(uuid) {
      if (!uuid) return null;
      if (cache.has(uuid)) return cache.get(uuid);
      const result = _resolveDoc(uuid);
      cache.set(uuid, result);
      return result;
    }
  };
}

export function resolveActorCached(docOrUuid, resolver = null) {
  if (!docOrUuid) return null;
  if (typeof docOrUuid !== "string") return _resolveActor(docOrUuid);
  const doc = resolver ? resolver.resolveSync(docOrUuid) : _resolveDoc(docOrUuid);
  return _resolveActor(doc);
}

export function resolveTokenCached(docOrUuid, resolver = null) {
  if (!docOrUuid) return null;
  if (typeof docOrUuid !== "string") return _resolveToken(docOrUuid);
  const doc = resolver ? resolver.resolveSync(docOrUuid) : _resolveDoc(docOrUuid);
  return _resolveToken(doc);
}

export function getTokenDocumentUuid(tokenLike) {
  return tokenLike?.document?.uuid ?? tokenLike?.uuid ?? null;
}
