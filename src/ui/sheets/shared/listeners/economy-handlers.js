/**
 * Economy and wealth management handlers.
 * Handles wealth addition/subtraction and carry rating bonuses.
 *
 * Target: Foundry VTT v13 (AppV1 ActorSheet).
 */

import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";

/**
 * Open wealth calculator dialog.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onWealthCalc(sheet, event) {
  event.preventDefault();

  const d = new Dialog({
    title: "Add/Subtract Wealth",
    content: `<form>
              <div class="dialogForm">
                <div style="display: flex; flex-direction: row; justify-content: space-between; align-items: center;">
                  <label><i class="fas fa-coins"></i><b> Add/Subtract: </b></label>
                  <input placeholder="ex. -20, +10" id="playerInput" value="0" style=" text-align: center; width: 50%; border-style: groove; float: right;" type="text"></input></div>
                </div>
              </form>`,
    buttons: {
      one: {
        label: "Cancel",
        callback: () => {},
      },
      two: {
        label: "Submit",
        callback: async (html) => {
          const playerInput = parseInt(html.find('[id="playerInput"]').val()) || 0;
          const wealth = Number(sheet.actor?.system?.wealth ?? 0);
          await requestUpdateDocument(sheet.actor, { "system.wealth": wealth + playerInput });
        },
      },
    },
    default: "two",
    close: () => {},
  });
  d.render(true);
}

/**
 * Open carry rating bonus dialog.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onCarryBonus(sheet, event) {
  event.preventDefault();

  const d = new Dialog({
    title: "Carry Rating Bonus",
    content: `<form>
                <div class="dialogForm">
                  <div style="margin: 5px; display: flex; flex-direction: row; justify-content: space-between; align-items: center;">
                    <label><b>Current Carry Rating Bonus: </b></label>
                    <label style=" text-align: center; float: right; width: 50%;">${sheet.actor.system.carry_rating.bonus}</label>
                  </div>

                  <div style="margin: 5px; display: flex; flex-direction: row; justify-content: space-between; align-items: center;">
                    <label><b> Set Carry Weight Bonus:</b></label>
                    <input placeholder="10, -10, etc." id="playerInput" value="0" style=" text-align: center; width: 50%; border-style: groove; float: right;" type="text"></input></div>
                  </div>

              </form>`,
    buttons: {
      one: {
        label: "Cancel",
        callback: () => {},
      },
      two: {
        label: "Submit",
        callback: async (html) => {
          const playerInput = parseInt(html.find('[id="playerInput"]').val()) || 0;
          await requestUpdateDocument(sheet.actor, { "system.carry_rating.bonus": playerInput });
        },
      },
    },
    default: "two",
    close: () => {},
  });
  d.render(true);
}
