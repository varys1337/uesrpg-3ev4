/**
 * Inventory and equipment management handlers.
 * Handles quantity adjustments, equipment toggling, and item creation.
 *
 * Target: Foundry VTT v13 (AppV1 ActorSheet).
 */

import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";

/**
 * Handle 2H weapon toggle.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onToggle2H(sheet, event) {
  event.preventDefault();
  const li = $(event.currentTarget).parents(".item");
  const item = sheet.actor.getEmbeddedDocument("Item", li.data("itemId"));
  if (!item) return;

  await requestUpdateDocument(item, { "system.weapon2H": !item.system.weapon2H });
}

/**
 * Increment item quantity.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onPlusQty(sheet, event) {
  event.preventDefault();
  const li = $(event.currentTarget).parents(".item");
  const item = sheet.actor.getEmbeddedDocument("Item", li.data("itemId"));
  if (!item) return;

  const currentQty = Number(item.system.quantity ?? 0);
  await requestUpdateDocument(item, { "system.quantity": currentQty + 1 });
}

/**
 * Decrement item quantity.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onMinusQty(sheet, event) {
  event.preventDefault();
  const li = $(event.currentTarget).parents(".item");
  const item = sheet.actor.getEmbeddedDocument("Item", li.data("itemId"));
  if (!item) return;

  const currentQty = Number(item.system.quantity ?? 0);
  const newQty = Math.max(currentQty - 1, 0);

  if (newQty === 0 && currentQty > 0) {
    ui.notifications.info(`You have used your last ${item.name}!`);
  }

  await requestUpdateDocument(item, { "system.quantity": newQty });
}

/**
 * Toggle item equipped status.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onItemEquip(sheet, event) {
  event.preventDefault();
  const toggle = $(event.currentTarget);
  const li = toggle.closest(".item");
  const itemId = li?.data("itemId");
  if (!itemId) return;

  const item = sheet.actor.getEmbeddedDocument("Item", itemId);
  if (!item) return;

  const current = Boolean(item?.system?.equipped);
  await requestUpdateDocument(item, { "system.equipped": !current });
}
