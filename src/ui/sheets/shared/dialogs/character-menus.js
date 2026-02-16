/**
 * @file Character creation menus (Race, Birth Sign, XP)
 * Extracted from actor-sheet.js for better organization
 */

import { RaceMenuAppV2, BirthSignMenuAppV2 } from "../../../apps/v2/character-creation-menus.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";

/**
 * Show race selection menu.
 * @param {Event} event - The triggering event
 */
export async function onRaceMenu(event, target) {
  event.preventDefault();
  await RaceMenuAppV2.prompt(this.actor);
}

/**
 * Show birth sign selection menu.
 * @param {Event} event - The triggering event
 */
export async function onBirthSignMenu(event, target) {
  event.preventDefault();
  await BirthSignMenuAppV2.prompt(this.actor);
}

/**
 * Show XP management menu.
 * @param {Event} event - The triggering event
 */
export async function onXPMenu(event, target) {
  event.preventDefault();

  // Rank Objects
  const ranks = {
    apprentice: { name: "Apprentice", xp: 1000 },
    journeyman: { name: "Journeyman", xp: 2500 },
    adept: { name: "Adept", xp: 4000 },
    expert: { name: "Expert", xp: 5500 },
    master: { name: "Master", xp: 7000 },
  };

  const rankRows = [];
  for (const rank in ranks) {
    const rankObject = ranks[rank];
    const row = `<tr>
                    <td>${rankObject.name}</td>
                    <td>${rankObject.xp}</td>
                </tr>`;
    rankRows.push(row);
  }

  await customDialog({
    title: "Experience Menu",
    content: `<div>
                  <div style="display: flex; flex-direction: column;">
                      <div style="padding: 10px;">
                          <div style="display: flex; flex-direction: row; justify-content: space-around; background: rgba(180, 180, 180, 0.562); padding: 10px; text-align: center; border: 1px solid;">
                              <div style="width: 33.33%">
                                  <div>Current XP</div>
                                  <input type="number" id="xp" value="${this.actor.system.xp}">
                              </div>
                              <div style="width: 33.33%">
                                  <div>Total XP</div>
                                  <input type="number" id="xpTotal" value="${this.actor.system.xpTotal}">
                              </div>
                              <div style="width: 33.33%">
                                  <div>Campaign Rank</div>
                                  <div style="padding: 5px 0;">${this.actor.system.campaignRank}</div>
                              </div>
                          </div>
                      </div>

                      <div style="display: flex; flex-direction: row; justify-content: space-around; align-items: center;">
                          <div style="width: 50%">
                              <p>Depending on how much total XP your character has, they may only purchase Ranks appropriate to their Campaign Skill Experience.</p>
                              <p>Increase your total XP to select higher Skill Ranks.</p>
                          </div>
                          <div>
                              <table style="text-align: center;">
                                  <tr>
                                      <th>Skill Rank</th>
                                      <th>Total XP</th>
                                  </tr>
                                  ${rankRows.join("")}
                              </table>
                          </div>
                      </div>
                  </div>
              </div>`,
    yes: {
      label: "Submit",
      callback: async (html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        const xp = root.querySelector("#xp").value;
        const xpTotal = root.querySelector("#xpTotal").value;

        let rank;
        if (xpTotal < 1000) rank = "Novice";
        else if (xpTotal < 2500) rank = "Apprentice";
        else if (xpTotal < 4000) rank = "Journeyman";
        else if (xpTotal < 5500) rank = "Adept";
        else if (xpTotal < 7000) rank = "Expert";
        else rank = "Master";

        await requestUpdateDocument(this.actor, {
          "system.xp": xp,
          "system.xpTotal": xpTotal,
          "system.campaignRank": rank,
        });
      },
    },
    defaultButton: "yes",
  });
}
