/**
 * Equipment and item creation dialogs/handlers.
 *
 * Shared across actor sheet modules.
 */

import { requestCreateEmbeddedDocuments, requestUpdateEmbeddedDocuments } from "../../../../utils/authority-proxy.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import {
  TALENT_LEARNING_MODE,
  validateTalentLearning,
  notifyTalentLearningResult,
} from "../../../../core/traits/talent-learning.js";

/**
 * Handle item creation from sheet "+" buttons.
 *
 * Options are used to preserve legacy behavior across PC/NPC sheets.
 *
 * @param {object} sheet
 * @param {Event} event
 * @param {object} [options]
 * @param {string|null} [options.baseCha="str"] If null, does not set system.baseCha on created items.
 * @param {boolean} [options.includeCombatStyleSeed=true] Whether to apply combatStyle seed fields.
 * @param {boolean} [options.includeMagicSkillSeed=true] Whether to apply magicSkill seed fields.
 */
export async function onItemCreate(sheet, event, {
  baseCha = "str",
  includeCombatStyleSeed = true,
  includeMagicSkillSeed = true,
  target = null,
} = {}) {
  event?.preventDefault?.();

  if (!sheet?.actor) return;

  const element = target ?? event?.currentTarget;
  const type = String(element?.id ?? "").trim();
  if (!type) return;

  let itemData = baseCha === null
    ? [{ name: type, type }]
    : [{ name: type, type, "system.baseCha": baseCha }];

  // Special case: createSelect opens a type picker dialog
  if (type === "createSelect") {
    await customDialog({
      title: "Create Item",
      content: `<div style="padding: 10px 0;">
                  <h2>Select an Item Type</h2>
                  <label>Create an item on this sheet</label>
                </div>`,
      buttons: {
        equipment: {
          label: "Equipment",
          callback: async () => {
            const created = await requestCreateEmbeddedDocuments(sheet.actor, "Item", [{ name: "equipment", type: "equipment" }]);
            await created?.[0]?.sheet?.render?.(true);
          },
        },
        scroll: {
          label: "Scroll",
          callback: async () => {
            const created = await requestCreateEmbeddedDocuments(sheet.actor, "Item", [{ name: "scroll", type: "scroll" }]);
            await created?.[0]?.sheet?.render?.(true);
          },
        },
        ammunition: {
          label: "Ammunition",
          callback: async () => {
            const created = await requestCreateEmbeddedDocuments(sheet.actor, "Item", [{ name: "ammunition", type: "ammunition" }]);
            await created?.[0]?.sheet?.render?.(true);
          },
        },
        armor: {
          label: "Armor",
          callback: async () => {
            const created = await requestCreateEmbeddedDocuments(sheet.actor, "Item", [{ name: "armor", type: "armor" }]);
            await created?.[0]?.sheet?.render?.(true);
          },
        },
        shield: {
          label: "Shield",
          callback: async () => {
            const created = await requestCreateEmbeddedDocuments(sheet.actor, "Item", [{ name: "shield", type: "shield" }]);
            await created?.[0]?.sheet?.render?.(true);
          },
        },
        weapon: {
          label: "Weapon",
          callback: async () => {
            const created = await requestCreateEmbeddedDocuments(sheet.actor, "Item", [{ name: "weapon", type: "weapon" }]);
            await created?.[0]?.sheet?.render?.(true);
          },
        },
        cancel: { label: "Cancel" },
      },
      defaultButton: "equipment",
    });
    return;
  }

  if (includeCombatStyleSeed && type === "combatStyle") {
    itemData = [
      {
        name: "Combat Style Name",
        type,
        img: "systems/uesrpg-3ev4/images/Icons/backToBack.webp",
        "system.governingCha": "Str, Agi",
        "system.baseCha":
          (sheet.actor.system?.characteristics?.str?.total ?? 0) >= (sheet.actor.system?.characteristics?.agi?.total ?? 0)
            ? "str"
            : "agi",
      },
    ];
  }

  if (includeMagicSkillSeed && type === "magicSkill") {
    itemData = [
      {
        name: "Magic School Name",
        type,
        img: "systems/uesrpg-3ev4/images/spell-compendium/mysticism_spellbook.webp",
        "system.governingCha": "Wp",
        "system.baseCha":
          (sheet.actor.system?.characteristics?.int?.total ?? 0) >= (sheet.actor.system?.characteristics?.wp?.total ?? 0)
            ? "wp"
            : "int",
      },
    ];
  }

  if (type === "talent" && sheet.actor?.type === "Player Character" && itemData?.[0]) {
    const validation = validateTalentLearning(sheet.actor, itemData[0], { source: "sheetCreate" });
    if (validation.mode === TALENT_LEARNING_MODE.WARN) {
      notifyTalentLearningResult(validation);
    }
    if (validation.mode === TALENT_LEARNING_MODE.ENFORCE && !validation.ok) {
      notifyTalentLearningResult(validation, { force: true });
      return;
    }
  }

  const created = await requestCreateEmbeddedDocuments(sheet.actor, "Item", itemData);
  await created?.[0]?.sheet?.render?.(true);
}

/**
 * Handle "+ Profession" button on PC sheet.
 * Prompts for a field name and creates a skill item representing a Profession field.
 *
 * @param {object} sheet
 * @param {Event} event
 */
export async function onProfessionCreate(sheet, event) {
  event?.preventDefault?.();
  if (!sheet?.actor) return;

  let fieldName = null;
  try {
    fieldName = await customDialog({
      title: "Add Profession Field",
      content: `<div class="uesrpg-skill-roll">
        <div class="form-group">
          <label><b>Field Name</b></label>
          <input type="text" name="fieldName" placeholder="e.g. Smithing" style="width:100%;" autofocus />
        </div>
      </div>`,
      buttons: {
        ok: {
          label: "Create",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            return root?.querySelector('input[name="fieldName"]')?.value?.trim() || null;
          }
        },
        cancel: { label: "Cancel", callback: () => null }
      },
      default: "ok",
      width: 360
    });
  } catch (_e) {
    return;
  }

  if (!fieldName) return;

  const created = await requestCreateEmbeddedDocuments(sheet.actor, "Item", [{
    name: `Profession [${fieldName}]`,
    type: "skill",
    "system.isProfession": true,
    "system.field": fieldName,
    "system.baseCha": "int",
    "system.governingCha": "Int"
  }]);
  await created?.[0]?.sheet?.render?.(true);
}

/**
 * Open an equip/unequip dialog for a filtered list of items.
 *
 * This is currently used by the NPC sheet's ".equip-items" controls.
 *
 * @param {object} sheet
 * @param {Event} event
 */
export async function onEquipItems(sheet, event) {
  event?.preventDefault?.();
  if (!sheet?.actor) return;

  const element = event.currentTarget;
  const type = String(element?.id ?? "").trim();
  const altType = String(element?.dataset?.altType ?? "").trim();

  const itemList = sheet.actor.items.filter((item) => {
    if (!item) return false;
    if (item.type === type) return true;
    if (altType && item.type === altType && item.system?.wearable) return true;
    return false;
  });

  if (itemList.length === 0) {
    return ui.notifications.info(`${sheet.actor.name} does not have any items of this type to equip.`);
  }

  const itemEntries = [];
  let tableHeader = "";
  let tableEntry = "";

  for (const item of itemList) {
    switch (item.type) {
      case "shield":
        tableEntry = `<tr>
                            <td data-item-id="${item._id}">
                                <div style="display: flex; flex-direction: row; align-items: center; gap: 5px;">
                                  <img class="item-img" src="${item.img}" height="24" width="24">
                                  ${item.name}
                                </div>
                            </td>
                            <td style="text-align: center;">${item.system.blockRatingEffective ?? item.system.blockRating ?? 0}</td>
                            <td style="text-align: center;">${item.system.magic_brEffective ?? item.system.magic_br ?? 0}</td>
                            <td style="text-align: center;">${item.system.shieldType ?? "normal"}</td>
                            <td style="text-align: center;">
                                <input type="checkbox" class="itemSelect" data-item-id="${item._id}" ${item.system.equipped ? "checked" : ""}>
                            </td>
                        </tr>`;
        break;

      case "armor":
      case "equipment":
        tableEntry = `<tr>
                            <td data-item-id="${item._id}">
                                <div style="display: flex; flex-direction: row; align-items: center; gap: 5px;">
                                  <img class="item-img" src="${item.img}" height="24" width="24">
                                  ${item.name}
                                </div>
                            </td>
                            <td style="text-align: center;">${item.system.armor}</td>
                            <td style="text-align: center;">${item.system.magic_ar}</td>
                            <td style="text-align: center;">${item.system.blockRating}</td>
                            <td style="text-align: center;">
                                <input type="checkbox" class="itemSelect" data-item-id="${item._id}" ${item.system.equipped ? "checked" : ""}>
                            </td>
                        </tr>`;
        break;

      case "weapon":
        tableEntry = `<tr>
                            <td data-item-id="${item._id}">
                                <div style="display: flex; flex-direction: row; align-items: center; gap: 5px;">
                                  <img class="item-img" src="${item.img}" height="24" width="24">
                                  ${item.name}
                                </div>
                            </td>
                            <td style="text-align: center;">${item.system.damage}</td>
                            <td style="text-align: center;">${item.system.damage2}</td>
                            <td style="text-align: center;">${item.system.reach}</td>
                            <td style="text-align: center;">
                                <input type="checkbox" class="itemSelect" data-item-id="${item._id}" ${item.system.equipped ? "checked" : ""}>
                            </td>
                        </tr>`;
        break;

      case "ammunition":
        tableEntry = `<tr>
                            <td data-item-id="${item._id}">
                                <div style="display: flex; flex-direction: row; align-items: center; gap: 5px;">
                                  <img class="item-img" src="${item.img}" height="24" width="24">
                                  ${item.name}
                                </div>
                            </td>
                            <td style="text-align: center;">${item.system.quantity}</td>
                            <td style="text-align: center;">${item.system.damage}</td>
                            <td style="text-align: center;">${item.system.enchant_level}</td>
                            <td style="text-align: center;">
                                <input type="checkbox" class="itemSelect" data-item-id="${item._id}" ${item.system.equipped ? "checked" : ""}>
                            </td>
                        </tr>`;
        break;

      default:
        continue;
    }

    itemEntries.push(tableEntry);
  }

  switch (itemList[0].type) {
    case "shield":
      tableHeader = `<div>
                          <div style="padding: 5px 0;">
                              <label>Selecting nothing will unequip all items</label>
                          </div>

                          <div>
                              <table>
                                  <thead>
                                      <tr>
                                          <th>Name</th>
                                          <th>BR</th>
                                          <th>MBR</th>
                                          <th>Type</th>
                                          <th>Equipped</th>
                                      </tr>
                                  </thead>
                                  <tbody>
                                      ${itemEntries.join("")}
                                  </tbody>
                              </table>
                          </div>
                      </div>`;
      break;

    case "armor":
    case "equipment":
      tableHeader = `<div>
                          <div style="padding: 5px 0;">
                              <label>Selecting nothing will unequip all items</label>
                          </div>

                          <div>
                              <table>
                                  <thead>
                                      <tr>
                                          <th>Name</th>
                                          <th>AR</th>
                                          <th>MR</th>
                                          <th>BR</th>
                                          <th>Equipped</th>
                                      </tr>
                                  </thead>
                                  <tbody>
                                      ${itemEntries.join("")}
                                  </tbody>
                              </table>
                          </div>
                      </div>`;
      break;

    case "weapon":
      tableHeader = `<div>
                          <div style="padding: 5px 0;">
                              <label>Selecting nothing will unequip all items</label>
                          </div>

                          <div>
                              <table>
                                  <thead>
                                      <tr>
                                          <th>Name</th>
                                          <th>1H</th>
                                          <th>2H</th>
                                          <th>Reach</th>
                                          <th>Equipped</th>
                                      </tr>
                                  </thead>
                                  <tbody>
                                      ${itemEntries.join("")}
                                  </tbody>
                              </table>
                          </div>
                      </div>`;
      break;

    case "ammunition":
      tableHeader = `<div>
                        <div style="padding: 5px 0;">
                            <label>Selecting nothing will unequip all items</label>
                        </div>

                        <div>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Qty</th>
                                        <th>Damage</th>
                                        <th>Enchant</th>
                                        <th>Equipped</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itemEntries.join("")}
                                </tbody>
                            </table>
                        </div>
                    </div>`;
      break;
    default:
      break;
  }

  await customDialog({
    title: "Item List",
    content: tableHeader,
    yes: {
      label: "Submit",
      callback: async (dialogHtml) => {
        const root = dialogHtml instanceof HTMLElement ? dialogHtml : dialogHtml?.[0];
        const selected = [...(root?.querySelectorAll(".itemSelect") ?? [])];

        const updates = [];
        for (const checkbox of selected) {
          const itemId = String(checkbox?.dataset?.itemId ?? "").trim();
          if (!itemId) continue;

          updates.push({ _id: itemId, "system.equipped": Boolean(checkbox.checked) });
        }

        if (!updates.length) return;
        await requestUpdateEmbeddedDocuments(sheet.actor, "Item", updates);
      },
    },
    no: { label: "Cancel" },
    defaultButton: "yes",
    width: 500,
  });
}
