/**
 * @file Character creation menus (Race, Birth Sign, XP)
 * Extracted from actor-sheet.js for better organization
 */

import coreRaces from "../../racemenu/data/core-races.js";
import coreVariants from "../../racemenu/data/core-variants.js";
import { renderRaceCards } from "../../racemenu/render-race-cards.js";
import khajiitFurstocks from "../../racemenu/data/khajiit-furstocks.js";
import expandedRaces from "../../racemenu/data/expanded-races.js";
import { requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../../../utils/authority-proxy.js";

/**
 * Show race selection menu.
 * @param {ActorSheet} sheet - The actor sheet instance
 * @param {Event} event - The triggering event
 */
export async function onRaceMenu(sheet, event) {
  event.preventDefault();

  const coreRaceCards = renderRaceCards(coreRaces);
  const variantRaceCards = renderRaceCards(coreVariants);
  const khajiitFurstockRaceCards = renderRaceCards(khajiitFurstocks);
  const expandedRaceCards = renderRaceCards(expandedRaces);

  let d = new Dialog({
    title: "Race Menu",
    content: `<style>
                .uesrpg-race-card:has(input.raceSelect:checked) {
                  border-color: goldenrod !important;
                  background: rgba(218, 165, 32, 0.08);
                }
                .uesrpg-race-card label:hover {
                  background: rgba(120, 120, 120, 0.5) !important;
                }
                .uesrpg-race-card:has(input.raceSelect:checked) label {
                  background: rgba(218, 165, 32, 0.25) !important;
                  border-color: goldenrod !important;
                }
              </style>
              <form style="padding: 10px;">
                <div style="border: 1px solid; background: rgba(85, 85, 85, 0.40); font-style:italic; padding: 5px; text-align: center;">
                  <div>
                      Select a Race from the cards below or input your own custom race label below. Leave blank if you do NOT want to use a custom race.
                  </div>
                  <input type="text" id="customRace" style="width: 200px">
                </div>

                <div>
                    <img src="systems/uesrpg-3ev4/images/dialogue/races/Races_Oblivion.webp" title="Races of Elder Scrolls" style="border: none;">
                </div>

                <div style="height: 500px; overflow-y: scroll;">
                    <h1 style="padding-top: 10px;">Core Races</h1>
                    <div style="display: flex; flex-direction: row; flex-wrap: wrap; justify-content: space-between; align-content: center; width: 100%;">
                      ${coreRaceCards.join("")}
                    </div>
                    <h1 style="padding-top: 10px;">Core Race Variants</h1>
                    <div style="display: flex; flex-direction: row; flex-wrap: wrap; justify-content: space-between; align-content: center; width: 100%;">
                      ${variantRaceCards.join("")}
                    </div>
                    <h1 style="padding-top: 10px;">Khajiit Furstocks</h1>
                    <div style="display: flex; flex-direction: row; flex-wrap: wrap; justify-content: space-between; align-content: center; width: 100%;">
                      ${khajiitFurstockRaceCards.join("")}
                    </div>
                    <h1 style="padding-top: 10px;">Expanded Races</h1>
                    <div style="display: flex; flex-direction: row; flex-wrap: wrap; justify-content: space-between; align-content: center; width: 100%;">
                      ${expandedRaceCards.join("")}
                    </div>
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
          // Check for a selection, or show error instead
          let raceSelection = [
            ...document.querySelectorAll(".raceSelect"),
          ].filter((i) => i.checked);
          let customRaceLabel = document.querySelector("#customRace").value;

          if (raceSelection.length < 1 && customRaceLabel === "") {
            ui.notifications.error(
              "Please select a race or input a custom race label"
            );
          }

          // Logic for setting Race Name and Other factors
          else {
            let raceName;

            const races = { ...coreRaces, ...coreVariants, ...khajiitFurstocks, ...expandedRaces };

            if (customRaceLabel !== "") {
              raceName = customRaceLabel;
            } else {
              raceName = raceSelection[0].id;
              let selectedRace = races[raceName];

              // Loop through and update actor base characteristics with race object baselines
              const updates = {};
              for (let value in sheet.actor.system.characteristics) {
                let baseChaPath = `system.characteristics.${value}.base`;
                let totalChaPath = `system.characteristics.${value}.total`;
                updates[baseChaPath] = selectedRace.baseline[value];
                updates[totalChaPath] =
                  selectedRace.baseline[value] +
                  sheet.actor.system.characteristics[value].bonus;
              }
              await requestUpdateDocument(sheet.actor, updates);

              // Loop through and add Racial items to the actor sheet
              const itemsToCreate = [];
              for (let item of selectedRace.items) {
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
              const created = await requestCreateEmbeddedDocuments(sheet.actor, "Item", itemsToCreate);
              for (const createdItem of created) {
                if (createdItem?.type === "weapon") {
                  createdItem.sheet?.render?.(true);
                }
              }
            }
            // Update Actor with Race Label
            await requestUpdateDocument(sheet.actor, { "system.race": raceName });
          }
        },
      },
    },
    default: "two",
    close: () => {},
  });

  d.position.width = 600;
  d.position.height = 775;
  d.render(true);
}

/**
 * Show birth sign selection menu.
 * @param {ActorSheet} sheet - The actor sheet instance
 * @param {Event} event - The triggering event
 */
export async function onBirthSignMenu(sheet, event) {
  event.preventDefault();

  let signCards = [];
  const imgPath = "systems/uesrpg-3ev4/images/dialogue/signs";
  const signs = {
    apprentice: {
      name: "Apprentice",
      img: `${imgPath}/sign-apprentice.webp`,
      description: `The Apprentice's Season is Sun's Height. Those born under the sign of the apprentice have a special
                    affinity for magick of all kinds, but are more vulnerable to magick as well.`,
      traits: [
        "Power Well (25) and Weakness (Magic, 2)",
        "Star-Cursed Apprentice: Gain Power Well (50) instead, and also gain Weakness(Magic, 3)",
      ],
      items: ["The Apprentice", "Power Well (25)", "Weakness (Magic, 2)"],
      starCursed: [
        "The Star-Cursed Apprentice",
        "Power Well (50)",
        "Weakness (Magic, 3)",
      ],
    },
    atronach: {
      name: "Atronach",
      img: `${imgPath}/sign-atronach.webp`,
      description: `The Atronach (often called the Golem) is one of the Mage's Charges. Its season is Sun's Dusk. Those born under
                    this sign are natural sorcerers with deep reserves of magicka, but they cannot generate magicka of their own.`,
      traits: [
        "Power Well (100) and No Magicka Regeneration (INT cannot restore Magicka, Spells cannot restore Magicka, and Alchemy CANNOT restore Magicka)",
        "Star-Cursed Atronach: Gain Power Well (150) instead",
      ],
      items: ["The Atronach", "Power Well (100)"],
      starCursed: ["The Star-Cursed Atronach", "Power Well (150)"],
    },
    lady: {
      name: "Lady",
      img: `${imgPath}/sign-lady.webp`,
      description: `The Lady's Season is Heartfire. Those born under the sign of The Lady are kind and tolerant.`,
      traits: [
        "+5 Personality and +5 Willpower",
        "Star-Cursed Lady: +10 Willpower and +10 Personality, but also gain Addiction (Alcohol) at Rank 2",
      ],
      items: ["The Lady"],
      starCursed: ["The Star-Cursed Lady", "Addiction (Alcohol)"],
      starCursedChoices: null,
    },
    lord: {
      name: "Lord",
      img: `${imgPath}/sign-lord.webp`,
      description: `The Lord's Season is First Seed. Those born under the sign of The Lord are stronger and healthier than those born under other signs.`,
      traits: [
        "Trollkin Power: See Powers section of the Rules Compendium",
        "Star-Cursed Lord: As Above, but also gain Weakness (Fire, 2)",
      ],
      items: ["The Lord", "Trollkin"],
      starCursed: ["The Star-Cursed Lord", "Trollkin", "Weakness (Fire, 2)"],
    },
    lover: {
      name: "Lover",
      img: `${imgPath}/sign-lover.webp`,
      description: `The Lover's Season is Sun's Dawn. Those born under the sign of The Lover are graceful and passionate.`,
      traits: [
        "+5 Agility and Lover's Kiss Power: See Powers section of the Rules Compendium",
        "Star-Cursed Lover: As Above, but also gain Disease Susceptibility (Rockjoint, ±50%)",
      ],
      items: ["The Lover", "Lover's Kiss"],
      starCursed: [
        "The Star-Cursed Lover",
        "Lover's Kiss",
        "Disease Susceptibility",
      ],
      starCursedChoices: null,
    },
    mage: {
      name: "Mage",
      img: `${imgPath}/sign-mage.webp`,
      description: `The Mage is a Guardian Constellation whose Season is Rain's Hand. Those born under the Mage have more magicka and talent for all kinds of spellcasting, but are often arrogant and absent-minded.`,
      traits: [
        "Power Well (25)",
        "Star-Cursed Mage: Gain Power Well (50) instead, and also gain -5 Strength OR Endurance",
      ],
      items: ["The Mage", "Power Well (25)"],
      starCursed: ["The Star-Cursed Mage", "Power Well (50)"],
      starCursedChoices: {
        attributes: ["strength", "endurance"],
        modifier: -5,
      },
    },
    ritual: {
      name: "Ritual",
      img: `${imgPath}/sign-ritual.webp`,
      description: `The Ritual is one of the Mage's Charges and its Season is Morning Star. Those born under this sign have a variety of
                    abilities depending on the aspects of the moons and the Divines.`,
      traits: [
        "Mara's Gift Power: See Powers section of the Rules Compendium",
        "Star-Cursed Ritual: As Above, but also gain Weakness(Magic, 2)",
      ],
      items: ["The Ritual", "Mara's Gift"],
      starCursed: ["The Star-Cursed Ritual", "Mara's Gift", "Weakness (Magic, 2)"],
    },
    serpent: {
      name: "Serpent",
      img: `${imgPath}/sign-serpent.webp`,
      description: `The Serpent wanders about in the sky and has no Season, though its motions are predictable to a degree. No characteristics are common to all those born under the sign of the Serpent. Those born under this sign are the most blessed and the most cursed.`,
      traits: [
        "Star Curse Power: See Powers section of the Rules Compendium",
        "Star-Cursed Serpent: As Above, but the Trait gains Paralyze 2 instead of Paralyze 1",
      ],
      items: ["The Serpent", "Star Curse"],
      starCursed: ["The Star-Cursed Serpent"],
    },
    shadow: {
      name: "Shadow",
      img: `${imgPath}/sign-shadow.webp`,
      description: `The Shadow's Season is Second Seed. The Shadow grants those born under her sign the ability to hide in shadows.`,
      traits: [
        "Moonshadow Power: See Powers section of the Rules Compendium",
        "Star-Cursed Shadow: As Above, but also gain +5 Perception and -5 Personality OR Strength",
      ],
      items: ["The Shadow", "Moonshadow"],
      starCursed: ["The Star-Cursed Shadow", "Moonshadow"],
      starCursedChoices: {
        attributes: ["personality", "strength"],
        modifier: -5,
      },
    },
    steed: {
      name: "Steed",
      img: `${imgPath}/sign-steed.webp`,
      description: `The Steed is one of the Warrior's Charges, and her Season is Mid Year. Those born under the sign of the Steed are impatient and always hurrying from one place to another.`,
      traits: [
        "+5 Speed",
        "Star-Cursed Steed: +10 Speed and also gain -5 Willpower OR Personality",
      ],
      items: ["The Steed"],
      starCursed: ["The Star-Cursed Steed"],
      starCursedChoices: {
        attributes: ["willpower", "personality"],
        modifier: -5,
      },
    },
    thief: {
      name: "Thief",
      img: `${imgPath}/sign-thief.webp`,
      description: `The Thief is one of the Guardian Constellations, and her Season is the darkest month of Evening Star. Those born under the sign of the Thief are not typically thieves, though they take risks more often and only rarely come to harm. They will run out of luck eventually, however, and rarely live as long as those born under other signs.`,
      traits: [
        "+5 Agility, +5 Speed, and +5 Luck",
        "Star-Cursed Thief: +10 Luck, +10 Agility, +10 Speed, and also gain -5 Endurance OR Strength",
      ],
      items: ["The Thief"],
      starCursed: ["The Star-Cursed Thief"],
      starCursedChoices: {
        attributes: ["endurance", "strength"],
        modifier: -5,
      },
    },
    tower: {
      name: "Tower",
      img: `${imgPath}/sign-tower.webp`,
      description: `The Tower is one of the Thief's Charges and its Season is Frostfall. Those born under the sign of the Tower have a knack for finding gold and can open locks of all kinds.`,
      traits: [
        "Tower Key Power and Tower Warden Power: See Powers section of the Rules Compendium",
        "Star-Cursed Tower: As Above, but also gain Weakness(Magic, 1)",
      ],
      items: ["The Tower", "Tower Key", "Tower Warden"],
      starCursed: [
        "The Star-Cursed Tower",
        "Tower Key",
        "Tower Warden",
        "Weakness (Magic, 1)",
      ],
    },
    warrior: {
      name: "Warrior",
      img: `${imgPath}/sign-warrior.webp`,
      description: `The Warrior is one of the Guardian Constellations, and her Season is Last Seed. Those born under the sign of the Warrior are strong, athletic, and skilled in weapons and armor.`,
      traits: [
        "+5 Strength and +5 Endurance",
        "Star-Cursed Warrior: +10 Strength and +10 Endurance, and also gain -5 Willpower OR Intelligence",
      ],
      items: ["The Warrior"],
      starCursed: ["The Star-Cursed Warrior"],
      starCursedChoices: {
        attributes: ["willpower", "intelligence"],
        modifier: -5,
      },
    },
  };

  // Render HTML for sign cards (compact 2-column layout matching race cards)
  for (let sign in signs) {
    const s = signs[sign];
    const traitItems = s.traits.map((t) => `<li>${t}</li>`).join("");
    const normalId = `sign-${s.name}`;
    const cursedId = `sign-${s.name}-cursed`;
    const signCard = `
        <div class="uesrpg-sign-card" style="display: flex; flex-direction: row; align-items: center; border: solid 2px transparent; padding: 0 5px; width: 49%;">
            <input class="signSelect" type="radio" id="${normalId}" name="signRadio" value="${s.name}" style="display: none;">
            <input class="signSelect" type="radio" id="${cursedId}" name="signRadio" value="${s.name}|cursed" style="display: none;">
            <div style="width: 100%; height: 100%;">
                <div style="text-align: center; position: relative; top: 0;">
                    <img src="${s.img}" alt="${s.name}" height="100" width="75" style="border: none;">
                </div>
                <div style="position: relative; top: 0;">
                    <p style="text-align: center; font-size: 10px; font-style: italic; margin: 2px 0;">${s.description}</p>
                    <ul style="font-size: 11px;">
                        ${traitItems}
                    </ul>
                    <div style="text-align: center; padding: 4px 0;">
                        <label for="${normalId}" class="sign-btn" style="display: block; cursor: pointer; padding: 4px 8px; margin: 3px 0; border: 1px solid rgba(120,120,120,0.5); border-radius: 4px; background: rgba(80,80,80,0.3); font-size: 13px; font-weight: bold;">${s.name}</label>
                        <label for="${cursedId}" class="sign-btn sign-btn-cursed" style="display: block; cursor: pointer; padding: 4px 8px; margin: 3px 0; border: 1px solid rgba(160,40,40,0.5); border-radius: 4px; background: rgba(120,30,30,0.25); font-size: 12px; font-weight: 900; color: rgba(209, 15, 15, 1);">${s.name} \u2014 Star-Cursed</label>
                    </div>
                </div>
            </div>
        </div>`;
    signCards.push(signCard);
  }

  let d = new Dialog({
    title: "Birthsign Menu",
    content: `<style>
                .uesrpg-sign-card:has(input.signSelect:checked) {
                  border-color: goldenrod !important;
                  background: rgba(218, 165, 32, 0.08);
                }
                .sign-btn:hover {
                  background: rgba(120, 120, 120, 0.5) !important;
                }
                .sign-btn-cursed:hover {
                  background: rgba(160, 40, 40, 0.45) !important;
                }
                .uesrpg-sign-card:has(input.signSelect[value$="|cursed"]:checked) .sign-btn-cursed {
                  background: rgba(180, 30, 30, 0.4) !important;
                  border-color: rgba(209, 15, 15, 0.8) !important;
                }
                .uesrpg-sign-card:has(input.signSelect:not([value$="|cursed"]):checked) .sign-btn:not(.sign-btn-cursed) {
                  background: rgba(218, 165, 32, 0.25) !important;
                  border-color: goldenrod !important;
                }
              </style>
              <form style="padding: 10px;">
                <div style="border: 1px solid; background: rgba(85, 85, 85, 0.40); font-style:italic; padding: 5px; text-align: center;">
                  <div>
                      Select a Birthsign from the cards below or input your own custom birthsign label below. Leave blank if you do NOT want to use a custom birthsign.
                  </div>
                  <input type="text" id="customSign" style="width: 200px">
                </div>

                <div style="height: 500px; overflow-y: scroll;">
                    <h1 style="padding-top: 10px;">Birthsigns</h1>
                    <div style="display: flex; flex-direction: row; flex-wrap: wrap; justify-content: space-between; align-content: center; width: 100%;">
                      ${signCards.join("")}
                    </div>
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
          // Check for a selection, or show error instead
          let signSelection = [
            ...document.querySelectorAll(".signSelect"),
          ].filter((i) => i.checked);
          let customSignLabel = document.querySelector("#customSign").value;

          if (signSelection.length < 1 && customSignLabel === "") {
            ui.notifications.error(
              "Please select a birthsign or input a custom birthsign label"
            );
          }

          // Assign selected sign to actor object
          else {
            let signName;

            if (customSignLabel !== "") {
              signName = customSignLabel;
            } else {
              const rawValue = signSelection[0].value;
              const isStarCursed = rawValue.endsWith("|cursed");
              signName = isStarCursed ? rawValue.replace("|cursed", "") : rawValue;

              let selectedSign = signs[signName.toLowerCase()];

              let itemsArray = isStarCursed
                ? selectedSign.starCursed
                : selectedSign.items;

              // Loop through and add sign items to the actor sheet
              const itemsToCreate = [];
              for (let item of itemsArray) {
                const packName = "uesrpg-3ev4.signs";
                const pack = game.packs.get(packName);
                if (!pack) {
                  console.error(`Compendium "${packName}" not found`);
                  return;
                }

                await pack.getIndex();

                const entry = pack.index.find(
                  (e) => e.name.toLowerCase() === item.toLowerCase()
                );
                if (!entry) {
                  console.warn(
                    `Item "${item}" not found in "${packName}" compendium`
                  );
                  continue;
                }

                const itemDoc = await pack.getDocument(entry._id);
                if (!itemDoc) {
                  console.error(
                    `Failed to load item "${item}" from "${packName}"`
                  );
                  continue;
                }

                const itemData = itemDoc.toObject();
                // Clear ownership to make item deletable by actor owner
                delete itemData.ownership;
                itemsToCreate.push(itemData);
              }
              await requestCreateEmbeddedDocuments(sheet.actor, "Item", itemsToCreate);

              // Handle star-cursed attribute modifications
              if (isStarCursed && selectedSign.starCursedChoices) {
                const choices = selectedSign.starCursedChoices;
                if (choices.attributes && choices.attributes.length > 0) {
                  // Prompt user to select which attribute to modify
                  const attrOptions = choices.attributes
                    .map(
                      (attr) =>
                        `<option value="${attr}">${attr.charAt(0).toUpperCase() + attr.slice(1)
                        }</option>`
                    )
                    .join("");

                  await new Promise((resolve) => {
                    new Dialog({
                      title: "Star-Cursed Attribute Selection",
                      content: `<form>
                              <div class="form-group">
                                <label>Select attribute to modify by ${choices.modifier}:</label>
                                <select id="attr-select">${attrOptions}</select>
                              </div>
                            </form>`,
                      buttons: {
                        ok: {
                          label: "OK",
                          callback: async (html) => {
                            const selectedAttr =
                              html.find("#attr-select").val();
                            const currentValue =
                              sheet.actor.system.attributes[selectedAttr]?.value ||
                              0;
                            const newValue = currentValue + choices.modifier;
                            await requestUpdateDocument(sheet.actor, {
                              [`system.attributes.${selectedAttr}.value`]:
                                newValue,
                            });
                            resolve();
                          },
                        },
                      },
                      default: "ok",
                    }).render(true);
                  });
                }
              }
            }

            // Update Actor with Sign Label
            await requestUpdateDocument(sheet.actor, { "system.birthSign": signName });
          }
        },
      },
    },
    default: "two",
    close: () => {},
  });

  d.position.width = 600;
  d.position.height = 775;
  d.render(true);
}

/**
 * Show XP management menu.
 * @param {ActorSheet} sheet - The actor sheet instance
 * @param {Event} event - The triggering event
 */
export function onXPMenu(sheet, event) {
  event.preventDefault();
  let currentXP = sheet.actor.system.xp;
  let totalXP = sheet.actor.system.xpTotal;

  // Rank Objects
  const ranks = {
    apprentice: { name: "Apprentice", xp: 1000 },
    journeyman: { name: "Journeyman", xp: 2500 },
    adept: { name: "Adept", xp: 4000 },
    expert: { name: "Expert", xp: 5500 },
    master: { name: "Master", xp: 7000 },
  };

  // Create Rank table rows
  const rankRows = [];
  for (let rank in ranks) {
    const rankObject = ranks[rank];
    const row = `<tr>
                    <td>${rankObject.name}</td>
                    <td>${rankObject.xp}</td>
                </tr>`;
    rankRows.push(row);
  }

  let d = new Dialog({
    title: "Experience Menu",
    content: `<form>
                  <div style="display: flex; flex-direction: column;">

                      <div style="padding: 10px;">
                          <div style="display: flex; flex-direction: row; justify-content: space-around; background: rgba(180, 180, 180, 0.562); padding: 10px; text-align: center; border: 1px solid;">
                              <div style="width: 33.33%">
                                  <div>Current XP</div>
                                  <input type="number" id="xp" value="${sheet.actor.system.xp}">
                              </div>
                              <div style="width: 33.33%">
                                  <div>Total XP</div>
                                  <input type="number" id="xpTotal" value="${sheet.actor.system.xpTotal}">
                              </div>
                              <div style="width: 33.33%">
                                  <div>Campaign Rank</div>
                                  <div style="padding: 5px 0;">${sheet.actor.system.campaignRank}</div>
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
              </form>`,
    buttons: {
      one: {
        label: "Submit",
        callback: async (html) => {
          let xp = html.find("#xp")[0].value;
          let xpTotal = html.find("#xpTotal")[0].value;

          let rank;
          if (xpTotal < 1000) {
            rank = "Novice";
          } else if (xpTotal < 2500) {
            rank = "Apprentice";
          } else if (xpTotal < 4000) {
            rank = "Journeyman";
          } else if (xpTotal < 5500) {
            rank = "Adept";
          } else if (xpTotal < 7000) {
            rank = "Expert";
          } else {
            rank = "Master";
          }

          await requestUpdateDocument(sheet.actor, {
            "system.xp": xp,
            "system.xpTotal": xpTotal,
            "system.campaignRank": rank,
          });
        },
      },
    },
    default: "one",
    close: () => {},
  });

  d.render(true);
}
