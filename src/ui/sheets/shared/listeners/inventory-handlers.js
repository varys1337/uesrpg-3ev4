/**
 * Inventory and equipment management handlers.
 * Handles quantity adjustments, equipment toggling, and item creation.
 *
 * Shared across actor sheet modules.
 */

import { requestUpdateEmbeddedDocuments } from "../../../../utils/authority-proxy.js";
import { setOwnedItemEquipped, setOwnedItemQuantityOrDelete, updateOwnedItem } from "../../../../core/items/owned-item-quantity.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";

/**
 * Handle 2H weapon toggle.
 * @param {object} sheet
 * @param {Event} event
 */
export const onToggle2H = asyncGuardSheet(async function onToggle2H(event, target) {
  event.preventDefault();
  const li = (target ?? event.currentTarget).closest(".item");
  const item = this.actor.getEmbeddedDocument("Item", li?.dataset?.itemId);
  if (!item) return;

  await updateOwnedItem({ item, updates: { "system.weapon2H": !item.system.weapon2H } });
});

/**
 * Increment item quantity.
 * @param {object} sheet
 * @param {Event} event
 */
export const onPlusQty = asyncGuardSheet(async function onPlusQty(event, target) {
  event.preventDefault();
  const li = (target ?? event.currentTarget).closest(".item");
  const item = this.actor.getEmbeddedDocument("Item", li?.dataset?.itemId);
  if (!item) return;

  const currentQty = Number(item.system.quantity ?? 0);
  await updateOwnedItem({ item, updates: { "system.quantity": currentQty + 1 } });
});

/**
 * Decrement item quantity.
 * @param {object} sheet
 * @param {Event} event
 */
export const onMinusQty = asyncGuardSheet(async function onMinusQty(event, target) {
  event.preventDefault();
  const li = (target ?? event.currentTarget).closest(".item");
  const item = this.actor.getEmbeddedDocument("Item", li?.dataset?.itemId);
  if (!item) return;

  const currentQty = Number(item.system.quantity ?? 0);
  const newQty = Math.max(currentQty - 1, 0);

  if (newQty === 0 && currentQty > 0) {
    ui.notifications.info(`You have used your last ${item.name}!`);
  }

  if (item.type === "ammunition") {
    await setOwnedItemQuantityOrDelete({ item, quantity: newQty });
    return;
  }

  await setOwnedItemQuantityOrDelete({ item, quantity: newQty });
});

/**
 * Toggle item equipped status.
 * @param {object} sheet
 * @param {Event} event
 */
export const onItemEquip = asyncGuardSheet(async function onItemEquip(event, target) {
  event.preventDefault();
  const li = (target ?? event.currentTarget).closest(".item");
  const itemId = li?.dataset?.itemId;
  if (!itemId) return;

  const item = this.actor.getEmbeddedDocument("Item", itemId);
  if (!item) return;

  const checked = target instanceof HTMLInputElement ? Boolean(target.checked) : null;
  await setOwnedItemEquipped({ item, equipped: checked });
});

export const onWeaponAmmoSelect = asyncGuardSheet(async function onWeaponAmmoSelect(event, target) {
  const li = (target ?? event.currentTarget).closest(".item");
  const item = this.actor.getEmbeddedDocument("Item", li?.dataset?.itemId);
  if (!item || item.type !== "weapon") return;

  const ammoId = String(target?.value ?? "").trim();
  const currentAmmoId = String(item.system?.ammoId ?? "").trim();
  if (ammoId === currentAmmoId) return true;

  return requestUpdateEmbeddedDocuments(this.actor, "Item", [{
    _id: item.id,
    "system.ammoId": ammoId,
  }]);
});
