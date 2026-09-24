/**
 * src/ui/sheets/item/listeners/usage.js
 * Charge handlers for item sheets
 */
import {
  resolveEnchantmentChargeState,
  updateEnchantmentCharge,
} from "../../../../core/enchanting/charge-pool.js";

/**
 * Handler: Increase item charges
 *
 * @param {ItemSheet} sheet
 * @param {Event} event
 */
export async function onChargePlus(sheet, event) {
  event.preventDefault();
  const charge = resolveEnchantmentChargeState(sheet.document);
  const itemName = sheet.document?.name ?? "Item";
  if (!charge) return;

  const chargeMax = Number(charge.max ?? 0);
  const currentCharge = Number(charge.value ?? 0);
  const reduction = Math.max(1, Number(sheet.document?.system?.charge?.reduction ?? 1) || 1);

  if (currentCharge >= chargeMax || currentCharge + reduction >= chargeMax) {
    ui.notifications.info(`${itemName} is fully charged.`);
    return updateEnchantmentCharge(sheet.document, { value: chargeMax });
  }
  return updateEnchantmentCharge(sheet.document, { value: currentCharge + reduction });
}

/**
 * Handler: Decrease item charges
 *
 * @param {ItemSheet} sheet
 * @param {Event} event
 */
export async function onChargeMinus(sheet, event) {
  event.preventDefault();
  const charge = resolveEnchantmentChargeState(sheet.document);
  const itemName = sheet.document?.name ?? "Item";
  if (!charge) return;

  const currentCharge = Number(charge.value ?? 0);
  const reduction = Math.max(1, Number(sheet.document?.system?.charge?.reduction ?? 1) || 1);

  if (currentCharge <= 0 || currentCharge - reduction < 0) {
    return ui.notifications.warn(`${itemName} does not have enough charge.`);
  }
  return updateEnchantmentCharge(sheet.document, { value: currentCharge - reduction });
}
