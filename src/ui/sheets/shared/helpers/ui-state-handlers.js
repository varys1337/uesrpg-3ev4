/**
 * UI state management handlers.
 * Handles group collapse, item search, and loadout save/apply/delete.
 *
 * Shared across actor sheet modules.
 */

import {
  getCollapsedGroups,
  setGroupCollapsed,
  getLoadoutsForActor,
  saveLoadoutForActor,
  deleteLoadout,
  applyLoadoutToActor
} from "../../sheet-ui-state.js";
import { setGroupCollapsedInDom } from "./collapsed-group-dom.js";
import { promptDialog, confirmDialog } from "../../../../utils/dialog-v2-helper.js";

/**
 * Toggle collapse state of a collapsible group.
 * @param {object} sheet
 * @param {Event} event
 */
export async function onToggleGroupCollapse(sheet, event, target) {
  event.preventDefault();
  event.stopPropagation();

  const el = target ?? event.currentTarget;
  const groupKey = el?.dataset?.group;
  if (!groupKey) return;

  const groups = await getCollapsedGroups();
  const next = !Boolean(groups?.[groupKey]);
  await setGroupCollapsed(groupKey, next);
  setGroupCollapsedInDom(el, next);
}

/**
 * Filter items by search query.
 * @param {object} sheet
 * @param {Event} event
 */
export function onItemSearch(sheet, event) {
  const input = event.currentTarget;
  const query = String(input?.value ?? "").trim().toLowerCase();
  const root = sheet.element;
  if (!root) return;

  const tab = root.querySelector(".tab.equipment");
  if (!tab) return;

  const items = tab.querySelectorAll("tr.item, li.item");
  for (const row of items) {
    const nameEl = row.querySelector(".item-name");
    const name = String(nameEl?.textContent ?? "").trim().toLowerCase();
    const match = !query || name.includes(query);
    row.style.display = match ? "" : "none";
  }
}

/**
 * Save current equipment configuration as a loadout.
 * @param {object} sheet
 * @param {Event} event
 */
export async function onLoadoutSave(sheet, event) {
  event.preventDefault();
  if (!sheet.actor?.isOwner) return;
  if (!game.settings.get("uesrpg-3ev4", "enableLoadouts")) return;

  const equippedIds = sheet.actor.items
    .filter(i => typeof i?.system?.equipped === "boolean" && i.system.equipped)
    .map(i => i.id);

  const name = await promptDialog({
    title: "Save Loadout",
    content: `<p>Enter a name for this loadout:</p><input type="text" name="uesrpgLoadoutName" style="width:100%" />`,
    okLabel: "Save",
    callback: (html) => {
      const el = html instanceof HTMLElement ? html : html?.[0];
      return String(el?.querySelector("input[name='uesrpgLoadoutName']")?.value ?? "").trim();
    }
  });

  if (!name) return;
  await saveLoadoutForActor(sheet.actor.id, name, equippedIds);
  sheet.render(false);
}

/**
 * Apply a saved loadout to the actor.
 * @param {object} sheet
 * @param {Event} event
 */
export async function onLoadoutApply(sheet, event) {
  event.preventDefault();
  if (!sheet.actor?.isOwner) return;
  if (!game.settings.get("uesrpg-3ev4", "enableLoadouts")) return;

  const select = sheet.element?.querySelector?.("#uesrpg-loadout-select");
  const loadoutId = select?.value;
  if (!loadoutId) return;

  const loadouts = await getLoadoutsForActor(sheet.actor.id);
  const loadout = loadouts.find(l => l.id === loadoutId);
  if (!loadout) return;
  await applyLoadoutToActor(sheet.actor, loadout.equippedIds);
  sheet.render(false);
}

/**
 * Delete a saved loadout.
 * @param {object} sheet
 * @param {Event} event
 */
export async function onLoadoutDelete(sheet, event) {
  event.preventDefault();
  if (!sheet.actor?.isOwner) return;
  if (!game.settings.get("uesrpg-3ev4", "enableLoadouts")) return;

  const select = sheet.element?.querySelector?.("#uesrpg-loadout-select");
  const loadoutId = select?.value;
  if (!loadoutId) return;

  const confirmed = await confirmDialog({
    title: "Delete Loadout",
    content: "<p>Delete the selected loadout?</p>"
  });
  if (!confirmed) return;

  await deleteLoadout(sheet.actor.id, loadoutId);
  sheet.render(false);
}
