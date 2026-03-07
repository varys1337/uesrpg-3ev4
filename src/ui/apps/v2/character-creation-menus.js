import coreRaces from "../../sheets/racemenu/data/core-races.js";
import coreVariants from "../../sheets/racemenu/data/core-variants.js";
import khajiitFurstocks from "../../sheets/racemenu/data/khajiit-furstocks.js";
import expandedRaces from "../../sheets/racemenu/data/expanded-races.js";
import birthsignSigns from "../../sheets/racemenu/data/birthsign-signs.js";
import { renderRaceCards } from "../../sheets/racemenu/render-race-cards.js";
import { requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { promptDialog } from "../../../utils/dialog-v2-helper.js";
import { appendChargenAudit } from "./char-gen/audit-log.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";

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

export function rollBirthsignSelection(chargeRaw) {
  const charge = String(chargeRaw ?? "").trim().toLowerCase();
  const table = BIRTHSIGN_CHARGE_TABLES[charge];
  if (!table) return null;
  const d5Roll = Math.ceil(Math.random() * 5);
  let starCursed = false;
  let resolved = d5Roll;
  if (d5Roll === 5) {
    starCursed = true;
    resolved = Math.ceil(Math.random() * 4);
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
} = {}) {
  if (!actor || !signKey) return false;
  const selectedSign = birthsignSigns[String(signKey).toLowerCase()];
  if (!selectedSign) {
    ui.notifications?.error?.("Selected birthsign data was not found.");
    return false;
  }

  const itemsArray = starCursed ? selectedSign.starCursed : selectedSign.items;
  const itemsToCreate = [];
  for (const item of itemsArray) {
    if (item.pack) {
      const pack = game.packs.get(item.pack);
      if (!pack) continue;
      await pack.getIndex();
      const entry = pack.index.find((e) => e.name.toLowerCase() === item.name.toLowerCase());
      if (!entry) continue;
      const itemDoc = await pack.getDocument(entry._id);
      if (!itemDoc) continue;
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
  if (itemsToCreate.length) await requestCreateEmbeddedDocuments(actor, "Item", itemsToCreate);

  if (starCursed && String(signKey).toLowerCase() === "thief") {
    await requestUpdateDocument(actor, { "system.characteristics.lck.base": 50, "system.characteristics.lck.total": 50 });
  }

  if (starCursed && selectedSign.starCursedChoices?.attributes?.length) {
    const choices = selectedSign.starCursedChoices;
    const attrOptions = choices.attributes
      .map((attr) => `<option value="${attr}">${attr.charAt(0).toUpperCase() + attr.slice(1)}</option>`)
      .join("");

    await promptDialog({
      title: "Star-Cursed Attribute Penalty",
      content: `<div><div class="form-group"><label>Select attribute to reduce by ${Math.abs(choices.modifier)}:</label><select id="attr-select">${attrOptions}</select></div></div>`,
      okLabel: "OK",
      callback: async (html) => {
        const el = html instanceof HTMLElement ? html : html?.[0];
        const selectedAttr = el?.querySelector("#attr-select")?.value;
        if (!selectedAttr) return;
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
        if (!bonusKey) return;
        const attrLabel = selectedAttr.charAt(0).toUpperCase() + selectedAttr.slice(1);
        const penaltyItem = {
          name: `Star-Cursed Penalty (${choices.modifier} ${attrLabel})`,
          type: "trait",
          img: "icons/magic/unholy/strike-beam-blood-red-purple.webp",
          "system.description": `Star-Cursed birthsign attribute penalty: ${choices.modifier} ${attrLabel}.`,
          [`system.characteristicBonus.${bonusKey}`]: choices.modifier,
        };
        await requestCreateEmbeddedDocuments(actor, "Item", [penaltyItem]);
      },
    });
  }

  const signLabel = selectedSign.name ?? signKey;
  const currentLuck = asNumber(actor.system?.characteristics?.lck?.base, 0);
  const nextLuck = Math.max(0, currentLuck - Math.max(0, asNumber(luckCost, 0)));
  const updates = { "system.birthSign": signLabel };
  if (luckCost > 0) {
    updates["system.characteristics.lck.base"] = nextLuck;
    updates["system.characteristics.lck.total"] = nextLuck;
  }
  await requestUpdateDocument(actor, updates);

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
      luckCost: Math.max(0, asNumber(luckCost, 0)),
    },
  });
  return true;
}

export class RaceMenuAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #resolver = null;
  #resolved = false;
  #isSubmitting = false;

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-race-menu-v2",
    classes: ["worldbuilding", "uesrpg", "uesrpg-creation-app", "uesrpg-race-menu-app"],
    window: {
      title: "Race Menu",
      resizable: true,
    },
    position: {
      width: 800,
      height: 700,
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

  static async prompt(actor) {
    const app = new RaceMenuAppV2(actor);
    return new Promise((resolve) => {
      app.#resolver = resolve;
      app.render(true);
    });
  }

  async _prepareContext(options) {
    const coreRaceCards = renderRaceCards(coreRaces);
    const variantRaceCards = renderRaceCards(coreVariants);
    const khajiitFurstockRaceCards = renderRaceCards(khajiitFurstocks);
    const expandedRaceCards = renderRaceCards(expandedRaces);

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
      const customRaceLabel = root.querySelector("#customRace")?.value?.trim() ?? "";

      if (raceSelection.length < 1 && customRaceLabel === "") {
        ui.notifications.error("Please select a race or input a custom race label");
        return;
      }

      let raceName;
      const races = { ...coreRaces, ...coreVariants, ...khajiitFurstocks, ...expandedRaces };

      if (customRaceLabel !== "") {
        raceName = customRaceLabel;
      } else {
        raceName = raceSelection[0].value;
        const selectedRace = races[raceName];
        if (!selectedRace) {
          ui.notifications.error("Selected race data was not found.");
          return;
        }

        const updates = {};
        for (const value in this.#actor.system.characteristics) {
          const baseChaPath = `system.characteristics.${value}.base`;
          const totalChaPath = `system.characteristics.${value}.total`;
          updates[baseChaPath] = selectedRace.baseline[value];
          updates[totalChaPath] = selectedRace.baseline[value] + this.#actor.system.characteristics[value].bonus;
        }
        await requestUpdateDocument(this.#actor, updates);

        const itemsToCreate = [];
        for (const item of selectedRace.items) {
          const itemData = {
            name: item.name,
            type: item.type,
            img: item.img,
            "system.description": item.desc,
            [item.dataPath]: item.value,
            [item.dataPath2]: item.qualities,
          };
          itemsToCreate.push(itemData);
        }
        const created = await requestCreateEmbeddedDocuments(this.#actor, "Item", itemsToCreate);
        for (const createdItem of created) {
          if (createdItem?.type === "weapon") createdItem.sheet?.render?.(true);
        }
      }

      await requestUpdateDocument(this.#actor, { "system.race": raceName });
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

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-birthsign-menu-v2",
    classes: ["worldbuilding", "uesrpg", "uesrpg-creation-app", "uesrpg-birthsign-menu-app"],
    window: {
      title: "Birthsign Menu",
      resizable: true,
    },
    position: {
      width: 800,
      height: 700,
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

  static async prompt(actor) {
    const app = new BirthSignMenuAppV2(actor);
    return new Promise((resolve) => {
      app.#resolver = resolve;
      app.render(true);
    });
  }

  async _prepareContext(options) {
    const signCards = [];
    const signs = birthsignSigns;

    for (const signKey in signs) {
      const s = signs[signKey];
      const traitItems = s.traits.map((t) => `<li>${t}</li>`).join("");
      const normalId = `sign-${toSlug(signKey)}`;
      const cursedId = `sign-${toSlug(signKey)}-cursed`;
      signCards.push(`
        <div class="menu-card">
            <input class="signSelect" type="radio" id="${normalId}" name="signRadio" value="${signKey}">
            <input class="signSelect signSelect--cursed" type="radio" id="${cursedId}" name="signRadio" value="${signKey}|cursed">
            <span class="menu-card__selected" aria-hidden="true"></span>
            <img class="card-portrait" src="${s.img}" alt="${s.name}" height="85" width="65">
            <div class="card-body">
                <p class="card-description">${s.description}</p>
                <ul class="card-traits">${traitItems}</ul>
                <div class="card-actions">
                    <label for="${normalId}" class="card-btn">${s.name}</label>
                    <label for="${cursedId}" class="card-btn card-btn-cursed">${s.name} - Star-Cursed</label>
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
      const customSignLabel = root.querySelector("#customSign")?.value?.trim() ?? "";

      if (signSelection.length < 1 && customSignLabel === "") {
        ui.notifications.error("Please select a birthsign or input a custom birthsign label");
        return;
      }

      let signName;
      if (customSignLabel !== "") {
        signName = customSignLabel;
        await requestUpdateDocument(this.#actor, { "system.birthSign": signName });
        await appendChargenAudit(this.#actor, {
          step: "birthsign",
          action: "apply",
          payload: { mode: "manual-custom", result: signName },
        });
      } else {
        const rawValue = signSelection[0].value;
        const isStarCursed = rawValue.endsWith("|cursed");
        signName = isStarCursed ? rawValue.replace("|cursed", "") : rawValue;
        await applyBirthsignSelection(this.#actor, {
          signKey: signName.toLowerCase(),
          starCursed: isStarCursed,
          mode: "manual",
        });
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

