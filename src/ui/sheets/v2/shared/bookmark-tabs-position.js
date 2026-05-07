export function syncBookmarkTabsActiveClass(sheet, group = "primary") {
  const activeTab = sheet.tabGroups?.[group];
  if (!activeTab) return;

  const selector = `nav.uesrpg-bookmark-tabs [data-group="${group}"][data-tab]`;
  for (const tab of sheet.element?.querySelectorAll?.(selector) ?? []) {
    tab.classList.toggle("active", tab.dataset.tab === activeTab);
  }
}
