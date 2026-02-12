/**
 * UI state management handlers.
 * Handles group collapse, item search, and loadout save/apply/delete.
 *
 * Target: Foundry VTT v13 (AppV1 ActorSheet).
 */

import {
  getCollapsedGroups,
  setGroupCollapsed,
  getLoadoutsForActor,
  saveLoadoutForActor,
  deleteLoadout,
  applyLoadoutToActor
} from "../../sheet-ui-state.js";

/**
 * Toggle collapse state of a collapsible group.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onToggleGroupCollapse(sheet, event) {
  event.preventDefault();
  event.stopPropagation();

  const el = event.currentTarget;
  const groupKey = el?.dataset?.group;
  if (!groupKey) return;

  const groups = await getCollapsedGroups();
  const next = !Boolean(groups?.[groupKey]);
  await setGroupCollapsed(groupKey, next);
  sheet._setGroupCollapsedInDom(el, next);
}

/**
 * Filter items by search query.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export function onItemSearch(sheet, event) {
  const input = event.currentTarget;
  const query = String(input?.value ?? "").trim().toLowerCase();
  const root = sheet.element?.[0];
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
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onLoadoutSave(sheet, event) {
  event.preventDefault();
  if (!sheet.actor?.isOwner) return;
  if (!game.settings.get("uesrpg-3ev4", "enableLoadouts")) return;

  const equippedIds = sheet.actor.items
    .filter(i => typeof i?.system?.equipped === "boolean" && i.system.equipped)
    .map(i => i.id);

  const name = await Dialog.prompt({
    title: "Save Loadout",
    content: `<p>Enter a name for this loadout:</p><input type="text" name="uesrpgLoadoutName" style="width:100%" />`,
    label: "Save",
    callback: (html) => String(html.find("input[name='uesrpgLoadoutName']").val() ?? "").trim()
  });

  if (!name) return;
  await saveLoadoutForActor(sheet.actor.id, name, equippedIds);
  sheet.render(false);
}

/**
 * Apply a saved loadout to the actor.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onLoadoutApply(sheet, event) {
  event.preventDefault();
  if (!sheet.actor?.isOwner) return;
  if (!game.settings.get("uesrpg-3ev4", "enableLoadouts")) return;

  const select = sheet.element?.find?.("#uesrpg-loadout-select")?.[0];
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
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onLoadoutDelete(sheet, event) {
  event.preventDefault();
  if (!sheet.actor?.isOwner) return;
  if (!game.settings.get("uesrpg-3ev4", "enableLoadouts")) return;

  const select = sheet.element?.find?.("#uesrpg-loadout-select")?.[0];
  const loadoutId = select?.value;
  if (!loadoutId) return;

  const confirmed = await Dialog.confirm({
    title: "Delete Loadout",
    content: "<p>Delete the selected loadout?</p>"
  });
  if (!confirmed) return;

  await deleteLoadout(sheet.actor.id, loadoutId);
  sheet.render(false);
}
