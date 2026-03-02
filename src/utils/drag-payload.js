/**
 * Build robust drag payloads for Item sheet-origin drags.
 */

import { dndDebug, rememberLastItemDragPayload } from "./dnd-debugger.js";

/**
 * Build normalized drag payload for an Item document.
 * Prefers Foundry-native toDragData() when available.
 *
 * @param {Item} item
 * @param {object} [options]
 * @param {string|null} [options.traceId]
 * @returns {object}
 */
export function buildItemDragPayload(item, options = {}) {
  const traceId = options.traceId ?? null;
  const nativeData = (() => {
    try {
      return (typeof item?.toDragData === "function") ? (item.toDragData() ?? {}) : {};
    } catch (_e) {
      return {};
    }
  })();

  const actor = item?.actor ?? null;
  const payload = {
    ...nativeData,
    type: "Item",
    uuid: nativeData?.uuid ?? item?.uuid ?? null,
    documentUuid: nativeData?.documentUuid ?? item?.uuid ?? null,
    itemId: nativeData?.itemId ?? item?.id ?? null,
    id: nativeData?.id ?? item?.id ?? null,
  };

  if (item?.pack) {
    payload.pack = nativeData?.pack ?? item.pack;
    payload.id = nativeData?.id ?? item?.id ?? null;
  }

  if (actor) {
    payload.actorId = nativeData?.actorId ?? actor.id ?? null;
    payload.actorUuid = nativeData?.actorUuid ?? actor.uuid ?? null;
  }

  dndDebug("drag.payload", {
    item: item?.name ?? null,
    itemType: item?.type ?? null,
    uuid: payload.uuid ?? null,
    actorUuid: payload.actorUuid ?? null,
    pack: payload.pack ?? null,
    payload,
  }, { traceId });

  rememberLastItemDragPayload(payload, { traceId });

  return payload;
}
