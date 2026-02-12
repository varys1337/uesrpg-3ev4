/**
 * src/ui/sheets/actor/listeners/magic-cast.js
 *
 * Actor-sheet magic casting listener shim.
 * Delegates to the shared magic-cast implementation.
 *
 * Target: Foundry VTT v13.351
 */

import { onCastMagicAction } from "../../shared/listeners/magic-cast.js";

/**
 * Register magic casting listeners on an actor sheet.
 *
 * @param {ActorSheet} sheet - The actor sheet instance
 * @param {jQuery} html - The rendered sheet HTML
 */
export function registerMagicCastListeners(sheet, html) {
  html.find(".magic-roll").off("click.uesrpg").on("click.uesrpg", (event) => {
    onCastMagicAction(sheet, event);
  });
  html.find(".uesrpg-cast-magic").off("click.uesrpg").on("click.uesrpg", (event) => {
    onCastMagicAction(sheet, event);
  });
}
