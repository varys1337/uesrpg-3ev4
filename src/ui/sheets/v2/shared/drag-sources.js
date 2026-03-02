/**
 * Ensure item rows are explicit drag sources for AppV2 DragDrop wiring.
 * We do this at render time because most templates do not set draggable attrs.
 */

import { buildItemDragPayload } from "../../../../utils/drag-payload.js";
import { dndDebug, makeDndTraceId } from "../../../../utils/dnd-debugger.js";

const DEFAULT_SELECTOR = "tr.item[data-item-id], .spell-row[data-item-id], li.item[data-item-id]";
const DEFAULT_OPTOUT_CLASS = "uesrpg-no-drag";
const DRAG_BIND_FLAG = "uesrpgDragBound";

function _bindRowDragEvents(row, actor) {
  if (!row || row.dataset?.[DRAG_BIND_FLAG] === "1") return;
  row.dataset[DRAG_BIND_FLAG] = "1";

  row.addEventListener("dragstart", (event) => {
    try {
      const itemId = row.dataset?.itemId ?? null;
      const item = itemId ? actor?.items?.get?.(itemId) : null;
      if (!item) return;

      const traceId = makeDndTraceId("row-drag");
      const payload = buildItemDragPayload(item, { traceId });
      event.dataTransfer?.setData("text/plain", JSON.stringify(payload));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
      row.classList.add("uesrpg-dragging");
      dndDebug("row.dragstart", {
        itemId,
        itemUuid: item?.uuid ?? null,
        actorUuid: actor?.uuid ?? null,
        payload,
      }, { traceId });
    } catch (_e) {
      /* no-op */
    }
  }, true);

  row.addEventListener("dragend", () => {
    row.classList.remove("uesrpg-dragging");
  }, true);
}

/**
 * Mark item row-like elements as draggable unless explicitly opted out.
 * Also stamp data-uuid when actor context is available to mirror core/PF2e-style metadata.
 *
 * @param {HTMLElement} root
 * @param {object} [options]
 * @param {string} [options.selector]
 * @param {string} [options.optOutClass]
 * @param {Actor|null} [options.actor]
 */
export function enableItemRowDragSources(root, options = {}) {
  if (!root) return;
  const selector = String(options.selector ?? DEFAULT_SELECTOR);
  const optOutClass = String(options.optOutClass ?? DEFAULT_OPTOUT_CLASS);
  const actor = options.actor ?? null;

  for (const row of root.querySelectorAll(selector)) {
    if (row.classList?.contains(optOutClass)) continue;
    const itemId = row.dataset?.itemId;
    if (!itemId) continue;

    row.setAttribute("draggable", "true");

    if (!row.dataset?.uuid && actor?.items?.get) {
      const item = actor.items.get(itemId);
      if (item?.uuid) row.dataset.uuid = item.uuid;
      if (item?.uuid) row.dataset.documentUuid = item.uuid;
      row.dataset.documentType = "Item";
      row.dataset.documentId = item?.id ?? itemId;
    }

    if (actor) _bindRowDragEvents(row, actor);
  }
}
