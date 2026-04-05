/**
 * Resource button dialog handlers (HP, Stamina, Magicka).
 *
 * jQuery-free registration using native DOM queries.
 * Each handler opens the appropriate resource management dialog when the
 * corresponding resource bar button is clicked.
 */

import { HPTempHPDialog } from "../../../apps/hp-temp-hp-dialog.js";
import { openStaminaDialog } from "../../../../core/stamina/stamina-dialog.js";
import { MagickaBarrierDialog } from "../../../apps/magicka-barrier-dialog.js";
import { BurnLuckDialog } from "../../../apps/burn-luck-dialog.js";
import { PietyPointsDialog } from "../../../apps/piety-points-dialog.js";

/**
 * Resource button configuration.
 * Maps `data-resource` attribute values to dialog open functions.
 * @type {Record<string, (actor: Actor) => Promise<void>>}
 */
const RESOURCE_DIALOGS = {
  hp:      (actor) => HPTempHPDialog.show(actor),
  stamina: (actor) => openStaminaDialog(actor),
  magicka: (actor) => MagickaBarrierDialog.show(actor),
  worship: (actor) => PietyPointsDialog.show(actor),
  luck_points: (actor) => BurnLuckDialog.show(actor),
};

/**
 * Register resource button click handlers on a sheet element.
 *
 * @param {ActorSheet} sheet - The actor sheet instance
 * @param {HTMLElement} el - The rendered sheet DOM element
 */
export function registerResourceButtonHandlers(sheet, el) {
  if (!sheet?.actor) return;

  for (const [resource, openDialog] of Object.entries(RESOURCE_DIALOGS)) {
    const button = el.querySelector(`button[data-resource="${resource}"]`);
    if (!button) continue;

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await openDialog(sheet.actor);
    });
  }
}
