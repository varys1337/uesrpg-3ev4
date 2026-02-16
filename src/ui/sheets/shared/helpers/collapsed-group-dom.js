/**
 * Collapsible group helpers shared between PC and NPC actor sheets.
 *
 * Handles restoring collapsed/expanded state of inventory groups,
 * spell school sections, and trait/talent/power containers.
 *
 * Uses vanilla DOM APIs — no jQuery dependency.
 */

import { getCollapsedGroups } from "../../sheet-ui-state.js";

/**
 * Apply collapsed group state to the sheet DOM.
 * Reads the persisted collapsed-groups settings and updates the DOM accordingly.
 *
 * Fire-and-forget (async but does not block rendering).
 *
 * @param {HTMLElement} el - The sheet's root DOM element
 * @param {object} sheet - The sheet instance (for `_setGroupCollapsedInDom` binding)
 */
export async function applyCollapsedGroups(el) {
  if (!el) return;
  const groups = await getCollapsedGroups();
  const toggles = el.querySelectorAll(".uesrpg-group-toggle");
  for (const toggle of toggles) {
    const key = String(toggle?.dataset?.group ?? "").trim();
    if (!key) continue;
    const collapsed = Boolean(groups?.[key]);
    setGroupCollapsedInDom(toggle, collapsed);
  }
}

/**
 * Set a single group toggle element's collapsed/expanded state in the DOM.
 *
 * @param {HTMLElement} toggleEl - The toggle button/element
 * @param {boolean} collapsed - Whether the group should be collapsed
 */
export function setGroupCollapsedInDom(toggleEl, collapsed) {
  if (!toggleEl) return;

  const icon = toggleEl.querySelector("i");
  if (icon) {
    const isCaret = icon.classList.contains("fa-caret-down") || icon.classList.contains("fa-caret-right");
    if (isCaret) {
      icon.classList.remove("fa-caret-down", "fa-caret-right");
      icon.classList.add(collapsed ? "fa-caret-right" : "fa-caret-down");
    } else {
      icon.classList.remove("fa-chevron-down", "fa-chevron-right");
      icon.classList.add(collapsed ? "fa-chevron-right" : "fa-chevron-down");
    }
  }

  const spellSchool = toggleEl.closest(".spell-school-section");
  if (spellSchool) {
    const table = spellSchool.querySelector(".spell-school-table");
    if (table) table.style.display = collapsed ? "none" : "";
    return;
  }

  const collapsible = toggleEl.closest(".uesrpg-collapsible");
  if (collapsible) {
    const body = collapsible.querySelector(".uesrpg-collapse-body");
    if (body) body.style.display = collapsed ? "none" : "";
    return;
  }

  const table = toggleEl.closest("table");
  if (table) {
    const tbody = table.querySelector("tbody");
    if (tbody) tbody.style.display = collapsed ? "none" : "";
    return;
  }

  const section = toggleEl.closest(".social-field, .trait-container, .talent-container, .power-container");
  if (section) {
    const body = section.querySelector(".social-field__body, ol, ul");
    if (body) body.style.display = collapsed ? "none" : "";
  }
}
