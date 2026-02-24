/**
 * @file Character creation menus (Race, Birth Sign, XP)
 * Extracted from actor-sheet.js for better organization
 */

import { RaceMenuAppV2, BirthSignMenuAppV2 } from "../../../apps/v2/character-creation-menus.js";
import { SpendXpMenuAppV2 } from "../../../apps/v2/char-gen/spend-xp-menu.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { customDialog, alertDialog } from "../../../../utils/dialog-v2-helper.js";
import { appendChargenAudit } from "../../../apps/v2/char-gen/audit-log.js";

const RANK_THRESHOLDS = Object.freeze([
  { minXp: 7000, rank: "Master" },
  { minXp: 5500, rank: "Expert" },
  { minXp: 4000, rank: "Adept" },
  { minXp: 2500, rank: "Journeyman" },
  { minXp: 1000, rank: "Apprentice" },
  { minXp: 0, rank: "Novice" },
]);

export function campaignRankFromXpTotal(xpTotalRaw) {
  const xpTotal = Number(xpTotalRaw);
  const safeXpTotal = Number.isFinite(xpTotal) ? xpTotal : 0;
  for (const row of RANK_THRESHOLDS) {
    if (safeXpTotal >= row.minXp) return row.rank;
  }
  return "Novice";
}

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
        const xp = Number(root.querySelector("#xp").value);
        const xpTotal = Number(root.querySelector("#xpTotal").value);
        const rank = campaignRankFromXpTotal(xpTotal);

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

// ── Private helpers for the Advancement info panels ─────────────────────────

async function _showLuckyInfo(actor) {
  const lck = actor.system.characteristics.lck.total ?? 50;
  const luckBonus = Math.floor((lck - 50) / 10);
  const hasThief = actor.items.some(
    (i) => i.type === "trait" && (i.name === "The Thief" || i.name === "The Star-Cursed Thief"),
  );
  // Slots allocated by current Luck (for context label)
  const allocLucky = Math.max(0, luckBonus) + (hasThief ? 1 : 0);
  const allocUnlucky = Math.max(0, 5 - luckBonus);

  // Read all stored values regardless of current allocation
  const luckyNums = ["ln1", "ln2", "ln3", "ln4", "ln5", "ln6"]
    .map((k) => actor.system.lucky_numbers[k])
    .filter((n) => n > 0);
  const unluckyNums = ["ul1", "ul2", "ul3", "ul4", "ul5"]
    .map((k) => actor.system.unlucky_numbers[k])
    .filter((n) => n > 0);

  const luckyStr = luckyNums.length ? luckyNums.join(", ") : "None set";
  const unluckyStr = unluckyNums.length ? unluckyNums.join(", ") : "None set";
  const bonusLabel = `${luckBonus >= 0 ? "+" : ""}${luckBonus}`;
  const thiefNote = hasThief ? " + Thief birthsign (+1 lucky)" : "";

  await alertDialog({
    title: "Lucky & Unlucky Numbers",
    content: `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
      <div>
        <strong>Lucky Numbers</strong> (${allocLucky} slots): ${luckyStr}
      </div>
      <div>
        <strong>Unlucky Numbers</strong> (${allocUnlucky} slots): ${unluckyStr}
      </div>
      <div style="font-size:0.85em;color:var(--color-text-dark-secondary,#666);border-top:1px solid rgba(0,0,0,0.12);padding-top:6px;">
        Luck ${lck} &rarr; Luck Bonus ${bonusLabel}${thiefNote}
      </div>
    </div>`,
  });
}

async function _showRaceInfo(actor) {
  const race = actor.system.race || "None selected";
  await alertDialog({
    title: "Race",
    content: `<p style="margin:4px 0;">Current race: <strong>${race}</strong></p>`,
  });
}

async function _showSignInfo(actor) {
  const sign = actor.system.birthSign || "None selected";
  await alertDialog({
    title: "Birth Sign",
    content: `<p style="margin:4px 0;">Current sign: <strong>${sign}</strong></p>`,
  });
}

async function _showXpDialog(actor) {
  const xpTotal = Number(actor.system.xpTotal ?? 0);
  const xpAvail = Number(actor.system.xp ?? 0);
  const xpSpent = Math.max(0, xpTotal - xpAvail);
  const rank = campaignRankFromXpTotal(xpTotal);

  const choice = await customDialog({
    title: "Experience & Advancement",
    width: 380,
    content: `<div style="display:flex;flex-direction:column;gap:8px;padding:4px 0;">
      <div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px 12px;">
        <label for="adv-xp-total">Total XP Received</label>
        <input type="number" id="adv-xp-total" value="${xpTotal}" min="0" style="width:90px;text-align:right;">
        <label>XP Spent</label>
        <span id="adv-xp-spent" style="text-align:right;padding-right:4px;">${xpSpent}</span>
        <label for="adv-xp-avail">XP Available</label>
        <input type="number" id="adv-xp-avail" value="${xpAvail}" min="0" style="width:90px;text-align:right;">
        <label>Campaign Rank</label>
        <span id="adv-xp-rank" style="text-align:right;padding-right:4px;">${rank}</span>
      </div>
    </div>`,
    buttons: {
      wizard: {
        label: "Advancement Wizard",
        icon: "fas fa-scroll",
        callback: () => "wizard",
      },
      save: {
        label: "Save",
        icon: "fas fa-check",
        callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const newTotal = Number(root?.querySelector("#adv-xp-total")?.value ?? xpTotal);
          const newAvail = Number(root?.querySelector("#adv-xp-avail")?.value ?? xpAvail);
          const newRank = campaignRankFromXpTotal(newTotal);
          await requestUpdateDocument(actor, {
            "system.xpTotal": Number.isFinite(newTotal) ? newTotal : xpTotal,
            "system.xp": Number.isFinite(newAvail) ? newAvail : xpAvail,
            "system.campaignRank": newRank,
          });
          return "saved";
        },
      },
      cancel: { label: "Cancel" },
    },
    defaultButton: "save",
    rejectClose: false,
    render: (_evt, dialogApp) => {
      const root = dialogApp?.element ?? dialogApp;
      const totalInput = root?.querySelector("#adv-xp-total");
      const availInput = root?.querySelector("#adv-xp-avail");
      const spentSpan = root?.querySelector("#adv-xp-spent");
      const rankSpan = root?.querySelector("#adv-xp-rank");

      function _refresh() {
        const t = Number(totalInput?.value ?? 0);
        const a = Number(availInput?.value ?? 0);
        if (spentSpan) spentSpan.textContent = Math.max(0, t - a);
        if (rankSpan) rankSpan.textContent = campaignRankFromXpTotal(t);
      }

      totalInput?.addEventListener("input", _refresh);
      availInput?.addEventListener("input", _refresh);
    },
  });

  if (choice === "wizard") {
    await SpendXpMenuAppV2.prompt(actor);
  }
}

// ── Advancement picker ────────────────────────────────────────────────────────

/**
 * Show the Advancement menu — a picker dialog for Lucky/Unlucky, XP, Race, and Sign.
 * @param {Event} event - The triggering event
 */
export async function onAdvancementMenu(event, _target) {
  const actor = this.actor;
  let _choice = null;

  await customDialog({
    title: "Advancement",
    width: 320,
    classes: ["uesrpg-advancement-dialog"],
    content: `<div class="uesrpg-advancement-menu">
      <button type="button" class="adv-btn" data-choice="lucky">
        <i class="fas fa-dice"></i>
        <span>Lucky/Unlucky Numbers</span>
      </button>
      <button type="button" class="adv-btn" data-choice="xp">
        <i class="fas fa-star"></i>
        <span>Experience &mdash; ${actor.system.xp} XP available</span>
      </button>
      <button type="button" class="adv-btn" data-choice="race">
        <i class="fas fa-users"></i>
        <span>Race &mdash; ${actor.system.race || "None"}</span>
      </button>
      <button type="button" class="adv-btn" data-choice="sign">
        <i class="fas fa-moon"></i>
        <span>Sign &mdash; ${actor.system.birthSign || "None"}</span>
      </button>
    </div>`,
    no: { label: "Cancel" },
    rejectClose: false,
    render: (_evt, dialogApp) => {
      const root = dialogApp?.element ?? dialogApp;
      root?.querySelectorAll?.(".adv-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          _choice = btn.dataset.choice;
          if (typeof dialogApp?.close === "function") await dialogApp.close();
        });
      });
    },
  });

  if (_choice === "lucky") return _showLuckyInfo(actor);
  if (_choice === "xp") return _showXpDialog(actor);
  if (_choice === "race") return _showRaceInfo(actor);
  if (_choice === "sign") return _showSignInfo(actor);
}

/**
 * Show Starting Resources menu for RAW chargen.
 * @param {Event} event - The triggering event
 */
export async function onStartingResourcesMenu(event, target) {
  event.preventDefault();

  const currentWealth = Number(this.actor?.system?.wealth ?? 0);
  const currentXpTotal = Number(this.actor?.system?.xpTotal ?? 0);
  const currentXp = Number(this.actor?.system?.xp ?? currentXpTotal);

  await customDialog({
    title: "Starting Resources (Chargen)",
    content: `<div class="uesrpg-cg-dialog" style="display: flex; flex-direction: column; gap: 8px;">
      <p class="uesrpg-cg-dialog__note" style="margin: 0;">Set starting resources for RAW chargen. Campaign Rank is derived from Total XP.</p>
      <label style="display: flex; flex-direction: column; gap: 4px;">
        <span>Starting Drakes (wealth)</span>
        <input type="number" id="startingWealth" value="${currentWealth}" min="0">
      </label>
      <label style="display: flex; flex-direction: column; gap: 4px;">
        <span>Starting Total XP</span>
        <input type="number" id="startingXpTotal" value="${currentXpTotal}" min="0">
      </label>
      <label style="display: flex; flex-direction: column; gap: 4px;">
        <span>Starting Unspent XP</span>
        <input type="number" id="startingXp" value="${currentXp}" min="0">
      </label>
    </div>`,
    yes: {
      label: "Submit",
      callback: async (html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        const wealth = Number(root.querySelector("#startingWealth")?.value ?? 0);
        const xpTotal = Number(root.querySelector("#startingXpTotal")?.value ?? 0);
        const xp = Number(root.querySelector("#startingXp")?.value ?? xpTotal);
        const rank = campaignRankFromXpTotal(xpTotal);
        const timestamp = new Date().toISOString();

        await requestUpdateDocument(this.actor, {
          "system.wealth": Number.isFinite(wealth) ? wealth : 0,
          "system.xpTotal": Number.isFinite(xpTotal) ? xpTotal : 0,
          "system.xp": Number.isFinite(xp) ? xp : 0,
          "system.campaignRank": rank,
          "flags.uesrpg-3ev4.chargen.startingResources": {
            wealth: Number.isFinite(wealth) ? wealth : 0,
            xpTotal: Number.isFinite(xpTotal) ? xpTotal : 0,
            xp: Number.isFinite(xp) ? xp : 0,
            setAt: timestamp,
          },
        });
        await appendChargenAudit(this.actor, {
          step: "resources",
          action: "submit",
          payload: {
            wealth: Number.isFinite(wealth) ? wealth : 0,
            xpTotal: Number.isFinite(xpTotal) ? xpTotal : 0,
            xp: Number.isFinite(xp) ? xp : 0,
            campaignRank: rank,
          },
        });
      },
    },
    defaultButton: "yes",
  });
}
