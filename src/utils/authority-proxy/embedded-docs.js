import { debugLog } from "./shared.js";

export function isMissingDocumentError(err) {
  const msg = String(err?.message ?? err ?? "");
  return msg.includes("does not exist")
    || msg.includes("No Document")
    || msg.includes("not found")
    || msg.includes("Invalid document");
}

export function getEmbeddedCollection(parent, embeddedName) {
  if (!parent || !embeddedName) return null;
  if (embeddedName === "ActiveEffect") return parent.effects ?? null;
  if (embeddedName === "Item") return parent.items ?? null;
  if (embeddedName === "Token") return parent.tokens ?? null;
  // MeasuredTemplate remains legacy compatibility only; new active area lifecycle is Region-first.
  if (embeddedName === "MeasuredTemplate") return parent.templates ?? parent.measuredTemplates ?? null;
  if (embeddedName === "Region") return parent.regions ?? null;
  return null;
}

export function normalizeEmbeddedDocumentIds(ids) {
  const out = [];
  const seen = new Set();
  for (const rawId of Array.isArray(ids) ? ids : []) {
    const id = String(rawId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function hasEmbeddedDocument(parent, embeddedName, docId) {
  if (!parent || !embeddedName || !docId) return false;
  const collection = getEmbeddedCollection(parent, embeddedName);
  if (!collection?.get && !collection?.has) return true;
  if (typeof collection.has === "function") return collection.has(docId);
  return Boolean(collection.get(docId));
}

export async function deleteEmbeddedDocumentsIdempotent(actor, embeddedName, ids) {
  const requestedIds = normalizeEmbeddedDocumentIds(ids);
  if (!requestedIds.length) return { ok: false, error: "No valid ids" };

  const liveIds = requestedIds.filter((id) => hasEmbeddedDocument(actor, embeddedName, id));
  const skippedIds = requestedIds.filter((id) => !liveIds.includes(id));
  const debugData = {
    actorUuid: actor?.uuid ?? null,
    embeddedName,
    requestedIds,
    liveIds,
    skippedIds
  };

  if (skippedIds.length && liveIds.length) {
    debugLog("deleteEmbeddedDocuments reduced stale ids", debugData);
  }

  if (!liveIds.length) {
    debugLog("deleteEmbeddedDocuments already gone", debugData);
    return { ok: true, requestedIds, deletedIds: [], skippedIds, allAlreadyGone: true };
  }

  try {
    await actor.deleteEmbeddedDocuments(embeddedName, liveIds);
    return { ok: true, requestedIds, deletedIds: liveIds, skippedIds };
  } catch (err) {
    const survivingIds = liveIds.filter((id) => hasEmbeddedDocument(actor, embeddedName, id));
    if (isMissingDocumentError(err) || !survivingIds.length) {
      debugLog("deleteEmbeddedDocuments soft-suppressed race", {
        ...debugData,
        survivingIds,
        error: String(err?.message ?? err ?? "")
      });
      return {
        ok: true,
        requestedIds,
        deletedIds: liveIds.filter((id) => !survivingIds.includes(id)),
        skippedIds,
        survivingIds,
        softSuppressed: true
      };
    }

    console.error("UESRPG | authority-proxy | deleteEmbeddedDocuments failed", {
      actorUuid: actor?.uuid ?? null,
      embeddedName,
      requestedIds,
      liveIds,
      skippedIds,
      survivingIds,
      err
    });
    return { ok: false, error: err?.message ?? String(err), requestedIds, liveIds, skippedIds, survivingIds };
  }
}
