/**
 * Inventory and equipment management handlers.
 * Handles quantity adjustments, equipment toggling, and item creation.
 *
 * Shared across actor sheet modules.
 */

import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
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

  await requestUpdateDocument(item, { "system.weapon2H": !item.system.weapon2H });
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
  await requestUpdateDocument(item, { "system.quantity": currentQty + 1 });
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

  await requestUpdateDocument(item, { "system.quantity": newQty });
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

  const current = Boolean(item?.system?.equipped);
  await requestUpdateDocument(item, { "system.equipped": !current });
});
