export function syncBookmarkTabsActiveClass(sheet, group = "primary") {
  const activeTab = sheet.tabGroups?.[group];
  if (!activeTab) return;

  const nav = sheet.element?.querySelector?.(group === "actions"
    ? "nav.uesrpg-actions-tabs" : "nav.uesrpg-bookmark-tabs");
  if (!nav) return;
  for (const tab of nav.querySelectorAll(`[data-group="${group}"][data-tab]`)) {
    const active = tab.dataset.tab === activeTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    const groupBookmarks = group === "primary" && nav.classList.contains("uesrpg-group-bookmark-tabs");
    if (group !== "actions" && !groupBookmarks) continue;

    // Instance-owned ids associate tabs and panels without shared DOM state.
    const prefix = `${sheet.id}-${group}-${tab.dataset.tab}`;
    tab.id = `${prefix}-tab`;
    const panel = sheet.element.querySelector(`${groupBookmarks ? ".tab" : ".uesrpg-actions-panel"}[data-group="${group}"][data-tab="${tab.dataset.tab}"]`);
    if (!panel) continue;
    panel.id = `${prefix}-panel`;
    if (groupBookmarks) panel.setAttribute("role", "tabpanel");
    tab.setAttribute("aria-controls", panel.id);
    panel.setAttribute("aria-labelledby", tab.id);
    panel.setAttribute("aria-hidden", String(!active));
    panel.tabIndex = panel.querySelector("button:enabled, input:enabled, select:enabled, [tabindex='0']") ? -1 : 0;
  }
}

/** Manual activation: arrows move focus; Enter/Space use the native tab action. */
export function handleActionTabsKeydown(sheet, event) {
  const tab = event.target?.closest?.(".uesrpg-actions-subtab, .uesrpg-group-bookmark-tabs > [data-tab]");
  if (!tab || !sheet.element?.contains?.(tab)) return false;
  const nav = tab.closest(".uesrpg-actions-tabs, .uesrpg-group-bookmark-tabs");
  const vertical = nav?.getAttribute("aria-orientation") === "vertical";
  const previous = vertical ? "ArrowUp" : "ArrowLeft";
  const next = vertical ? "ArrowDown" : "ArrowRight";
  if (![previous, next, "Home", "End", "Enter", " "].includes(event.key)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Enter" || event.key === " ") {
    tab.click();
    return true;
  }
  const tabs = Array.from(nav?.querySelectorAll('button[data-action="tab"]:enabled') ?? []);
  if (!tabs.length) return true;
  const index = tabs.indexOf(tab);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
    : (index + (event.key === next ? 1 : -1) + tabs.length) % tabs.length;
  for (const button of tabs) button.tabIndex = button === tabs[nextIndex] ? 0 : -1;
  tabs[nextIndex].focus();
  if (vertical) tabs[nextIndex].scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}
