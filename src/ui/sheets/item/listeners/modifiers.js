/**
 * src/ui/sheets/item/listeners/modifiers.js
 * Modifier entry CRUD handlers for item sheets
 */

import { customDialog } from "../../../../utils/dialog-v2-helper.js";

/**
 * Handler: Create a new modifier entry
 *
 * @param {ItemSheet} sheet
 * @param {Event} event
 */
export function onModifierCreate(sheet, event) {
  event.preventDefault();
  // Return if not embedded onto Actor
  if (!sheet.document.isEmbedded) return;

  // Create Options for Dropdown
  const modifierOptions = [];
  if (sheet.actor && sheet.actor.type === "Player Character") {
    const skills = [
      ...(sheet.actor.itemTypes?.skill ?? []),
      ...(sheet.actor.itemTypes?.magicSkill ?? []),
      ...(sheet.actor.itemTypes?.combatStyle ?? [])
    ];
    for (const skill of skills) modifierOptions.push(`<option value="${skill.name}">${skill.name}</option>`);
  }

  if (sheet.actor && sheet.actor.type === "NPC") {
    for (const profession in sheet.actor.system.professions) {
      modifierOptions.push(`<option value="${profession}">${profession}</option>`);
    }
  }

  // Open dialog for selecting skill/item to modify
  customDialog({
    title: "Create Modifier",
    content: `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
      <div style="background: rgba(180, 180, 180, 0.562); border: solid 1px; padding: 10px; font-style: italic;">
        ${sheet.item.name} can apply a bonus or penalty to various skills of the character that has possession of it.
        Select a skill, then apply the modifier.
      </div>
      <div style="padding: 5px; display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 5px; text-align: center;">
        <select id="modifierSelect" name="modifierSelect">
          ${modifierOptions.join("")}
        </select>
        <input id="modifier-value" type="number" value="0">
      </div>
    </div>`,
    buttons: {
      cancel: { label: "Cancel" },
      create: {
        label: "Create",
        callback: (html) => {
          const sel = html.querySelector("#modifierSelect");
          const val = html.querySelector("#modifier-value");
          if (!sel || !val) return;

          const current = Array.isArray(sheet.item?.system?.skillArray) ? foundry.utils.deepClone(sheet.item.system.skillArray) : [];
          const next = current.concat([{ name: sel.value, value: Number(val.value || 0) }]);
          sheet.item.update({ "system.skillArray": next });
        }
      }
    },
    defaultButton: "create",
  });
}

/**
 * Create modifier entry DOM elements in the sheet
 *
 * @param {ItemSheet} sheet
 */
export function createModifierEntries(sheet) {
  if (!sheet.item || !sheet.item.system || !Array.isArray(sheet.item.system.skillArray)) return;

  for (const entry of sheet.item.system.skillArray) {
    let modItem = sheet.actor ? sheet.actor.items.getName(entry.name) : null;
    modItem = modItem || entry.name;

    const entryElement = document.createElement("div");
    entryElement.classList.add("grid-container");
    entryElement.id = entry.name;
    entryElement.innerHTML = `<div>${(modItem && modItem.name !== undefined) ? modItem.name : entry.name}</div>
      <div class="right-align-content">
        <div class="item-controls">
          <div>${entry.value}%</div>
          <a class="item-control item-delete" title="Delete Item"><i class="fas fa-trash"></i></a>
        </div>
      </div>`;
    if (sheet.form) {
      const container = sheet.form.querySelector("#item-modifiers");
      if (container) container.append(entryElement);
    }
  }
}

/**
 * Handler: Delete a modifier entry
 *
 * @param {ItemSheet} sheet
 * @param {Event} event
 */
export async function onDeleteModifier(sheet, event) {
  event.preventDefault();
  const element = event.currentTarget;
  const modEntry = element.closest(".grid-container");
  if (!modEntry || !sheet.item || !sheet.item.system || !Array.isArray(sheet.item.system.skillArray)) return;

  const id = modEntry.getAttribute("id");
  if (!id) return;

  const current = foundry.utils.deepClone(sheet.item.system.skillArray);
  const next = current.filter(e => e?.name !== id);
  if (next.length === current.length) return;
  await sheet.item.update({ "system.skillArray": next });
}

/**
 * Register modifier-related listeners
 *
 * @param {ItemSheet} sheet
 * @param {jQuery} html
 */
export function registerModifierListeners(sheet, html) {
  // Register listeners for items that have modifier arrays
  if (sheet.item && sheet.item.system && Object.prototype.hasOwnProperty.call(sheet.item.system, "skillArray")) {
    html.find(".modifier-create").click((ev) => onModifierCreate(sheet, ev));
    createModifierEntries(sheet);
    html.find(".item-delete").click((ev) => onDeleteModifier(sheet, ev));
  }
}
