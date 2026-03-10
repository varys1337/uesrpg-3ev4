/**
 * src/ui/sheets/item/listeners/usage.js
 * Charge handlers for item sheets
 */
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";

/**
 * Handler: Increase item charges
 *
 * @param {ItemSheet} sheet
 * @param {Event} event
 */
export async function onChargePlus(sheet, event) {
  event.preventDefault();
  const charge = sheet.document?.system?.charge;
  const itemName = sheet.document?.name ?? "Item";
  if (!charge) return;

  const chargeMax = Number(charge.max ?? 0);
  const currentCharge = Number(charge.value ?? 0);
  const reduction = Number(charge.reduction ?? 1);

  if (currentCharge >= chargeMax || currentCharge + reduction >= chargeMax) {
    ui.notifications.info(`${itemName} is fully charged.`);
    return requestUpdateDocument(sheet.document, { "system.charge.value": chargeMax });
  }
  return requestUpdateDocument(sheet.document, { "system.charge.value": currentCharge + reduction });
}

/**
 * Handler: Decrease item charges
 *
 * @param {ItemSheet} sheet
 * @param {Event} event
 */
export async function onChargeMinus(sheet, event) {
  event.preventDefault();
  const charge = sheet.document?.system?.charge;
  const itemName = sheet.document?.name ?? "Item";
  if (!charge) return;

  const currentCharge = Number(charge.value ?? 0);
  const reduction = Number(charge.reduction ?? 1);

  if (currentCharge <= 0 || currentCharge - reduction < 0) {
    return ui.notifications.warn(`${itemName} does not have enough charge.`);
  }
  return requestUpdateDocument(sheet.document, { "system.charge.value": currentCharge - reduction });
}
