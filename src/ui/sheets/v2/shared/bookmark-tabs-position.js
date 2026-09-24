export function syncBookmarkTabsActiveClass(sheet, group = "primary") {
  const activeTab = sheet.tabGroups?.[group];
  if (!activeTab) return;

  const selector = `nav.uesrpg-bookmark-tabs [data-group="${group}"][data-tab]`;
  for (const tab of sheet.element?.querySelectorAll?.(selector) ?? []) {
    const active = tab.dataset.tab === activeTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}
