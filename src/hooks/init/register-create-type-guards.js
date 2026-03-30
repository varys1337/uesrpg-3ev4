import { isMassCombatEnabled } from "../../core/homebrew/settings.js";

const RETIRED_SOCIAL_ITEM_TYPES = new Set(["language", "faction"]);
const WARFARE_UNIT_TYPE = "Warfare Unit";

function pruneArrayInPlace(arr, predicate) {
  if (!Array.isArray(arr)) return;
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (predicate(arr[i])) arr.splice(i, 1);
  }
}

function pruneObjectKeys(obj, predicate) {
  if (!obj || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    if (predicate(key)) delete obj[key];
  }
}

function normalizeCreateTypeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveRenderedUiRoot(html) {
  const root = html?.[0] ?? html;
  return root instanceof HTMLElement ? root : null;
}

function retireLegacySocialItemCreateTypesInMemory() {
  const shouldPrune = (value) => RETIRED_SOCIAL_ITEM_TYPES.has(normalizeCreateTypeKey(value));

  pruneArrayInPlace(game?.documentTypes?.Item, shouldPrune);
  pruneArrayInPlace(CONFIG?.Item?.types, shouldPrune);
  pruneArrayInPlace(CONFIG?.Item?.metadata?.types, shouldPrune);
  pruneArrayInPlace(CONFIG?.Item?.documentClass?.metadata?.types, shouldPrune);
  pruneObjectKeys(CONFIG?.Item?.typeLabels, shouldPrune);
  pruneObjectKeys(CONFIG?.Item?.typeIcons, shouldPrune);
  pruneObjectKeys(CONFIG?.Item?.dataModels, shouldPrune);
}

function pruneRetiredSocialItemTypesFromCreateDialogs(html) {
  const targetRoot = resolveRenderedUiRoot(html);
  if (!targetRoot) return;

  const selects = targetRoot.querySelectorAll?.("select[name='type']");
  if (!selects?.length) return;

  for (const select of selects) {
    let changed = false;
    for (const option of Array.from(select.options ?? [])) {
      if (!RETIRED_SOCIAL_ITEM_TYPES.has(normalizeCreateTypeKey(option?.value))) continue;
      option.remove();
      changed = true;
    }
    if (!changed) continue;
    if (!RETIRED_SOCIAL_ITEM_TYPES.has(normalizeCreateTypeKey(select.value))) continue;
    const fallback = select.options?.[0]?.value ?? "";
    select.value = fallback;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function pruneWarfareUnitTypeIfDisabled() {
  if (isMassCombatEnabled()) return;

  const shouldPrune = (value) => String(value ?? "") === WARFARE_UNIT_TYPE;

  pruneArrayInPlace(game?.documentTypes?.Actor, shouldPrune);
  pruneArrayInPlace(CONFIG?.Actor?.types, shouldPrune);
  pruneArrayInPlace(CONFIG?.Actor?.metadata?.types, shouldPrune);
  pruneArrayInPlace(CONFIG?.Actor?.documentClass?.metadata?.types, shouldPrune);
  pruneObjectKeys(CONFIG?.Actor?.typeLabels, shouldPrune);
  pruneObjectKeys(CONFIG?.Actor?.typeIcons, shouldPrune);
  pruneObjectKeys(CONFIG?.Actor?.dataModels, shouldPrune);
}

function pruneWarfareUnitFromActorCreateDialogs(html) {
  if (isMassCombatEnabled()) return;
  const targetRoot = resolveRenderedUiRoot(html);
  if (!targetRoot) return;

  const selects = targetRoot.querySelectorAll?.("select[name='type']");
  if (!selects?.length) return;

  for (const select of selects) {
    let changed = false;
    for (const option of Array.from(select.options ?? [])) {
      if (String(option?.value ?? "") !== WARFARE_UNIT_TYPE) continue;
      option.remove();
      changed = true;
    }
    if (!changed) continue;
    if (select.value !== WARFARE_UNIT_TYPE) continue;
    const fallback = select.options?.[0]?.value ?? "";
    select.value = fallback;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function registerRetiredSocialCreateTypeUiGuard() {
  const guard = (_app, html) => pruneRetiredSocialItemTypesFromCreateDialogs(html);
  Hooks.on("renderDocumentDirectory", guard);
  Hooks.on("renderDialogV2", guard);
}

function registerWarfareUnitCreateTypeUiGuard() {
  const guard = (_app, html) => pruneWarfareUnitFromActorCreateDialogs(html);
  Hooks.on("renderDocumentDirectory", guard);
  Hooks.on("renderDialogV2", guard);
}

export function registerCreateTypeGuards() {
  retireLegacySocialItemCreateTypesInMemory();
  registerRetiredSocialCreateTypeUiGuard();
  Hooks.once("setup", retireLegacySocialItemCreateTypesInMemory);
  Hooks.once("ready", retireLegacySocialItemCreateTypesInMemory);

  pruneWarfareUnitTypeIfDisabled();
  registerWarfareUnitCreateTypeUiGuard();
  Hooks.once("setup", pruneWarfareUnitTypeIfDisabled);
  Hooks.once("ready", pruneWarfareUnitTypeIfDisabled);
}
