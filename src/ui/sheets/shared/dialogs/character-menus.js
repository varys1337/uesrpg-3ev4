/**
 * @file Character creation menus (Race, Birth Sign, XP)
 * Extracted from actor-sheet.js for better organization
 */

import { RaceMenuAppV2, BirthSignMenuAppV2 } from "../../../apps/v2/character-creation-menus.js";
import { SpendXpMenuAppV2 } from "../../../apps/v2/char-gen/spend-xp-menu.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { customDialog, alertDialog } from "../../../../utils/dialog-v2-helper.js";
import { appendChargenAudit } from "../../../apps/v2/char-gen/audit-log.js";
import coreRaces from "../../racemenu/data/core-races.js";
import coreVariants from "../../racemenu/data/core-variants.js";
import khajiitFurstocks from "../../racemenu/data/khajiit-furstocks.js";
import expandedRaces from "../../racemenu/data/expanded-races.js";
import {
  resolveLuckBonus,
  resolveLuckyUnluckyAllocation,
  extractConfiguredLuckyNumbers,
  extractConfiguredUnluckyNumbers,
  hasThiefBirthsign,
} from "../../../../core/luck/lucky-numbers.js";
import { readActorBirthsignLabel } from "../../../../core/traits/starsigns/index.js";
import { t, tf } from "../../../../utils/i18n.js";

const RANK_THRESHOLDS = Object.freeze([
  { minXp: 7000, rank: "Master" },
  { minXp: 5500, rank: "Expert" },
  { minXp: 4000, rank: "Adept" },
  { minXp: 2500, rank: "Journeyman" },
  { minXp: 1000, rank: "Apprentice" },
  { minXp: 0, rank: "Novice" },
]);

const RACE_DATASETS = Object.freeze({
  ...coreRaces,
  ...coreVariants,
  ...khajiitFurstocks,
  ...expandedRaces,
});

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
  const isGM = Boolean(game.user?.isGM);

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
    layout: "workflow",
    title: t("UESRPG.Dialogs.CharGen.ExperienceMenuTitle"),
    classes: ["uesrpg-chargen-dialog"],
    content: `<div class="uesrpg-cg-dialog uesrpg-cg-stack">
      <div class="uesrpg-cg-stat-grid">
        <div class="uesrpg-cg-stat">
          <span class="uesrpg-cg-stat__label">${t("UESRPG.Dialogs.CharGen.CurrentXp")}</span>
          ${isGM
      ? `<input type="number" id="xp" value="${this.actor.system.xp}">`
      : `<span class="uesrpg-cg-stat__value">${this.actor.system.xp}</span>`}
        </div>
        <div class="uesrpg-cg-stat">
          <span class="uesrpg-cg-stat__label">${t("UESRPG.Dialogs.CharGen.TotalXp")}</span>
          ${isGM
      ? `<input type="number" id="xpTotal" value="${this.actor.system.xpTotal}">`
      : `<span class="uesrpg-cg-stat__value">${this.actor.system.xpTotal}</span>`}
        </div>
        <div class="uesrpg-cg-stat">
          <span class="uesrpg-cg-stat__label">${t("UESRPG.Dialogs.CharGen.CampaignRank")}</span>
          <span class="uesrpg-cg-stat__value">${this.actor.system.campaignRank}</span>
        </div>
      </div>
      <div class="uesrpg-cg-info-grid">
        <div class="uesrpg-cg-rules">
          <p>${t("UESRPG.Dialogs.CharGen.ExperienceMenuBody1")}</p>
          <p>${t("UESRPG.Dialogs.CharGen.ExperienceMenuBody2")}</p>
        </div>
        <table class="uesrpg-dialog-table uesrpg-cg-rank-table">
          <thead>
            <tr>
              <th>${t("UESRPG.Dialogs.CharGen.SkillRank")}</th>
              <th>${t("UESRPG.Dialogs.CharGen.TotalXp")}</th>
            </tr>
          </thead>
          <tbody>${rankRows.join("")}</tbody>
        </table>
      </div>
    </div>`,
    yes: {
      label: isGM ? t("UESRPG.UI.Submit") : t("UESRPG.UI.Close"),
      callback: async (html) => {
        if (!isGM) return;
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
  const luckBonus = resolveLuckBonus(actor, { clampNonNegative: false });
  const { luckyCount: allocLucky, unluckyCount: allocUnlucky } = resolveLuckyUnluckyAllocation(actor, { clampNonNegativeBonus: true });
  const hasThief = hasThiefBirthsign(actor);
  const luckyNums = extractConfiguredLuckyNumbers(actor);
  const unluckyNums = extractConfiguredUnluckyNumbers(actor);

  const luckyStr = luckyNums.length ? luckyNums.join(", ") : t("UESRPG.UI.NoneSet");
  const unluckyStr = unluckyNums.length ? unluckyNums.join(", ") : t("UESRPG.UI.NoneSet");
  const bonusLabel = `${luckBonus >= 0 ? "+" : ""}${luckBonus}`;
  const thiefNote = hasThief ? t("UESRPG.Dialogs.CharGen.ThiefBirthsignBonus") : "";

  await alertDialog({
    title: t("UESRPG.Dialogs.CharGen.LuckyNumbersTitle"),
    classes: ["uesrpg-chargen-dialog"],
    content: `<div class="uesrpg-cg-dialog uesrpg-cg-stack uesrpg-cg-summary">
      <div class="uesrpg-cg-summary__row">
        <strong>${t("UESRPG.Dialogs.CharGen.LuckyNumbers")}</strong> (${allocLucky} ${t("UESRPG.Dialogs.CharGen.Slots")}): ${luckyStr}
      </div>
      <div class="uesrpg-cg-summary__row">
        <strong>${t("UESRPG.Dialogs.CharGen.UnluckyNumbers")}</strong> (${allocUnlucky} ${t("UESRPG.Dialogs.CharGen.Slots")}): ${unluckyStr}
      </div>
      <div class="uesrpg-cg-rule-note">
        ${tf("UESRPG.Dialogs.CharGen.LuckBonusLine", { luck: lck, bonus: bonusLabel })}${thiefNote}
      </div>
    </div>`,
  });
}

async function _showRaceInfo(actor) {
  const race = actor.system.race || t("UESRPG.Dialogs.CharGen.NoneSelected");
  const raceData = RACE_DATASETS[race] ?? null;
  const traitRows = Array.isArray(raceData?.traits) && raceData.traits.length
    ? `<ul class="uesrpg-cg-list">${raceData.traits.map((trait) => `<li>${trait}</li>`).join("")}</ul>`
    : `<p class="uesrpg-cg-empty">${t("UESRPG.UI.NoneSet")}</p>`;
  await alertDialog({
    title: t("UESRPG.UI.Race"),
    classes: ["uesrpg-chargen-dialog"],
    content: `<div class="uesrpg-cg-dialog uesrpg-cg-stack">
      <p class="uesrpg-cg-intro">${tf("UESRPG.Dialogs.CharGen.CurrentRace", { race })}</p>
      <div class="uesrpg-cg-rules">
        <h3>${t("UESRPG.Dialogs.CharGen.Features")}</h3>
        ${traitRows}
      </div>
    </div>`,
  });
}

async function _showSignInfo(actor) {
  const sign = readActorBirthsignLabel(actor) || t("UESRPG.Dialogs.CharGen.NoneSelected");
  await alertDialog({
    title: t("UESRPG.Dialogs.CharGen.StageBirthsign"),
    classes: ["uesrpg-chargen-dialog"],
    content: `<p class="uesrpg-cg-intro">${tf("UESRPG.Dialogs.CharGen.CurrentSign", { sign })}</p>`,
  });
}

async function _showXpDialog(actor) {
  const xpTotal = Number(actor.system.xpTotal ?? 0);
  const xpAvail = Number(actor.system.xp ?? 0);
  const xpSpent = Math.max(0, xpTotal - xpAvail);
  const rank = campaignRankFromXpTotal(xpTotal);
  const isGM = Boolean(game.user?.isGM);

  const xpTotalField = isGM
    ? `<input type="number" id="adv-xp-total" value="${xpTotal}" min="0">`
    : `<span id="adv-xp-total" class="uesrpg-cg-field-value">${xpTotal}</span>`;
  const xpAvailField = isGM
    ? `<input type="number" id="adv-xp-avail" value="${xpAvail}" min="0">`
    : `<span id="adv-xp-avail" class="uesrpg-cg-field-value">${xpAvail}</span>`;

  const choice = await customDialog({
    layout: "workflow",
    title: t("UESRPG.Dialogs.CharGen.ExperienceAdvancementTitle"),
    width: 380,
    classes: ["uesrpg-chargen-dialog", "uesrpg-xp-advancement-dialog"],
    content: `<div class="uesrpg-cg-dialog uesrpg-cg-field-grid">
        <label for="adv-xp-total">${t("UESRPG.Dialogs.CharGen.TotalXpReceived")}</label>
        ${xpTotalField}
        <label>${t("UESRPG.Dialogs.CharGen.XpSpent")}</label>
        <span id="adv-xp-spent" class="uesrpg-cg-field-value">${xpSpent}</span>
        <label for="adv-xp-avail">${t("UESRPG.Dialogs.CharGen.XpAvailable")}</label>
        ${xpAvailField}
        <label>${t("UESRPG.Dialogs.CharGen.CampaignRank")}</label>
        <span id="adv-xp-rank" class="uesrpg-cg-field-value">${rank}</span>
    </div>`,
    buttons: isGM
      ? {
        wizard: {
          label: t("UESRPG.Dialogs.CharGen.AdvancementWizard"),
          icon: "fas fa-scroll",
          callback: () => "wizard",
        },
        save: {
          label: t("UESRPG.UI.Save"),
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
        cancel: { label: t("UESRPG.UI.Cancel") },
      }
      : {
        wizard: {
          label: t("UESRPG.Dialogs.CharGen.AdvancementWizard"),
          icon: "fas fa-scroll",
          callback: () => "wizard",
        },
        close: { label: t("UESRPG.UI.Close") },
      },
    defaultButton: isGM ? "save" : "close",
    rejectClose: false,
    render: (_evt, dialogApp) => {
      if (!isGM) return;
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
  event?.preventDefault?.();
  const actor = this.actor;
  let _choice = null;

  await customDialog({
    layout: "choices",
    title: t("UESRPG.Dialogs.CharGen.AdvancementTitle"),
    width: 390,
    classes: ["uesrpg-advancement-dialog", "uesrpg-chargen-dialog"],
    content: `<div class="uesrpg-advancement-menu">
      <button type="button" class="adv-btn" data-choice="lucky">
        <i class="fas fa-dice"></i>
        <span><strong>${t("UESRPG.Dialogs.CharGen.LuckyNumbersTitle")}</strong></span>
      </button>
      <button type="button" class="adv-btn" data-choice="xp">
        <i class="fas fa-star"></i>
        <span><strong>${t("UESRPG.Dialogs.CharGen.ExperienceAdvancementTitle")}</strong><small>${tf("UESRPG.Dialogs.CharGen.XpAvailableValue", { xp: actor.system.xp }, `${actor.system.xp} XP available`)}</small></span>
      </button>
      <button type="button" class="adv-btn adv-ref" data-choice="race">
        <i class="fas fa-users" aria-hidden="true"></i>
        <span><strong>${t("UESRPG.UI.Race")}</strong><small>${actor.system.race || t("UESRPG.UI.None")}</small></span>
      </button>
      <button type="button" class="adv-btn adv-ref" data-choice="sign">
        <i class="fas fa-moon" aria-hidden="true"></i>
        <span><strong>${t("UESRPG.Dialogs.CharGen.StageBirthsign")}</strong><small>${readActorBirthsignLabel(actor) || t("UESRPG.UI.None")}</small></span>
      </button>
    </div>`,
    no: { label: t("UESRPG.UI.Cancel") },
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
    layout: "workflow",
    title: t("UESRPG.Dialogs.CharGen.StartingResourcesTitle"),
    classes: ["uesrpg-chargen-dialog"],
    content: `<div class="uesrpg-cg-dialog uesrpg-cg-stack">
      <p class="uesrpg-cg-dialog__note uesrpg-cg-intro">${t("UESRPG.Dialogs.CharGen.StartingResourcesNote")}</p>
      <label class="uesrpg-cg-field uesrpg-cg-field--stacked">
        <span>${t("UESRPG.Dialogs.CharGen.StartingDrakes")}</span>
        <input type="number" id="startingWealth" value="${currentWealth}" min="0">
      </label>
      <label class="uesrpg-cg-field uesrpg-cg-field--stacked">
        <span>${t("UESRPG.Dialogs.CharGen.StartingTotalXp")}</span>
        <input type="number" id="startingXpTotal" value="${currentXpTotal}" min="0">
      </label>
      <label class="uesrpg-cg-field uesrpg-cg-field--stacked">
        <span>${t("UESRPG.Dialogs.CharGen.StartingUnspentXp")}</span>
        <input type="number" id="startingXp" value="${currentXp}" min="0">
      </label>
    </div>`,
    yes: {
      label: t("UESRPG.UI.Submit"),
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
