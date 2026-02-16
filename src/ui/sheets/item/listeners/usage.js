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
  const chargeMax = sheet.document.system.charge.max;
  const currentCharge = sheet.document.system.charge.value;

  if (currentCharge >= chargeMax || currentCharge + sheet.item.system.charge.reduction >= chargeMax) {
    ui.notifications.info(`${sheet.item.name} is fully charged.`);
    return requestUpdateDocument(sheet.document, { "system.charge.value": chargeMax });
  }
  return requestUpdateDocument(sheet.document, { "system.charge.value": currentCharge + sheet.item.system.charge.reduction });
}

/**
 * Handler: Decrease item charges
 *
 * @param {ItemSheet} sheet
 * @param {Event} event
 */
export async function onChargeMinus(sheet, event) {
  event.preventDefault();
  const currentCharge = sheet.document.system.charge.value;

  if (currentCharge <= 0 || currentCharge - sheet.item.system.charge.reduction < 0) {
    return ui.notifications.info(`${sheet.item.name} does not have enough charge.`);
  }
  return requestUpdateDocument(sheet.document, { "system.charge.value": currentCharge - sheet.item.system.charge.reduction });
}
