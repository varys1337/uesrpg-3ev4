// Actions such as enchanted-item casting also carry data-item-id; only actual
// inventory/list rows participate in search, never their nested controls.
const FILTER_ROW_SELECTOR = ".item[data-item-id], .spell-row[data-item-id], [data-list-filter-row]";

function normalizeFilterText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

function getFilterState(app) {
  if (!(app._uesrpgListFilterQueries instanceof Map)) app._uesrpgListFilterQueries = new Map();
  return app._uesrpgListFilterQueries;
}

function applyListFilter(scopeRoot, query) {
  const normalizedQuery = normalizeFilterText(query);
  const rows = Array.from(scopeRoot.querySelectorAll(FILTER_ROW_SELECTOR));
  let visibleRows = 0;

  for (const row of rows) {
    const label = row.querySelector(".item-name, .spell-name-cell, [data-list-filter-label]")?.textContent
      ?? row.textContent
      ?? "";
    const matches = !normalizedQuery || normalizeFilterText(label).includes(normalizedQuery);
    row.hidden = !matches;
    if (matches) visibleRows += 1;
  }

  for (const group of scopeRoot.querySelectorAll("[data-list-filter-group], .spell-school-section, table")) {
    if (group.matches("table") && group.closest("[data-list-filter-group]")) continue;
    const groupedRows = Array.from(group.querySelectorAll(FILTER_ROW_SELECTOR));
    group.classList.toggle("uesrpg-list-filter-empty-group", Boolean(normalizedQuery)
      && groupedRows.length > 0 && groupedRows.every((row) => row.hidden));
  }

  const empty = scopeRoot.querySelector("[data-list-filter-empty]");
  if (empty) empty.hidden = !normalizedQuery || visibleRows > 0;
}

export function bindListFilters(app, root) {
  if (!(root instanceof HTMLElement)) return;
  const state = getFilterState(app);

  for (const controls of root.querySelectorAll("[data-list-filter-controls]")) {
    const scope = String(controls.dataset.listFilterScope ?? "default");
    const scopeRoot = root.querySelector(`[data-list-filter-root="${CSS.escape(scope)}"]`)
      ?? controls.closest("[data-list-filter-root]")
      ?? root;
    const input = controls.querySelector("[data-list-filter-input]");
    const clear = controls.querySelector("[data-list-filter-clear]");
    if (!(input instanceof HTMLInputElement) || input.dataset.listFilterBound === "1") continue;

    input.dataset.listFilterBound = "1";
    input.value = state.get(scope) ?? input.value ?? "";
    const apply = () => applyListFilter(scopeRoot, input.value);
    const applyDebounced = foundry.utils.debounce(apply, 100);

    input.addEventListener("input", () => {
      state.set(scope, input.value);
      applyDebounced();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !input.value) return;
      event.preventDefault();
      input.value = "";
      state.delete(scope);
      apply();
    });
    clear?.addEventListener("click", (event) => {
      event.preventDefault();
      input.value = "";
      state.delete(scope);
      apply();
      input.focus();
    });
    apply();
  }
}

export function clearListFilterState(app) {
  app._uesrpgListFilterQueries?.clear?.();
  app._uesrpgListFilterQueries = null;
}
