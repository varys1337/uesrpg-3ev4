import { alertDialog } from "../../../../utils/dialog-v2-helper.js";
import { requestCreateEmbeddedDocuments } from "../../../../utils/authority-proxy.js";
import { postItemToChat } from "../../shared-handlers.js";
import { t } from "../../../../utils/i18n.js";
import { executeItemActivation } from "../../../../core/system/activation/index.js";
import { castScrollFromItem } from "../../../../core/magic/scroll-casting.js";
import { drinkPotion, applyAlchemyToTarget, pickAlchemyCoatingTarget } from "../../../../core/alchemy/runtime.js";
import { onCastEnchantmentAction } from "../../shared/listeners/enchanting-cast.js";

const SYSTEM_ID = "uesrpg-3ev4";
const SETTING_KEY = "enableItemRowQuickMenu";
const ROW_SELECTOR = "tr.item[data-item-id], li.item[data-item-id]";
const BTN_SELECTOR = ".uesrpg-item-quickmenu-btn";
const CONTEXT_IGNORE_SELECTOR = "input, select, textarea, [contenteditable='true']";
const BOUND_ATTR = "uesrpgItemQuickMenuBound";
const FEATURE_TYPES = new Set(["trait", "talent", "power"]);
const ALCHEMY_PRODUCT_KINDS = new Set(["potion", "poison", "toxin"]);
const SPELLCASTING_ITEM_TYPES = new Set(["weapon", "armor", "ammunition", "equipment", "container", "scroll"]);

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

function _resolveContextRow(target) {
  return target?.closest?.(".item[data-item-id]") ?? null;
}

function _resolveContextItem(sheet, target) {
  if (!_isQuickMenuEnabled()) return null;
  const row = _resolveContextRow(target);
  const itemId = String(row?.dataset?.itemId ?? "").trim();
  if (!itemId) return null;
  return sheet?.document?.items?.get?.(itemId) ?? null;
}

function _canMutate(sheet) {
  return Boolean(sheet?.isEditable && sheet?.document?.isOwner);
}

function _includeImage(sheet) {
  return String(sheet?.document?.type ?? "").toLowerCase() === "player character";
}

function _hasLinkedScrollSpell(item) {
  return item?.type === "scroll" && String(item?.system?.spellUuid ?? "").trim().length > 0;
}

function _getAlchemyKind(item) {
  const kind = String(item?.flags?.[SYSTEM_ID]?.alchemy?.kind ?? "").trim().toLowerCase();
  return ALCHEMY_PRODUCT_KINDS.has(kind) ? kind : "";
}

function _hasEnabledSpellSlot(slots) {
  if (!Array.isArray(slots)) return false;
  return slots.some((slot) =>
    slot?.enabled !== false
    && String(slot?.spellUuid ?? "").trim().length > 0
  );
}

function _hasCastEnchantmentSource(item) {
  if (!SPELLCASTING_ITEM_TYPES.has(String(item?.type ?? "").toLowerCase())) return false;
  const flags = item?.flags?.[SYSTEM_ID] ?? {};

  const ext = flags?.itemSpellcasting ?? {};
  if (ext?.enabled === true && _hasEnabledSpellSlot(ext?.slots)) return true;

  const enchanting = flags?.enchanting ?? {};
  if (
    enchanting?.version === 2
    && String(enchanting?.enchantType ?? "").trim().toLowerCase() === "cast"
    && _hasEnabledSpellSlot(enchanting?.cast?.spells)
  ) return true;

  return false;
}

function _isUsableItem(sheet, item) {
  if (!item?.actor || item.actor.id !== sheet?.document?.id) return false;
  if (!sheet?.document?.isOwner) return false;
  if (FEATURE_TYPES.has(item.type)) return true;
  if (item?.system?.activation?.enabled === true) return true;
  if (_hasLinkedScrollSpell(item)) return true;
  if (_getAlchemyKind(item)) return true;
  return _hasCastEnchantmentSource(item);
}

async function _useContextItem(sheet, target) {
  const item = _resolveContextItem(sheet, target);
  if (!_isUsableItem(sheet, item)) return;

  const actor = item.actor;
  const row = _resolveContextRow(target) ?? target;
  const fakeEvent = _buildSyntheticEvent(row);

  if (FEATURE_TYPES.has(item.type) || item?.system?.activation?.enabled === true) {
    await executeItemActivation({ item, actor, includeImage: _includeImage(sheet), event: fakeEvent });
    return;
  }

  if (_hasLinkedScrollSpell(item)) {
    const result = await castScrollFromItem({
      scrollItem: item,
      casterActor: actor,
      castActionType: "primary",
    });
    if (result?.error) {
      ui.notifications?.warn?.(result.error);
      return;
    }
    if (result?.consumed === true && Number(result.newQty ?? 1) === 0) {
      ui.notifications?.info?.(`${item.name} has been used up.`);
    }
    return;
  }

  const alchemyKind = _getAlchemyKind(item);
  if (alchemyKind === "potion") {
    await drinkPotion(actor, item);
    return;
  }
  if (alchemyKind === "poison" || alchemyKind === "toxin") {
    const targetItem = await pickAlchemyCoatingTarget(actor);
    if (!targetItem) return;
    await applyAlchemyToTarget(actor, item, targetItem);
    return;
  }

  if (_hasCastEnchantmentSource(item)) {
    await onCastEnchantmentAction.call(sheet, fakeEvent, row, item);
  }
}

async function _openItemInfoDialog(item) {
  const description = String(item?.system?.description ?? "").trim();
  const content = description
    ? `<div class="uesrpg-item-quickmenu-info"><p><strong>${_escapeHtml(item.name)}</strong> (${_escapeHtml(item.type)})</p><div>${description}</div></div>`
    : `<div class="uesrpg-item-quickmenu-info"><p><strong>${_escapeHtml(item.name)}</strong> (${_escapeHtml(item.type)})</p><p>${_escapeHtml(t("UESRPG.UI.NoItemDescription", "No description is available for this item yet."))}</p></div>`;
  await alertDialog({
    title: t("UESRPG.UI.ItemInformation", "Item Information"),
    content,
    buttonLabel: t("UESRPG.UI.Close", "Close"),
    classes: ["uesrpg-item-quickmenu-info-dialog"],
  });
}

function _buildContextMenuEntries(sheet) {
  return [
    {
      label: t("UESRPG.UI.Open", "Open"),
      icon: "fas fa-up-right-from-square",
      group: "basic",
      visible: (target) => Boolean(_resolveContextItem(sheet, target)),
      onClick: async (_event, target) => {
        const item = _resolveContextItem(sheet, target);
        await item?.sheet?.render?.(true);
      },
    },
    {
      label: t("UESRPG.UI.Use", "Use"),
      icon: "fas fa-bolt",
      group: "basic",
      visible: (target) => _isUsableItem(sheet, _resolveContextItem(sheet, target)),
      onClick: async (_event, target) => {
        await _useContextItem(sheet, target);
      },
    },
    {
      label: t("UESRPG.UI.PostToChat", "Post to Chat"),
      icon: "fas fa-comment",
      group: "basic",
      visible: (target) => Boolean(_resolveContextItem(sheet, target)),
      onClick: async (_event, target) => {
        const item = _resolveContextItem(sheet, target);
        if (!item) return;
        const row = _resolveContextRow(target) ?? target;
        const fakeEvent = _buildSyntheticEvent(row);
        if (typeof sheet?._onPostItemToChat === "function") {
          await sheet._onPostItemToChat(fakeEvent, row);
          return;
        }
        await postItemToChat(fakeEvent, sheet?.document, { includeImage: _includeImage(sheet), element: row });
      },
    },
    {
      label: t("UESRPG.UI.WhatIsThis", "What is this?"),
      icon: "fas fa-circle-question",
      group: "basic",
      visible: (target) => Boolean(_resolveContextItem(sheet, target)),
      onClick: async (_event, target) => {
        const item = _resolveContextItem(sheet, target);
        if (item) await _openItemInfoDialog(item);
      },
    },
    {
      label: t("UESRPG.UI.Equip", "Equip"),
      icon: "fas fa-shield-halved",
      group: "state",
      visible: (target) => {
        const item = _resolveContextItem(sheet, target);
        return Boolean(item && item?.system?.equipped === false);
      },
      onClick: async (_event, target) => {
        const item = _resolveContextItem(sheet, target);
        if (!item || typeof sheet?._onItemEquip !== "function") return;
        const row = _resolveContextRow(target) ?? target;
        await sheet._onItemEquip(_buildSyntheticEvent(row), row);
      },
    },
    {
      label: t("UESRPG.UI.Unequip", "Unequip"),
      icon: "fas fa-shield-halved",
      group: "state",
      visible: (target) => {
        const item = _resolveContextItem(sheet, target);
        return Boolean(item && item?.system?.equipped === true);
      },
      onClick: async (_event, target) => {
        const item = _resolveContextItem(sheet, target);
        if (!item || typeof sheet?._onItemEquip !== "function") return;
        const row = _resolveContextRow(target) ?? target;
        await sheet._onItemEquip(_buildSyntheticEvent(row), row);
      },
    },
    {
      label: t("UESRPG.UI.Duplicate", "Duplicate"),
      icon: "fas fa-clone",
      group: "manage",
      visible: (target) => Boolean(_resolveContextItem(sheet, target) && _canMutate(sheet)),
      onClick: async (_event, target) => {
        const item = _resolveContextItem(sheet, target);
        if (!item) return;
        if (typeof sheet?._duplicateItem === "function") {
          await sheet._duplicateItem(item);
          return;
        }
        const created = await requestCreateEmbeddedDocuments(sheet.document, "Item", [item.toObject()]);
        await created?.[0]?.sheet?.render?.(true);
      },
    },
    {
      label: t("UESRPG.UI.Delete", "Delete"),
      icon: "fas fa-trash",
      classes: "uesrpg-item-quickmenu-delete",
      group: "manage",
      visible: (target) => Boolean(_resolveContextItem(sheet, target) && _canMutate(sheet)),
      onClick: async (_event, target) => {
        const item = _resolveContextItem(sheet, target);
        if (!item || typeof sheet?._onItemDelete !== "function") return;
        const row = _resolveContextRow(target) ?? target;
        await sheet._onItemDelete(_buildSyntheticEvent(row), row);
      },
    },
  ];
}

function _resolveContextMenuClass() {
  const BaseContextMenu = globalThis.foundry?.applications?.ux?.ContextMenu ?? globalThis.CONFIG?.ux?.ContextMenu;
  return class UesrpgItemRowContextMenu extends BaseContextMenu {
    async _animate(_open = false) {
      return undefined;
    }

    async _preRenderEntries(options = {}) {
      this.element?.classList?.add?.("uesrpg-item-quickmenu-context");
      return super._preRenderEntries(options);
    }

    _setPosition(html, target, options = {}) {
      html?.classList?.add?.("uesrpg-item-quickmenu-context");
      return super._setPosition(html, target, options);
    }

    async _onRender(options = {}) {
      this.element?.classList?.add?.("uesrpg-item-quickmenu-context");
      return super._onRender(options);
    }
  };
}

export function injectItemRowKebabButtons(rootEl, { enabled } = {}) {
  if (!(rootEl instanceof HTMLElement)) return;
  for (const existing of rootEl.querySelectorAll(BTN_SELECTOR)) existing.remove();
}

export function bindItemRowQuickMenus(sheet, rootEl) {
  if (!(rootEl instanceof HTMLElement)) return false;
  const enabled = _isQuickMenuEnabled();
  injectItemRowKebabButtons(rootEl, { enabled });
  if (!enabled) return false;
  if (rootEl.dataset?.[BOUND_ATTR] === "1") return true;

  const ContextMenuClass = _resolveContextMenuClass();
  new ContextMenuClass(rootEl, ROW_SELECTOR, _buildContextMenuEntries(sheet), {
    fixed: true,
    jQuery: false,
    relative: "cursor",
    onOpen: (target) => target?.classList?.add?.("uesrpg-item-quickmenu-context-target"),
    onClose: (target) => target?.classList?.remove?.("uesrpg-item-quickmenu-context-target"),
  });
  rootEl.dataset[BOUND_ATTR] = "1";
  return true;
}

export function openItemRowQuickMenu(_sheet, _item, { anchorEl, event } = {}) {
  const row = _resolveContextRow(anchorEl);
  if (!(row instanceof HTMLElement)) return false;
  const sourceEvent = event instanceof MouseEvent ? event : null;
  const rect = row.getBoundingClientRect();
  row.dispatchEvent(new PointerEvent("contextmenu", {
    view: window,
    bubbles: true,
    cancelable: true,
    clientX: Number.isFinite(sourceEvent?.clientX) && sourceEvent.clientX > 0 ? sourceEvent.clientX : rect.left,
    clientY: Number.isFinite(sourceEvent?.clientY) && sourceEvent.clientY > 0 ? sourceEvent.clientY : rect.bottom,
  }));
  return true;
}

export function handleItemRowContextMenu(sheet, event) {
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

  return true;
}
