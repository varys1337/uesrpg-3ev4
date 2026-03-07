/**
 * src/ui/sheets/item/listeners/usage.js
 * Charge handlers for item sheets
 */
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";

/**
 * Legacy sheet-listener registrar kept for compatibility with index.js.
 * AppV2 sheet classes route charge actions via data-action handlers.
 */
export function registerUsageListeners(_sheet, _html) {
  // no-op by design
}

/**
 * Handler: Increase item charges
 *
 * @param {ItemSheet} sheet
 * @param {Event} event
 */
export async function onChargePlus(sheet, event) {
  event.preventDefault();
  const charge = sheet.document?.system?.charge;
  if (!charge) return;

  const chargeMax = Number(charge.max ?? 0);
  const currentCharge = Number(charge.value ?? 0);
  const reduction = Number(charge.reduction ?? 1);

  if (currentCharge >= chargeMax || currentCharge + reduction >= chargeMax) {
    ui.notifications.info(`${sheet.item.name} is fully charged.`);
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
  if (!charge) return;

  const currentCharge = Number(charge.value ?? 0);
  const reduction = Number(charge.reduction ?? 1);

  if (currentCharge <= 0 || currentCharge - reduction < 0) {
    return ui.notifications.warn(`${sheet.item.name} does not have enough charge.`);
  }
  return requestUpdateDocument(sheet.document, { "system.charge.value": currentCharge - reduction });
}
