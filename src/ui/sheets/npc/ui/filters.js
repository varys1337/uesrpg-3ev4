/**
 * NPC sheet UI filter helpers.
 * Handles item filtering and status tag updates.
 * 
 * Foundry VTT v13 / AppV1-compatible.
 */

/**
 * Create item filter dropdown options dynamically based on actor's unequipped items.
 * @param {npcSheet} sheet - The NPC sheet instance
 */
export function createItemFilterOptions(sheet) {
  const filterEl = sheet.form?.querySelector?.("#itemFilter");
  if (!filterEl) return;

  for (let item of sheet.actor.items.filter(
    (i) => i?.system && Object.prototype.hasOwnProperty.call(i.system, "equipped") && i.system.equipped === false
  )) {
    if ([...filterEl.querySelectorAll("option")].some((i) => i.innerHTML === item.type)) continue;

    const option = document.createElement("option");
    option.innerHTML = item.type === "ammunition" ? "ammo" : item.type;
    option.value = item.type;
    filterEl.append(option);
  }
}

/**
 * Handle item filter dropdown change event.
 * Shows/hides items in the equipment list based on selected filter.
 * @param {npcSheet} sheet - The NPC sheet instance
 * @param {Event} event - The filter change event
 */
export function filterItems(sheet, event) {
  event.preventDefault();
  let filterBy = event.currentTarget.value;

  for (let item of [
    ...sheet.form.querySelectorAll(".equipmentList tbody .item"),
  ]) {
    switch (filterBy) {
      case "All":
        item.classList.add("active");
        sessionStorage.setItem("savedItemFilter", filterBy);
        break;

      case `${filterBy}`:
        filterBy == item.dataset.itemType
          ? item.classList.add("active")
          : item.classList.remove("active");
        sessionStorage.setItem("savedItemFilter", filterBy);
        break;
    }
  }
}

/**
 * Restore previously selected item filter from session storage.
 * Called during sheet render to maintain filter state across refreshes.
 * @param {npcSheet} sheet - The NPC sheet instance
 */
export function setDefaultItemFilter(sheet) {
  const filterEl = sheet.form?.querySelector?.("#itemFilter");
  if (!filterEl) return;

  let filterBy = sessionStorage.getItem("savedItemFilter");
  if (filterBy !== null && filterBy !== undefined) {
    filterEl.value = filterBy;
    for (let item of [
      ...sheet.form.querySelectorAll(".equipmentList tbody .item"),
    ]) {
      switch (filterBy) {
        case "All":
          item.classList.add("active");
          sessionStorage.setItem("savedItemFilter", filterBy);
          break;

        case `${filterBy}`:
          filterBy == item.dataset.itemType
            ? item.classList.add("active")
            : item.classList.remove("active");
          sessionStorage.setItem("savedItemFilter", filterBy);
          break;
      }
    }
  }
}

/**
 * Update status indicator tags (wound, fatigue) based on actor state.
 * Adds/removes 'active' class to show visual indicators in NPC sheet header.
 * @param {npcSheet} sheet - The NPC sheet instance
 */
export function createStatusTags(sheet) {
  const actorSys = sheet.actor?.system || {};
  const woundIcon = sheet.form.querySelector("#wound-icon");
  const fatigueIcon = sheet.form.querySelector("#fatigue-icon");

  if (woundIcon) {
    Number(actorSys?.woundPenalty ?? 0) !== 0
      ? woundIcon.classList.add("active")
      : woundIcon.classList.remove("active");
  }

  if (fatigueIcon) {
    Number(actorSys?.fatigue?.level ?? 0) > 0
      ? fatigueIcon.classList.add("active")
      : fatigueIcon.classList.remove("active");
  }
}
