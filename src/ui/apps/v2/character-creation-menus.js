import coreRaces from "../../sheets/racemenu/data/core-races.js";
import coreVariants from "../../sheets/racemenu/data/core-variants.js";
import khajiitFurstocks from "../../sheets/racemenu/data/khajiit-furstocks.js";
import expandedRaces from "../../sheets/racemenu/data/expanded-races.js";
import birthsignSigns from "../../sheets/racemenu/data/birthsign-signs.js";
import { renderRaceCards } from "../../sheets/racemenu/render-race-cards.js";
import { requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { promptDialog } from "../../../utils/dialog-v2-helper.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
      template: "systems/uesrpg-3ev4/templates/v2/apps/race-menu.hbs",
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
      template: "systems/uesrpg-3ev4/templates/v2/apps/birthsign-menu.hbs",
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
            <input class="signSelect" type="radio" id="${cursedId}" name="signRadio" value="${signKey}|cursed">
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
      const signs = birthsignSigns;
      const signSelection = [...root.querySelectorAll(".signSelect")].filter((i) => i.checked);
      const customSignLabel = root.querySelector("#customSign")?.value?.trim() ?? "";

      if (signSelection.length < 1 && customSignLabel === "") {
        ui.notifications.error("Please select a birthsign or input a custom birthsign label");
        return;
      }

      let signName;
      if (customSignLabel !== "") {
        signName = customSignLabel;
      } else {
        const rawValue = signSelection[0].value;
        const isStarCursed = rawValue.endsWith("|cursed");
        signName = isStarCursed ? rawValue.replace("|cursed", "") : rawValue;

        const selectedSign = signs[signName.toLowerCase()];
        if (!selectedSign) {
          ui.notifications.error("Selected birthsign data was not found.");
          return;
        }

        const itemsArray = isStarCursed ? selectedSign.starCursed : selectedSign.items;

        const itemsToCreate = [];
        for (const item of itemsArray) {
          if (item.pack) {
            const pack = game.packs.get(item.pack);
            if (!pack) {
              console.error(`Compendium "${item.pack}" not found`);
              continue;
            }
            await pack.getIndex();
            const entry = pack.index.find((e) => e.name.toLowerCase() === item.name.toLowerCase());
            if (!entry) {
              console.warn(`Item "${item.name}" not found in "${item.pack}" compendium`);
              continue;
            }
            const itemDoc = await pack.getDocument(entry._id);
            if (!itemDoc) {
              console.error(`Failed to load item "${item.name}" from "${item.pack}"`);
              continue;
            }
            const itemData = itemDoc.toObject();
            delete itemData.ownership;
            itemsToCreate.push(itemData);
          } else {
            const itemData = {
              name: item.name,
              type: item.type,
              img: item.img,
              "system.description": item.desc || "",
              ...(item.data || {}),
            };
            itemsToCreate.push(itemData);
          }
        }
        await requestCreateEmbeddedDocuments(this.#actor, "Item", itemsToCreate);

        if (isStarCursed && signName.toLowerCase() === "thief") {
          await requestUpdateDocument(this.#actor, {
            "system.characteristics.lck.base": 50,
          });
        }

        if (isStarCursed && selectedSign.starCursedChoices) {
          const choices = selectedSign.starCursedChoices;
          if (choices.attributes && choices.attributes.length > 0) {
            const attrOptions = choices.attributes
              .map((attr) => `<option value="${attr}">${attr.charAt(0).toUpperCase() + attr.slice(1)}</option>`)
              .join("");

            await promptDialog({
              title: "Star-Cursed Attribute Penalty",
              content: `<div>
                        <div class="form-group">
                          <label>Select attribute to reduce by ${Math.abs(choices.modifier)}:</label>
                          <select id="attr-select">${attrOptions}</select>
                        </div>
                      </div>`,
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
                await requestCreateEmbeddedDocuments(this.#actor, "Item", [penaltyItem]);
              },
            });
          }
        }
      }

      const signLabel = signs[signName.toLowerCase()]?.name ?? signName;
      await requestUpdateDocument(this.#actor, { "system.birthSign": signLabel });
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
