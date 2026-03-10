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
import { drinkPotion, applyAlchemyToWeapon } from "../../../core/alchemy/runtime.js";
import { alertDialog, customDialog } from "../../../utils/dialog-v2-helper.js";
import { SYSTEM_ID } from "../../constants.js";

/**
 * Enable this generic item as an alchemy ingredient by writing the alchemy flags.
 * Sets default values for school, strengthBase, and depthBase.
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 */
export async function onEnableAlchemyIngredient(sheet, event) {
  event.preventDefault();
  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.alchemy`]: {
      kind: "ingredient",
      school: "destruction",
      strengthBase: 5,
      depthBase: 2,
    },
  });
}

/**
 * Remove alchemy ingredient status from this item by deleting the alchemy flags.
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 */
export async function onClearAlchemyIngredient(sheet, event) {
  event.preventDefault();
  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.-=alchemy`]: null,
  });
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
  const kind = String(target?.dataset?.kind ?? "potion");
  if (!(["potion", "poison", "toxin"].includes(kind))) {
    ui.notifications.warn("Unknown alchemy product type.");
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

  await requestUpdateDocument(sheet.document, {
    "system.consumable": true,
    "system.wearable": false,
    "system.equipped": false,
    [`flags.${SYSTEM_ID}.alchemy`]: { ...baseFlags, ...kindFlags },
  });
}

/**
 * Remove alchemy product flags from this item.
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 */
export async function onClearAlchemyProduct(sheet, event) {
  event.preventDefault();
  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.-=alchemy`]: null,
  });
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
    ui.notifications.warn("Only poisons and toxins can be applied to weapons.");
    return;
  }

  const weapons = actor.items.filter((i) => i.type === "weapon" && i.system?.equipped === true);
  if (!weapons.length) {
    await alertDialog({
      title: "Apply to Weapon",
      content: "<p>No equipped weapons were found on this actor.</p>",
    });
    return;
  }

  const options = weapons.map((w) => `<option value="${w.id}">${w.name}</option>`).join("");
  const content = `
    <div class="uesrpg-apply-alchemy-form">
      <div class="form-group">
        <label>Weapon</label>
        <select name="weaponId">${options}</select>
      </div>
    </div>
  `;

  const weaponId = await customDialog({
    title: "Apply to Weapon",
    content,
    yes: {
      label: "Apply",
      icon: "fas fa-check",
      callback: (html) => html?.querySelector?.("select[name='weaponId']")?.value,
    },
    no: { label: "Cancel", icon: "fas fa-times" },
    defaultButton: "yes",
  });

  if (!weaponId || typeof weaponId !== "string") return;

  const weapon = actor.items.get(weaponId);
  if (!weapon) {
    ui.notifications.warn("Selected weapon could not be found.");
    return;
  }

  await applyAlchemyToWeapon(actor, sheet.document, weapon);
}
