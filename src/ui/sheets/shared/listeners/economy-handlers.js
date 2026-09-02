/**
 * Economy and wealth management handlers.
 *
 * Shared across actor sheet modules.
 */

import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";

/**
 * Open wealth calculator dialog.
 * @param {object} sheet
 * @param {Event} event
 */
export const onWealthCalc = asyncGuardSheet(async function onWealthCalc(event, target) {
  event.preventDefault();

  await customDialog({
    layout: "workflow",
    title: "Add/Subtract Wealth",
    content: `<div>
              <div class="dialogForm">
                <div style="display: flex; flex-direction: row; justify-content: space-between; align-items: center;">
                  <label><i class="fas fa-coins"></i><b> Add/Subtract: </b></label>
                  <input placeholder="ex. -20, +10" id="playerInput" value="0" style=" text-align: center; width: 50%; border-style: groove; float: right;" type="text"></input></div>
                </div>
              </div>`,
    buttons: {
      cancel: {
        label: "Cancel",
      },
      submit: {
        label: "Submit",
        icon: "fas fa-check",
        callback: async (html) => {
          const el = html instanceof HTMLElement ? html : html?.[0];
          const playerInput = parseInt(el?.querySelector('[id="playerInput"]')?.value) || 0;
          const wealth = Number(this.actor?.system?.wealth ?? 0);
          await requestUpdateDocument(this.actor, { "system.wealth": wealth + playerInput });
        },
      },
    },
    default: "submit",
  });
});
