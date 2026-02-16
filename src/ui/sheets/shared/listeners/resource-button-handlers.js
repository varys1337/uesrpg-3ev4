/**
 * Resource button dialog handlers (HP, Stamina, Magicka).
 *
 * Consolidated from three separate integration modules into a single
 * jQuery-free registration function using native DOM queries.
 *
 * Each handler opens the appropriate resource management dialog when the
 * corresponding resource bar button is clicked.
 */

import { HPTempHPDialog } from "../../../apps/hp-temp-hp-dialog.js";
import { openStaminaDialog } from "../../../../core/stamina/stamina-dialog.js";
import { MagickaBarrierDialog } from "../../../apps/magicka-barrier-dialog.js";

/**
 * Resource button configuration.
 * Maps `data-resource` attribute values to dialog open functions.
 * @type {Record<string, (actor: Actor) => Promise<void>>}
 */
const RESOURCE_DIALOGS = {
  hp:      (actor) => HPTempHPDialog.show(actor),
  stamina: (actor) => openStaminaDialog(actor),
  magicka: (actor) => MagickaBarrierDialog.show(actor),
};

/**
 * Register resource button click handlers on a sheet element.
 *
 * Replaces the previous three separate jQuery-based modules
 * (actor-sheet-hp-integration, actor-sheet-stamina-integration,
 *  actor-sheet-magicka-integration).
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
