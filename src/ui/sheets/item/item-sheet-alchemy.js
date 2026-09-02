/**
 * src/ui/sheets/item/item-sheet-alchemy.js
 *
 * Alchemy handler functions for SimpleItemSheetV2.
 * Handles ingredient enablement, product enablement/clearing, drinking potions,
 * and applying poisons/toxins to weapons.
 *
 * Each function receives the sheet instance as its first argument so it can
 * access sheet.document and sheet.actor without being a class method.
 */

import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { drinkPotion, applyAlchemyToTarget, pickAlchemyCoatingTarget } from "../../../core/alchemy/runtime.js";
import { alertDialog, customDialog } from "../../../utils/dialog-v2-helper.js";
import { SYSTEM_ID } from "../../constants.js";

async function _showAlchemyUpdateFailure(sheet, actionLabel) {
  const packId = String(sheet?.document?.pack ?? "").trim();
  const pack = packId ? game.packs?.get?.(packId) ?? null : null;
  const locked = Boolean(pack?.locked);
  const content = packId
    ? `<p>Could not ${actionLabel} on this compendium item.</p><p>${locked ? "The compendium is locked." : "The compendium entry may be read-only or you may not have permission to edit it."}</p>`
    : `<p>Could not ${actionLabel} on this item.</p><p>The document update was rejected.</p>`;

  await alertDialog({
    title: "Alchemy Update Failed",
    content,
    buttonLabel: "OK",
  });
}

async function _updateAlchemyDocument(sheet, updateData, actionLabel) {
  const ok = await requestUpdateDocument(sheet.document, updateData);
  if (!ok) await _showAlchemyUpdateFailure(sheet, actionLabel);
  return ok;
}

async function _prepareSheetForDestructiveAlchemyAction(sheet) {
  const quantity = Number(sheet?.document?.system?.quantity ?? 1);
  if (quantity > 1) return;
  sheet._skipSubmitOnCloseOnce = true;
  await sheet.close({ uesrpgSkipSubmitOnClose: true });
}

/**
 * Enable this generic item as an alchemy ingredient by writing the alchemy flags.
 * Sets default values for school, strengthBase, and depthBase.
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 */
export async function onEnableAlchemyIngredient(sheet, event) {
  event.preventDefault();
  await _updateAlchemyDocument(sheet, {
    [`flags.${SYSTEM_ID}.alchemy`]: {
      kind: "ingredient",
      school: "destruction",
      strengthBase: 5,
      depthBase: 2,
    },
  }, "enable alchemy ingredient");
}

/**
 * Remove alchemy ingredient status from this item by deleting the alchemy flags.
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 */
export async function onClearAlchemyIngredient(sheet, event) {
  event.preventDefault();
  await _updateAlchemyDocument(sheet, {
    [`flags.${SYSTEM_ID}.-=alchemy`]: null,
  }, "remove alchemy ingredient");
}

/**
 * Enable this generic item as an alchemy product (potion / poison / toxin).
 * Writes minimal alchemy flags and marks the item as consumable.
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 * @param {HTMLElement} target
 */
export async function onEnableAlchemyProduct(sheet, event, target) {
  event.preventDefault();
  let kind = String(target?.dataset?.kind ?? "").trim().toLowerCase();
  if (!kind) {
    kind = String(await customDialog({
      layout: "workflow",
      title: "Enable Alchemy Product",
      content: "<p>Select which alchemical product this item should become.</p>",
      buttons: {
        potion: { label: "Potion", icon: "fas fa-flask", callback: () => "potion" },
        poison: { label: "Poison", icon: "fas fa-skull-crossbones", callback: () => "poison" },
        toxin: { label: "Toxin", icon: "fas fa-vial", callback: () => "toxin" },
        cancel: { label: "Cancel", icon: "fas fa-times" },
      },
      defaultButton: "potion",
    }) ?? "").trim().toLowerCase();
  }
  if (!(["potion", "poison", "toxin"].includes(kind))) {
    if (kind) ui.notifications.warn("Unknown alchemy product type.");
    return;
  }

  const baseFlags = {
    kind,
    backfired: false,
    brew: {
      alchemistActorUuid: sheet.actor?.uuid ?? null,
      alchemyRank: null,
      brewedAt: Date.now(),
    },
  };

  const kindFlags = kind === "poison"
    ? { poisonLevel: 1, damageFormula: "1d4" }
    : kind === "toxin"
    ? { effects: [], durationRounds: 10, maxHits: 3 }
    : { effects: [] };

  await _updateAlchemyDocument(sheet, {
    "system.consumable": true,
    "system.wearable": false,
    "system.equipped": false,
    [`flags.${SYSTEM_ID}.alchemy`]: { ...baseFlags, ...kindFlags },
  }, `enable ${kind} product`);
}

/**
 * Remove alchemy product flags from this item.
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 */
export async function onClearAlchemyProduct(sheet, event) {
  event.preventDefault();
  await _updateAlchemyDocument(sheet, {
    [`flags.${SYSTEM_ID}.-=alchemy`]: null,
  }, "remove alchemy product");
}

/**
 * Drink a potion directly from the item sheet (owned items only).
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 */
export async function onDrinkAlchemyProduct(sheet, event) {
  event.preventDefault();

  const actor = sheet.actor;
  if (!actor) {
    ui.notifications.warn("This item is not owned by an actor.");
    return;
  }

  const kind = sheet.document?.flags?.[SYSTEM_ID]?.alchemy?.kind;
  if (kind !== "potion") {
    ui.notifications.warn("Only potions can be drunk.");
    return;
  }

  await _prepareSheetForDestructiveAlchemyAction(sheet);
  await drinkPotion(actor, sheet.document);
}

/**
 * Apply a poison/toxin to an equipped weapon (owned items only).
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 */
export async function onApplyAlchemyProductToWeapon(sheet, event) {
  event.preventDefault();

  const actor = sheet.actor;
  if (!actor) {
    ui.notifications.warn("This item is not owned by an actor.");
    return;
  }

  const kind = String(sheet.document?.flags?.[SYSTEM_ID]?.alchemy?.kind ?? "");
  if (!(kind === "poison" || kind === "toxin")) {
    ui.notifications.warn("Only poisons and toxins can be applied to weapons or ammunition.");
    return;
  }

  const targetItem = await pickAlchemyCoatingTarget(actor);
  if (!targetItem) return;

  await _prepareSheetForDestructiveAlchemyAction(sheet);
  await applyAlchemyToTarget(actor, sheet.document, targetItem);
}
