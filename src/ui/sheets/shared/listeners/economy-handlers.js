/**
 * Economy and wealth management handlers.
 *
 * Shared across actor sheet modules.
 */

import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";
import { isHumanoidActorType } from "../../../../core/actors/types.js";

/**
 * Open wealth calculator dialog.
 * @param {object} sheet
 * @param {Event} event
 */
export const onWealthCalc = asyncGuardSheet(async function onWealthCalc(event, target) {
  event.preventDefault();
  const inventoryDialog = isHumanoidActorType(this.actor?.type);

  await customDialog({
    layout: "workflow",
    title: "Add/Subtract Wealth",
    classes: inventoryDialog ? ["uesrpg-inventory-dialog"] : [],
    content: inventoryDialog ? `<div class="dialogForm uesrpg-inventory-dialog-body">
                <label class="uesrpg-inventory-dialog-field">
                  <span><i class="fas fa-coins" aria-hidden="true"></i> <b>Add/Subtract:</b></span>
                  <input placeholder="ex. -20, +10" id="playerInput" name="wealthAdjustment" value="0" type="text" inputmode="numeric">
                </label>
              </div>` : `<div>
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
