import { alertDialog, customDialog } from "../../../../utils/dialog-v2-helper.js";
import { requestCreateEmbeddedDocuments } from "../../../../utils/authority-proxy.js";
import { postItemToChat } from "../../shared-handlers.js";
import { t } from "../../../../utils/i18n.js";

const SYSTEM_ID = "uesrpg-3ev4";
const SETTING_KEY = "enableItemRowQuickMenu";
const ROW_SELECTOR = "tr.item[data-item-id], li.item[data-item-id]";
const BTN_SELECTOR = ".uesrpg-item-quickmenu-btn";
const CONTEXT_IGNORE_SELECTOR = "input, select, textarea, [contenteditable='true'], .uesrpg-item-quickmenu-btn";

function _isQuickMenuEnabled() {
  try {
    return Boolean(game?.settings?.get?.(SYSTEM_ID, SETTING_KEY));
  } catch (_e) {
    return false;
  }
}

function _escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function _buildSyntheticEvent(target) {
  const safeTarget = target instanceof HTMLElement ? target : null;
  return {
    target: safeTarget,
    currentTarget: safeTarget,
    preventDefault() {},
    stopPropagation() {},
  };
}

function _resolveItemRow(sheet, itemId, anchorEl) {
  const anchorRow = anchorEl?.closest?.(".item[data-item-id]");
  if (anchorRow) return anchorRow;
  const root = sheet?.element;
  if (!(root instanceof HTMLElement) || !itemId) return null;
  return Array.from(root.querySelectorAll(".item[data-item-id]"))
    .find((el) => String(el?.dataset?.itemId ?? "") === String(itemId))
    ?? null;
}

function _buildFallbackTarget(itemId) {
  const el = document.createElement("div");
  el.className = "item";
  if (itemId) el.dataset.itemId = String(itemId);
  return el;
}

function _resolveButtonMount(row) {
  if (!(row instanceof HTMLElement)) return null;
  return row.querySelector(".ues-col-actions, .right-align-cell")
    ?? row.querySelector(".item-name-cell .tableItemNameCell")
    ?? row.querySelector(".item-name-cell .flex-container")
    ?? row.querySelector(".item-name-cell");
}

function _buildKebabButton(itemId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "uesrpg-item-quickmenu-btn";
  button.dataset.action = "itemQuickMenu";
  button.dataset.itemId = String(itemId ?? "");
  button.setAttribute("aria-label", t("UESRPG.UI.ItemActions", "Item actions"));
  button.setAttribute("title", t("UESRPG.UI.ItemActions", "Item actions"));
  button.innerHTML = "<span aria-hidden=\"true\">&#8942;</span>";
  return button;
}

export function injectItemRowKebabButtons(rootEl, { enabled } = {}) {
  if (!(rootEl instanceof HTMLElement)) return;

  for (const existing of rootEl.querySelectorAll(BTN_SELECTOR)) {
    if (!enabled) existing.remove();
  }
  if (!enabled) return;

  for (const row of rootEl.querySelectorAll(ROW_SELECTOR)) {
    const itemId = row?.dataset?.itemId;
    if (!itemId) continue;
    const existing = row.querySelector(BTN_SELECTOR);
    if (existing) {
      existing.dataset.itemId = itemId;
      continue;
    }
    const mount = _resolveButtonMount(row);
    if (!mount) continue;
    mount.append(_buildKebabButton(itemId));
  }
}

export async function openItemRowQuickMenu(sheet, item, { anchorEl } = {}) {
  if (!sheet || !item) return;

  const itemRow = _resolveItemRow(sheet, item.id, anchorEl);
  const targetEl = itemRow
    ?? (anchorEl instanceof HTMLElement ? anchorEl : null)
    ?? _buildFallbackTarget(item.id);
  const fakeEvent = _buildSyntheticEvent(targetEl);
  const canMutate = Boolean(sheet?.isEditable && sheet?.document?.isOwner);
  const canEquip = typeof item?.system?.equipped === "boolean";
  const description = String(item?.system?.description ?? "").trim();
  const includeImage = String(sheet?.document?.type ?? "").toLowerCase() === "player character";

  const buttons = {
    open: {
      label: t("UESRPG.UI.Open", "Open"),
      icon: "fas fa-up-right-from-square",
      callback: async () => {
        await item?.sheet?.render?.(true);
      },
    },
    post: {
      label: t("UESRPG.UI.PostToChat", "Post to Chat"),
      icon: "fas fa-comment",
      callback: async () => {
        if (typeof sheet?._onPostItemToChat === "function") {
          await sheet._onPostItemToChat(fakeEvent, targetEl);
          return;
        }
        await postItemToChat(fakeEvent, sheet?.document, { includeImage, element: targetEl });
      },
    },
    info: {
      label: t("UESRPG.UI.WhatIsThis", "What is this?"),
      icon: "fas fa-circle-question",
      callback: async () => {
        const content = description
          ? `<div class="uesrpg-item-quickmenu-info"><p><strong>${_escapeHtml(item.name)}</strong> (${_escapeHtml(item.type)})</p><div>${description}</div></div>`
          : `<div class="uesrpg-item-quickmenu-info"><p><strong>${_escapeHtml(item.name)}</strong> (${_escapeHtml(item.type)})</p><p>${_escapeHtml(t("UESRPG.UI.NoItemDescription", "No description is available for this item yet."))}</p></div>`;
        await alertDialog({
          title: t("UESRPG.UI.ItemInformation", "Item Information"),
          content,
          buttonLabel: t("UESRPG.UI.Close", "Close"),
          classes: ["uesrpg-item-quickmenu-info-dialog"],
        });
      },
    },
    cancel: {
      label: t("UESRPG.UI.Close", "Close"),
      icon: "fas fa-times",
      callback: () => null,
    },
  };

  if (canEquip) {
    buttons.equip = {
      label: item.system.equipped ? t("UESRPG.UI.Unequip", "Unequip") : t("UESRPG.UI.Equip", "Equip"),
      icon: "fas fa-shield-halved",
      callback: async () => {
        if (typeof sheet?._onItemEquip === "function") {
          await sheet._onItemEquip(fakeEvent, targetEl);
        }
      },
    };
  }

  if (canMutate) {
    buttons.duplicate = {
      label: t("UESRPG.UI.Duplicate", "Duplicate"),
      icon: "fas fa-clone",
      callback: async () => {
        if (typeof sheet?._duplicateItem === "function") {
          await sheet._duplicateItem(item);
          return;
        }
        const created = await requestCreateEmbeddedDocuments(sheet.document, "Item", [item.toObject()]);
        await created?.[0]?.sheet?.render?.(true);
      },
    };
    buttons.delete = {
      label: t("UESRPG.UI.Delete", "Delete"),
      icon: "fas fa-trash",
      callback: async () => {
        if (typeof sheet?._onItemDelete === "function") {
          await sheet._onItemDelete(fakeEvent, targetEl);
        }
      },
    };
  }

  const content = `
    <div class="uesrpg-item-quickmenu">
      <p class="uesrpg-item-quickmenu__title">${_escapeHtml(item.name)}</p>
      <p class="uesrpg-item-quickmenu__hint">${_escapeHtml(t("UESRPG.UI.ChooseItemAction", "Choose an action for this item."))}</p>
    </div>
  `;

  await customDialog({
    title: t("UESRPG.UI.ItemQuickActions", "Item Quick Actions"),
    content,
    buttons,
    default: "open",
    classes: ["uesrpg-item-quickmenu-dialog"],
  });
}

export async function handleItemRowContextMenu(sheet, event) {
  if (!_isQuickMenuEnabled()) return false;
  if (!(event instanceof Event)) return false;

  const target = event.target instanceof Element ? event.target : null;
  if (!target) return false;

  const row = target.closest(".item[data-item-id]");
  if (!(row instanceof HTMLElement)) return false;
  if (target.closest(CONTEXT_IGNORE_SELECTOR)) return false;

  const itemId = String(row?.dataset?.itemId ?? "").trim();
  if (!itemId) return false;
  const item = sheet?.document?.items?.get?.(itemId) ?? null;
  if (!item) return false;

  event.preventDefault();
  event.stopPropagation();
  await openItemRowQuickMenu(sheet, item, { anchorEl: row });
  return true;
}
