/**
 * Ensure item rows are explicit drag sources for AppV2 DragDrop wiring.
 * We do this at render time because most templates do not set draggable attrs.
 */

import { buildItemDragPayload } from "../../../../utils/drag-payload.js";
import { dndDebug, makeDndTraceId } from "../../../../utils/dnd-debugger.js";
import { getEffectDropRestriction } from "../../../../core/active-effects/drop-eligibility.js";
import { t } from "../../../../utils/i18n.js";

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

/** Stamp only the icon/name handles; mutation controls and row whitespace never drag. */
export function enableEffectDragSources(root, document) {
  for (const row of root?.querySelectorAll?.("[data-effect-id]") ?? []) {
    const effect = document?.effects?.get(row.dataset.effectId);
    if (!effect) continue;
    for (const handle of row.querySelectorAll(".effect-icon, .effect-name button, .effect-name:not(:has(button)), .uesrpg-effect-edit-icon")) {
      // The surrounding native edit button is the image handle where present.
      if (handle.matches("img") && handle.closest("button")) { handle.draggable = false; continue; }
      const restriction = getEffectDropRestriction(effect);
      handle.draggable = !restriction;
      handle.classList.toggle("uesrpg-effect-drag-source", !restriction);
      handle.dataset.effectId = effect.id;
      handle.dataset.documentUuid = effect.uuid;
      handle.dataset.documentType = "ActiveEffect";
      handle.dataset.tooltipText = t(`UESRPG.EffectTransfer.${restriction ?? (document.documentName === "Actor" ? "MoveHint" : "ApplyHint")}`);
    }
  }
}

export function writeEffectDragData(event, document) {
  const handle = event.target?.closest?.(".uesrpg-effect-drag-source");
  if (!handle) return false;
  const effect = document?.effects?.get(handle.dataset.effectId);
  if (!effect || getEffectDropRestriction(effect)) { event.preventDefault(); return true; }
  event.dataTransfer?.setData("text/plain", JSON.stringify(effect.toDragData()));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = document.documentName === "Actor" ? "move" : "copy";
  return true;
}
