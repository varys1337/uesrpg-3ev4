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
  const itemDoc = sheet.document;
  const actorDoc = itemDoc?.actor ?? null;
  // Return if not embedded onto Actor
  if (!itemDoc?.isEmbedded) return;

  // Create Options for Dropdown
  const modifierOptions = [];
  if (actorDoc && actorDoc.type === "Player Character") {
    const skills = [
      ...(actorDoc.itemTypes?.skill ?? []),
      ...(actorDoc.itemTypes?.magicSkill ?? []),
      ...(actorDoc.itemTypes?.combatStyle ?? [])
    ];
    for (const skill of skills) modifierOptions.push(`<option value="${skill.name}">${skill.name}</option>`);
  }

  if (actorDoc && actorDoc.type === "NPC") {
    for (const profession in actorDoc.system.professions) {
      modifierOptions.push(`<option value="${profession}">${profession}</option>`);
    }
  }

  // Open dialog for selecting skill/item to modify
  customDialog({
    layout: "workflow",
    title: "Create Modifier",
    content: `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
      <div style="background: rgba(180, 180, 180, 0.562); border: solid 1px; padding: 10px; font-style: italic;">
        ${itemDoc.name} can apply a bonus or penalty to various skills of the character that has possession of it.
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

          const current = Array.isArray(itemDoc?.system?.skillArray) ? foundry.utils.deepClone(itemDoc.system.skillArray) : [];
          const next = current.concat([{ name: sel.value, value: Number(val.value || 0) }]);
          itemDoc.update({ "system.skillArray": next });
        }
      }
    },
    defaultButton: "create",
  });
}

/**
 * @deprecated V1 DOM-injection pattern — superseded by Handlebars template rendering.
 * In AppV2 sheets, `item.system.skillArray` entries are rendered by the item template;
 * this function is retained only for legacy callers and must NOT be called from V2 sheets.
 *
 * @param {ItemSheet} sheet
 */
export function createModifierEntries(sheet) {
  const itemDoc = sheet.document;
  const actorDoc = itemDoc?.actor ?? null;
  if (!itemDoc?.system || !Array.isArray(itemDoc.system.skillArray)) return;

  for (const entry of itemDoc.system.skillArray) {
    let modItem = actorDoc ? actorDoc.items.getName(entry.name) : null;
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
  const itemDoc = sheet.document;
  const element = event.currentTarget;
  const modEntry = element.closest(".grid-container");
  if (!modEntry || !itemDoc?.system || !Array.isArray(itemDoc.system.skillArray)) return;

  const id = modEntry.getAttribute("id");
  if (!id) return;

  const current = foundry.utils.deepClone(itemDoc.system.skillArray);
  const next = current.filter(e => e?.name !== id);
  if (next.length === current.length) return;
  await itemDoc.update({ "system.skillArray": next });
}
