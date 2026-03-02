/**
 * Unified drop-data parsing and item resolution for sheet DnD.
 */

import { dndDebug, getRecentItemDragPayload } from "./dnd-debugger.js";

const SYSTEM_ID = "uesrpg-3ev4";
const CACHE_COOL_STREAK = 8;
let _cleanDropReadStreak = 0;

function _isCacheFallbackEnabled() {
  try {
    return Boolean(game?.settings?.get?.(SYSTEM_ID, "dndDebugCacheFallbackEnabled"));
  } catch (_e) {
    return true;
  }
}

function _pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return null;
}

function _normalizeDropDataShape(raw) {
  const data = { ...(raw ?? {}) };

  data.uuid = _pickFirstNonEmpty(data.uuid, data.documentUuid);
  data.documentUuid = _pickFirstNonEmpty(data.documentUuid, data.uuid);

  data.itemId = _pickFirstNonEmpty(data.itemId, data.id, data._id, data.documentId);
  data.id = _pickFirstNonEmpty(data.id, data.itemId, data._id, data.documentId);

  data.actorId = _pickFirstNonEmpty(data.actorId, data.parentId);
  data.actorUuid = _pickFirstNonEmpty(data.actorUuid, data.parentUuid);

  if (!data.type) {
    const uuid = String(data.uuid ?? "");
    if (uuid.includes(".Item.") || uuid.startsWith("Item.")) data.type = "Item";
    else if (uuid.includes(".Actor.") || uuid.startsWith("Actor.")) data.type = "Actor";
  }

  if (!data.type && (data.itemId || data.id) && (data.actorId || data.actorUuid || data.pack)) {
    data.type = "Item";
  }

  if (data.pack && !data.id && data._id) data.id = data._id;

  return data;
}

function _payloadScore(data) {
  if (!data || typeof data !== "object") return -1;
  let score = 0;
  if (String(data.type ?? "") === "Item") score += 3;
  if (data.uuid || data.documentUuid) score += 4;
  if (data.itemId || data.id || data._id) score += 2;
  if (data.actorId || data.actorUuid) score += 1;
  if (data.pack) score += 1;
  if (data.data) score += 1;
  return score;
}

function _safeTextEditorDragData(event) {
  try {
    return foundry.applications.ux.TextEditor.implementation.getDragEventData(event) ?? null;
  } catch (_e) {
    return null;
  }
}

function _safePlainDragData(event) {
  try {
    const raw = String(event?.dataTransfer?.getData?.("text/plain") ?? "").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

/**
 * Read and normalize drop data from a DragEvent.
 * @param {DragEvent} event
 * @param {{traceId?: string|null}} [options]
 * @returns {object}
 */
export function readDropData(event, options = {}) {
  const traceId = options.traceId ?? null;
  const editorData = _safeTextEditorDragData(event);
  const plainData = _safePlainDragData(event);

  const editorScore = _payloadScore(editorData);
  const plainScore = _payloadScore(plainData);
  const primary = plainScore >= editorScore ? plainData : editorData;
  const secondary = plainScore >= editorScore ? editorData : plainData;

  const merged = {};
  const merge = (src) => {
    if (!src || typeof src !== "object") return;
    for (const [key, value] of Object.entries(src)) {
      if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
        merged[key] = value;
      }
    }
  };

  // Use the strongest payload first, then fill missing keys from the other.
  merge(primary);
  merge(secondary);

  const normalized = _normalizeDropDataShape(merged);
  const payloadScore = _payloadScore(normalized);
  const hasCriticalIds = Boolean(
    normalized?.uuid ||
    normalized?.documentUuid ||
    normalized?.itemId ||
    normalized?.id ||
    normalized?.data
  );
  const isLikelyClean = normalized?.type === "Item" && hasCriticalIds && payloadScore >= 6;
  if (isLikelyClean) {
    _cleanDropReadStreak = Math.min(_cleanDropReadStreak + 1, CACHE_COOL_STREAK + 4);
  }

  const shouldAttemptCache = !isLikelyClean && _isCacheFallbackEnabled();
  if (shouldAttemptCache) {
    if (_cleanDropReadStreak >= CACHE_COOL_STREAK) {
      dndDebug("drop.read.cacheSkippedAfterCleanStreak", {
        payloadScore,
        cleanStreak: _cleanDropReadStreak,
        normalized,
      }, { traceId });
      _cleanDropReadStreak = 0;
    } else {
      const cached = getRecentItemDragPayload(5000);
      if (cached) {
        const fromCache = _normalizeDropDataShape({
          ...cached,
          ...normalized,
        });
        dndDebug("drop.read.cacheFallback", {
          payloadScore,
          cleanStreak: _cleanDropReadStreak,
          normalizedBefore: normalized,
          normalizedAfter: fromCache,
        }, { traceId });
        _cleanDropReadStreak = 0;
        return fromCache;
      }
    }
  }

  dndDebug("drop.read", {
    hasEditorData: Boolean(editorData),
    hasPlainData: Boolean(plainData),
    editorScore,
    plainScore,
    primarySource: primary === plainData ? "text/plain" : "textEditor",
    cleanStreak: _cleanDropReadStreak,
    normalized,
  }, { traceId });

  return normalized;
}

function _itemClass() {
  return CONFIG?.Item?.documentClass ?? globalThis.Item?.implementation ?? globalThis.Item;
}

/**
 * Resolve an Item from normalized drop data with deterministic fallback chain.
 * @param {object} dropData
 * @param {{traceId?: string|null}} [options]
 * @returns {Promise<{dropData: object, item: Item|null, sourceKind: string, resolutionPath: string[], errors: string[]}>}
 */
export async function resolveDroppedItemDetailed(dropData, options = {}) {
  const traceId = options.traceId ?? null;
  const normalized = _normalizeDropDataShape(dropData);
  const resolutionPath = [];
  const errors = [];

  if (!normalized || normalized.type !== "Item") {
    return {
      dropData: normalized,
      item: null,
      sourceKind: "invalid",
      resolutionPath: ["invalidType"],
      errors: ["Drop data is not an Item payload"],
    };
  }

  const ItemClass = _itemClass();

  if (ItemClass?.fromDropData) {
    resolutionPath.push("Item.fromDropData");
    try {
      const item = await ItemClass.fromDropData(normalized);
      if (item) {
        dndDebug("resolve.success", { sourceKind: "fromDropData", resolutionPath }, { traceId });
        return { dropData: normalized, item, sourceKind: "fromDropData", resolutionPath, errors };
      }
    } catch (err) {
      errors.push(`fromDropData: ${err?.message ?? String(err)}`);
    }
  }

  const uuid = _pickFirstNonEmpty(normalized.uuid, normalized.documentUuid);
  if (uuid) {
    resolutionPath.push("fromUuid");
    try {
      const item = await fromUuid(uuid);
      if (item?.documentName === "Item") {
        dndDebug("resolve.success", { sourceKind: "uuid", resolutionPath, uuid }, { traceId });
        return { dropData: normalized, item, sourceKind: "uuid", resolutionPath, errors };
      }
    } catch (err) {
      errors.push(`fromUuid: ${err?.message ?? String(err)}`);
    }
  }

  const actorId = normalized.actorId ?? null;
  const actorUuid = normalized.actorUuid ?? null;
  const itemId = normalized.itemId ?? normalized.id ?? null;
  if (itemId && (actorId || actorUuid)) {
    resolutionPath.push("actor.items.get");
    try {
      let actor = null;
      if (actorId) actor = game?.actors?.get?.(actorId) ?? null;
      if (!actor && actorUuid) actor = await fromUuid(actorUuid);
      const item = actor?.items?.get?.(itemId) ?? null;
      if (item) {
        dndDebug("resolve.success", { sourceKind: "actorItem", resolutionPath, actorId, actorUuid, itemId }, { traceId });
        return { dropData: normalized, item, sourceKind: "actorItem", resolutionPath, errors };
      }
    } catch (err) {
      errors.push(`actorItem: ${err?.message ?? String(err)}`);
    }
  }

  if (normalized.pack && normalized.id) {
    resolutionPath.push("pack.getDocument");
    try {
      const pack = game?.packs?.get?.(normalized.pack) ?? null;
      const item = await pack?.getDocument?.(normalized.id);
      if (item) {
        dndDebug("resolve.success", { sourceKind: "pack", resolutionPath, pack: normalized.pack, id: normalized.id }, { traceId });
        return { dropData: normalized, item, sourceKind: "pack", resolutionPath, errors };
      }
    } catch (err) {
      errors.push(`pack: ${err?.message ?? String(err)}`);
    }
  }

  if (normalized.data && ItemClass?.fromSource) {
    resolutionPath.push("Item.fromSource");
    try {
      const item = ItemClass.fromSource(normalized.data);
      if (item) {
        dndDebug("resolve.success", { sourceKind: "fromSource", resolutionPath }, { traceId });
        return { dropData: normalized, item, sourceKind: "fromSource", resolutionPath, errors };
      }
    } catch (err) {
      errors.push(`fromSource: ${err?.message ?? String(err)}`);
    }
  }

  dndDebug("resolve.failed", { normalized, resolutionPath, errors }, { traceId });
  return {
    dropData: normalized,
    item: null,
    sourceKind: "unresolved",
    resolutionPath,
    errors,
  };
}

/**
 * Backward-compatible resolver returning Item|null.
 * @param {object} dropData
 * @param {{traceId?: string|null}} [options]
 * @returns {Promise<Item|null>}
 */
export async function resolveDroppedItem(dropData, options = {}) {
  const detailed = await resolveDroppedItemDetailed(dropData, options);
  return detailed.item ?? null;
}
