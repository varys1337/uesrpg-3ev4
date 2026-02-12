/**
 * Magicka button handler integration for actor sheet.
 * Overrides the default Magicka button to open the Magicka / Barrier management dialog.
 */

import { MagickaBarrierDialog } from "../apps/magicka-barrier-dialog.js";

/**
 * Register Magicka button handler to intercept clicks on the Magicka button
 * @param {ActorSheet} sheet - The actor sheet instance
 * @param {jQuery} html - The rendered HTML element
 */
export function registerMagickaButtonHandler(sheet, html) {
  if (!sheet?.actor) return;

  // Find the Magicka button (the "Magicka" label button)
  const magickaButton = html.find('button[data-resource="magicka"]');

  if (magickaButton.length === 0) return;

  // Remove existing click handlers and add new one
  magickaButton.off('click');
  magickaButton.on('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await MagickaBarrierDialog.show(sheet.actor);
  });
}
