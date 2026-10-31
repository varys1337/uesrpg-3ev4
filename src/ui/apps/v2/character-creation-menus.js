import coreRaces from "../../sheets/racemenu/data/core-races.js";
import coreVariants from "../../sheets/racemenu/data/core-variants.js";
import khajiitFurstocks from "../../sheets/racemenu/data/khajiit-furstocks.js";
import expandedRaces from "../../sheets/racemenu/data/expanded-races.js";
import birthsignSigns from "../../sheets/racemenu/data/birthsign-signs.js";
import { renderRaceCards } from "../../sheets/racemenu/render-race-cards.js";
import { requestAtomicUpdateDocument, requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { confirmDialog, promptDialog } from "../../../utils/dialog-v2-helper.js";
import { appendChargenAudit } from "./char-gen/audit-log.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";
import { t, tf } from "../../../utils/i18n.js";
import { findIndexEntryByNormalizedName, getDocumentById } from "../../../core/compendium/access-service.js";
import { buildBirthsignFieldUpdates } from "../../../core/traits/starsigns/index.js";
import { RACE_CATALOG } from "../../sheets/racemenu/race-catalog.js";
import {
  buildAdministrativeCorrectionAudit,
  isChargenCompleted,
  promptAndApplyAllMissingRacialGrants,
  rollbackTrackedRacialGrants,
} from "./char-gen/racial-grants.js";
import { withApplicationUniqueId } from "./application-identity.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const BIRTHSIGN_CHARGE_TABLES = Object.freeze({
  warrior: ["warrior", "lady", "steed", "lord"],
  mage: ["mage", "apprentice", "atronach", "ritual"],
  thief: ["thief", "lover", "shadow", "tower"],
});

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function canPayBirthsignLuck(actor, amount) {
  if (!(amount > 0)) return true;
  const raw = actor?.system?.characteristics?.lck?.base;
  const current = raw == null ? NaN : Number(raw);
  if (Number.isFinite(current) && current >= amount) return true;
  ui.notifications?.warn?.(tf("UESRPG.Notifications.CharGen.BirthsignInsufficientLuck", { cost: amount }, `A valid Luck base of at least ${amount} is required for this choice.`));
  return false;
}

export function rollBirthsignSelection(chargeRaw) {
  const charge = String(chargeRaw ?? "").trim().toLowerCase();
  const table = BIRTHSIGN_CHARGE_TABLES[charge];
  if (!table) return null;
  const d5Roll = Math.floor(Math.random() * 5) + 1;
  let starCursed = false;
  let resolved = d5Roll;
  if (d5Roll === 5) {
    starCursed = true;
    resolved = Math.floor(Math.random() * 4) + 1;
  }
  const signKey = table[resolved - 1];
  return { mode: "roll", charge, d5Roll, resolvedRoll: resolved, signKey, starCursed };
}

export async function applyBirthsignSelection(actor, {
  signKey,
  starCursed = false,
  mode = "manual",
  charge = null,
  d5Roll = null,
  luckCost = 0,
  administrativeReason = null,
} = {}) {
  if (!actor || !signKey) return false;
  if (isChargenCompleted(actor)) {
    if (!game.user?.isGM || String(administrativeReason ?? "").trim().length < 3) {
      ui.notifications?.warn?.(t("UESRPG.DefectUpdate.GmCorrectionRequired", "A GM Administrative Correction is required after character generation."));
      return false;
    }
  }
  const selectedSign = birthsignSigns[String(signKey).toLowerCase()];
  if (!selectedSign) {
    ui.notifications?.error?.(t("UESRPG.Notifications.CharGen.SelectedBirthsignMissing"));
    return false;
  }

  const paidLuck = Math.max(0, asNumber(luckCost, 0));
  if (mode === "roll-upgrade") {
    const table = BIRTHSIGN_CHARGE_TABLES[String(charge ?? "").trim().toLowerCase()];
    const roll = Number(d5Roll);
    const expected = Number.isInteger(roll) && roll >= 1 && roll <= 4 ? table?.[roll - 1] : null;
    const cost = String(signKey).toLowerCase() === "thief" ? 0 : 5;
    if (!starCursed || expected !== String(signKey).toLowerCase() || paidLuck !== cost) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.InvalidBirthsignUpgrade", "This Star-Cursed upgrade does not match the recorded normal roll."));
      return false;
    }
  }
  if (mode === "manual" && starCursed && paidLuck > 0) {
    if (String(signKey).toLowerCase() === "thief") {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.CursedThiefLuckChoice", "The Star-Cursed Thief cannot be chosen by spending Luck."));
      return false;
    }
    if (paidLuck !== 10) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.CursedBirthsignLuckCost", "A paid manual Star-Cursed birthsign costs 10 Luck."));
      return false;
    }
  }
  if (!canPayBirthsignLuck(actor, paidLuck)) return false;

  const itemsArray = starCursed ? selectedSign.starCursed : selectedSign.items;
  const itemsToCreate = [];
  for (const item of itemsArray) {
    if (item.pack) {
      const entry = await findIndexEntryByNormalizedName(item.pack, item.name, { fields: ["name"] });
      if (!entry) {
        ui.notifications?.error?.(`Birthsign grant unavailable: ${item.name} (${item.pack}). No birthsign grants were created.`);
        return false;
      }
      const itemDoc = await getDocumentById(item.pack, entry._id);
      if (!itemDoc) {
        ui.notifications?.error?.(`Birthsign grant could not be loaded: ${item.name}. No birthsign grants were created.`);
        return false;
      }
      const itemData = itemDoc.toObject();
      delete itemData.ownership;
      itemsToCreate.push(itemData);
      continue;
    }
    itemsToCreate.push({
      name: item.name,
      type: item.type,
      img: item.img,
      "system.description": item.desc || "",
      ...(item.data || {}),
    });
  }
  if (starCursed && selectedSign.starCursedChoices?.attributes?.length) {
    const choices = selectedSign.starCursedChoices;
    const attrOptions = choices.attributes
      .map((attr) => `<option value="${attr}">${attr.charAt(0).toUpperCase() + attr.slice(1)}</option>`)
      .join("");

    const selectedAttr = await promptDialog({
      title: t("UESRPG.Dialogs.CharGen.StarCursedPenaltyTitle"),
      classes: ["uesrpg-chargen-dialog"],
      content: `<div class="uesrpg-cg-dialog"><div class="form-group"><label>${tf("UESRPG.Dialogs.CharGen.StarCursedPenaltyLabel", { amount: Math.abs(choices.modifier) })}</label><select data-role="attribute-select">${attrOptions}</select></div></div>`,
      okLabel: t("UESRPG.UI.OK"),
      callback: (html) => {
        const el = html instanceof HTMLElement ? html : html?.[0];
        return el?.querySelector('[data-role="attribute-select"]')?.value ?? null;
      },
    });
    if (!selectedAttr || !choices.attributes.includes(selectedAttr)) return false;
    const keyMap = {
      strength: "strChaBonus",
      endurance: "endChaBonus",
      agility: "agiChaBonus",
      intelligence: "intChaBonus",
      willpower: "wpChaBonus",
      perception: "prcChaBonus",
      personality: "prsChaBonus",
      luck: "lckChaBonus",
    };
    const bonusKey = keyMap[selectedAttr];
    if (!bonusKey) return false;
    const attrLabel = selectedAttr.charAt(0).toUpperCase() + selectedAttr.slice(1);
    itemsToCreate.push({
      name: `Star-Cursed Penalty (${choices.modifier} ${attrLabel})`,
      type: "trait",
      img: "icons/magic/unholy/strike-beam-blood-red-purple.webp",
      "system.description": `Star-Cursed birthsign attribute penalty: ${choices.modifier} ${attrLabel}.`,
      [`system.characteristicBonus.${bonusKey}`]: choices.modifier,
    });
  }

  // Recheck after the optional choice dialog before creating any grants.
  if (!canPayBirthsignLuck(actor, paidLuck)) return false;
  const baseLuckBefore = actor.system?.characteristics?.lck?.base;
  const birthsignBefore = String(actor.system?.birthsign ?? "");
  const legacyBirthsignBefore = String(actor.system?.birthSign ?? "");

  if (itemsToCreate.length) {
    const created = await requestCreateEmbeddedDocuments(actor, "Item", itemsToCreate);
    if (created.length !== itemsToCreate.length) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.BirthsignSaveUncertain"));
      return false;
    }
  }

  const signLabel = selectedSign.name ?? signKey;
  const currentLuck = starCursed && String(signKey).toLowerCase() === "thief"
    ? 50 : asNumber(baseLuckBefore, 0);
  const nextLuck = Math.max(0, currentLuck - paidLuck);
  const updates = buildBirthsignFieldUpdates(signLabel);
  if (luckCost > 0 || (starCursed && String(signKey).toLowerCase() === "thief")) {
    updates["system.characteristics.lck.base"] = nextLuck;
  }
  const updated = await requestAtomicUpdateDocument(actor, fresh => {
    if (String(fresh.system?.birthsign ?? "") !== birthsignBefore
      || String(fresh.system?.birthSign ?? "") !== legacyBirthsignBefore
      || ((paidLuck > 0 || (starCursed && String(signKey).toLowerCase() === "thief"))
        && !Object.is(fresh.system?.characteristics?.lck?.base, baseLuckBefore))) return null;
    return updates;
  });
  if (!updated) {
    ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.BirthsignSaveUncertain"));
    return false;
  }

  await appendChargenAudit(actor, {
    step: "birthsign",
    action: "apply",
    payload: {
      mode,
      charge,
      d5Roll,
      result: signLabel,
      signKey,
      starCursed: Boolean(starCursed),
      luckCost: paidLuck,
      administrativeReason: String(administrativeReason ?? ""),
    },
  });
  return true;
}

export class RaceMenuAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #resolver = null;
  #resolved = false;
  #isSubmitting = false;
  #administrativeReason = null;

  constructor(actor, options = {}) {
    super(withApplicationUniqueId(options, `${actor?.uuid ?? "actor"}-${foundry.utils.randomID()}`));
    this.#actor = actor;
    this.#administrativeReason = String(options.administrativeReason ?? "").trim() || null;
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-race-menu-v2-{id}",
    classes: ["worldbuilding", "uesrpg", "uesrpg-creation-app", "uesrpg-race-menu-app"],
    window: {
      resizable: true,
    },
    position: {
      width: 760,
      height: 620,
    },
    actions: {
      submit: RaceMenuAppV2.prototype._onSubmit,
      cancel: RaceMenuAppV2.prototype._onCancel,
    },
  };

  static PARTS = {
    main: {
      template: templatePath("v2/apps/race-menu.hbs"),
      scrollable: [".menu-cards"],
    },
  };

  static async prompt(actor, { administrativeReason = null } = {}) {
    if (isChargenCompleted(actor) && (!game.user?.isGM || String(administrativeReason ?? "").trim().length < 3)) {
      ui.notifications?.warn?.(t("UESRPG.DefectUpdate.GmCorrectionRequired", "A GM Administrative Correction is required after character generation."));
      return false;
    }
    const app = new RaceMenuAppV2(actor, { administrativeReason });
    return new Promise((resolve) => {
      app.#resolver = resolve;
      app.render(true);
    });
  }

  get title() {
    return t("UESRPG.Dialogs.CharGen.RaceMenuTitle", "Race Menu");
  }

  async _prepareContext(options) {
    const cardOptions = { idPrefix: this.id };
    const coreRaceCards = renderRaceCards(coreRaces, cardOptions);
    const variantRaceCards = renderRaceCards(coreVariants, cardOptions);
    const khajiitFurstockRaceCards = renderRaceCards(khajiitFurstocks, cardOptions);
    const expandedRaceCards = renderRaceCards(expandedRaces, cardOptions);

    return {
      coreRaceCards: coreRaceCards.join(""),
      variantRaceCards: variantRaceCards.join(""),
      khajiitFurstockRaceCards: khajiitFurstockRaceCards.join(""),
      expandedRaceCards: expandedRaceCards.join(""),
    };
  }

  async _onSubmit(event, target) {
    event?.preventDefault?.();
    if (this.#isSubmitting) return;
    this.#isSubmitting = true;

    try {
      const root = this.element;
      const raceSelection = [...root.querySelectorAll(".raceSelect")].filter((i) => i.checked);
      const customRaceLabel = root.querySelector('[data-role="custom-race"]')?.value?.trim() ?? "";

      if (raceSelection.length < 1 && customRaceLabel === "") {
        ui.notifications.error(t("UESRPG.Notifications.CharGen.SelectRaceOrCustom"));
        return;
      }

      let raceName;
      const races = RACE_CATALOG;
      const previousRace = String(this.#actor.system?.race ?? "").trim();

      if (customRaceLabel !== "") {
        raceName = customRaceLabel;
        if (previousRace && previousRace.toLowerCase() !== raceName.toLowerCase()) {
          const rollback = await rollbackTrackedRacialGrants(this.#actor, previousRace, {
            reason: this.#administrativeReason ?? "custom race selected during character generation",
          });
          if (!rollback.ok) {
            ui.notifications?.error?.(tf("UESRPG.DefectUpdate.RaceGrantConflict", { reason: rollback.error }, `Race change blocked: ${rollback.error}`));
            return;
          }
        }
      } else {
        raceName = raceSelection[0].value;
        const selectedRace = races[raceName];
        if (!selectedRace) {
          ui.notifications.error(t("UESRPG.Notifications.CharGen.SelectedRaceMissing"));
          return;
        }

        const raceChanged = previousRace.toLowerCase() !== raceName.toLowerCase();
        if (raceChanged && previousRace) {
          const rollback = await rollbackTrackedRacialGrants(this.#actor, previousRace, {
            reason: this.#administrativeReason ?? "race changed during character generation",
          });
          if (!rollback.ok) {
            ui.notifications?.error?.(tf("UESRPG.DefectUpdate.RaceGrantConflict", { reason: rollback.error }, `Race change blocked: ${rollback.error}`));
            return;
          }
        }

        if (raceChanged) {
          const updates = {};
          for (const value in this.#actor.system.characteristics) {
            const baseline = selectedRace.baseline?.[value];
            if (baseline !== undefined) updates[`system.characteristics.${value}.base`] = baseline;
          }
          if (Object.keys(updates).length && !await requestUpdateDocument(this.#actor, updates)) {
            ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.RaceSaveFailed"));
            return;
          }

          const itemsToCreate = [];
          for (const item of selectedRace.items ?? []) {
            const itemData = {
              name: item.name,
              type: item.type,
              img: item.img,
              "system.description": item.desc,
            };
            if (item.dataPath) itemData[item.dataPath] = item.value;
            if (item.dataPath2) itemData[item.dataPath2] = item.qualities;
            itemsToCreate.push(itemData);
          }
          const created = itemsToCreate.length
            ? await requestCreateEmbeddedDocuments(this.#actor, "Item", itemsToCreate)
            : [];
          if (created.length !== itemsToCreate.length) {
            ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.RaceItemsUncertain"));
            return;
          }
          for (const createdItem of created) {
            if (createdItem?.type === "weapon") createdItem.sheet?.render?.(true);
          }
        }
      }

      if (!await requestUpdateDocument(this.#actor, { "system.race": raceName })) {
        ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.RaceItemsUncertain"));
        return;
      }
      const grantResults = await promptAndApplyAllMissingRacialGrants(this.#actor);
      const failedGrant = grantResults.find((result) => result && !result.ok && !result.cancelled);
      if (failedGrant) ui.notifications?.warn?.(failedGrant.error ?? t("UESRPG.DefectUpdate.GrantApplyFailed", "Unable to apply racial grant."));
      if (this.#administrativeReason) {
        await appendChargenAudit(this.#actor, buildAdministrativeCorrectionAudit(this.#administrativeReason, {
          field: "race",
          before: previousRace,
          after: raceName,
        }));
      }
      this.#resolveAndClose(true);
    } finally {
      this.#isSubmitting = false;
    }
  }

  _onCancel(event, target) {
    event?.preventDefault?.();
    this.#resolveAndClose(false);
  }

  async close(options = {}) {
    if (!this.#resolved && this.#resolver) {
      this.#resolved = true;
      this.#resolver(false);
    }
    return super.close(options);
  }

  #resolveAndClose(result) {
    if (!this.#resolved && this.#resolver) {
      this.#resolved = true;
      this.#resolver(result);
    }
    this.close();
  }
}

export class BirthSignMenuAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #resolver = null;
  #resolved = false;
  #isSubmitting = false;
  #administrativeReason = null;
  #luckCost = 0;

  constructor(actor, options = {}) {
    super(withApplicationUniqueId(options, `${actor?.uuid ?? "actor"}-${foundry.utils.randomID()}`));
    this.#actor = actor;
    this.#administrativeReason = String(options.administrativeReason ?? "").trim() || null;
    this.#luckCost = Math.max(0, asNumber(options.luckCost, 0));
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-birthsign-menu-v2-{id}",
    classes: ["worldbuilding", "uesrpg", "uesrpg-creation-app", "uesrpg-birthsign-menu-app"],
    window: {
      resizable: true,
    },
    position: {
      width: 760,
      height: 620,
    },
    actions: {
      submit: BirthSignMenuAppV2.prototype._onSubmit,
      cancel: BirthSignMenuAppV2.prototype._onCancel,
    },
  };

  static PARTS = {
    main: {
      template: templatePath("v2/apps/birthsign-menu.hbs"),
      scrollable: [".menu-cards"],
    },
  };

  static async prompt(actor, { administrativeReason = null, luckCost = 0 } = {}) {
    if (isChargenCompleted(actor) && (!game.user?.isGM || String(administrativeReason ?? "").trim().length < 3)) {
      ui.notifications?.warn?.(t("UESRPG.DefectUpdate.GmCorrectionRequired", "A GM Administrative Correction is required after character generation."));
      return false;
    }
    const app = new BirthSignMenuAppV2(actor, { administrativeReason, luckCost });
    return new Promise((resolve) => {
      app.#resolver = resolve;
      app.render(true);
    });
  }

  get title() {
    return t("UESRPG.Dialogs.CharGen.BirthsignMenuTitle", "Birthsign Menu");
  }

  async _prepareContext(options) {
    const signCards = [];
    const signs = birthsignSigns;

    for (const signKey in signs) {
      const s = signs[signKey];
      const traitItems = s.traits.map((entry) => `<li>${foundry.utils.escapeHTML(entry)}</li>`).join("");
      const normalId = `${toSlug(this.id)}-sign-${toSlug(signKey)}`;
      const cursedId = `${toSlug(this.id)}-sign-${toSlug(signKey)}-cursed`;
      const escapedSignKey = foundry.utils.escapeHTML(signKey);
      const escapedName = foundry.utils.escapeHTML(s.name);
      signCards.push(`
        <div class="menu-card">
            <input class="signSelect" type="radio" id="${normalId}" name="signRadio" value="${escapedSignKey}">
            <input class="signSelect signSelect--cursed" type="radio" id="${cursedId}" name="signRadio" value="${escapedSignKey}|cursed">
            <span class="menu-card__selected" aria-hidden="true"></span>
            <img class="card-portrait" src="${foundry.utils.escapeHTML(s.img)}" alt="${escapedName}" height="85" width="65">
            <div class="card-body">
                <p class="card-description">${foundry.utils.escapeHTML(s.description)}</p>
                <ul class="card-traits">${traitItems}</ul>
                <div class="card-actions">
                    <label for="${normalId}" class="card-btn uesrpg-adv-choice uesrpg-choice-bar"><span class="uesrpg-adv-choice__label">${escapedName}</span></label>
                    <label for="${cursedId}" class="card-btn card-btn-cursed uesrpg-adv-choice uesrpg-choice-bar"><span class="uesrpg-adv-choice__label">${escapedName} - ${t("UESRPG.Dialogs.CharGen.StarCursed")}</span></label>
                </div>
            </div>
        </div>`);
    }

    return {
      signCards: signCards.join(""),
    };
  }

  async _onSubmit(event, target) {
    event?.preventDefault?.();
    if (this.#isSubmitting) return;
    this.#isSubmitting = true;

    try {
      const root = this.element;
      const signSelection = [...root.querySelectorAll(".signSelect")].filter((i) => i.checked);
      const customSignLabel = root.querySelector('[data-role="custom-sign"]')?.value?.trim() ?? "";

      if (signSelection.length < 1 && customSignLabel === "") {
        ui.notifications.error(t("UESRPG.Notifications.CharGen.SelectBirthsignOrCustom"));
        return;
      }

      let signName;
      if (customSignLabel !== "") {
        signName = customSignLabel;
        const updates = buildBirthsignFieldUpdates(signName);
        const baseLuckBefore = this.#actor.system?.characteristics?.lck?.base;
        if (this.#luckCost > 0) {
          if (!canPayBirthsignLuck(this.#actor, this.#luckCost)) return;
          updates["system.characteristics.lck.base"] = Math.max(0, asNumber(baseLuckBefore, 0) - this.#luckCost);
        }
        const updated = await requestAtomicUpdateDocument(this.#actor, fresh => {
          if (this.#luckCost > 0 && !Object.is(fresh.system?.characteristics?.lck?.base, baseLuckBefore)) return null;
          return updates;
        });
        if (!updated) {
          ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.BirthsignSaveFailed"));
          return;
        }
        await appendChargenAudit(this.#actor, {
          step: "birthsign",
          action: "apply",
          payload: { mode: "manual-custom", result: signName, luckCost: this.#luckCost, administrativeReason: this.#administrativeReason ?? "" },
        });
      } else {
        const rawValue = signSelection[0].value;
        const isStarCursed = rawValue.endsWith("|cursed");
        signName = isStarCursed ? rawValue.replace("|cursed", "") : rawValue;
        const paidLuck = isStarCursed && this.#luckCost > 0 ? 10 : this.#luckCost;
        if (isStarCursed && paidLuck > 0) {
          if (signName.toLowerCase() === "thief") {
            ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.CursedThiefLuckChoice", "The Star-Cursed Thief cannot be chosen by spending Luck."));
            return;
          }
          if (!canPayBirthsignLuck(this.#actor, paidLuck)) return;
          const confirmed = await confirmDialog({
            title: t("UESRPG.Dialogs.CharGen.CursedBirthsignCostTitle", "Star-Cursed birthsign cost"),
            content: `<p>${t("UESRPG.Dialogs.CharGen.CursedBirthsignCostConfirm", "This choice permanently reduces Luck by 10. Confirm the cost before continuing.")}</p>`,
            yesLabel: t("UESRPG.Dialogs.CharGen.Spend10Luck", "Spend 10 Luck"),
            noLabel: t("UESRPG.UI.Cancel", "Cancel"),
          });
          if (!confirmed) return;
        }
        const applied = await applyBirthsignSelection(this.#actor, {
          signKey: signName.toLowerCase(),
          starCursed: isStarCursed,
          mode: "manual",
          luckCost: paidLuck,
          administrativeReason: this.#administrativeReason,
        });
        if (!applied) return;
      }
      this.#resolveAndClose(true);
    } finally {
      this.#isSubmitting = false;
    }
  }

  _onCancel(event, target) {
    event?.preventDefault?.();
    this.#resolveAndClose(false);
  }

  async close(options = {}) {
    if (!this.#resolved && this.#resolver) {
      this.#resolved = true;
      this.#resolver(false);
    }
    return super.close(options);
  }

  #resolveAndClose(result) {
    if (!this.#resolved && this.#resolver) {
      this.#resolved = true;
      this.#resolver(result);
    }
    this.close();
  }
}

function toSlug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
