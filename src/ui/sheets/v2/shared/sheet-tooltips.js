import UESRPG from "../../../../core/constants.js";
import { ITEM_QUALITY_LABELS } from "../../../../core/config/label-catalog.js";
import { SPECIAL_ACTIONS_BY_ID, getSpecialActionById } from "../../../../core/config/special-actions.js";
import { alertDialog } from "../../../../utils/dialog-v2-helper.js";
import {
  buildQualityTooltipText,
  buildQualityHelpText,
  buildSpecialActionTooltipText,
  buildSpecialActionHelpText,
  buildCombatActionTooltipText,
  buildCombatActionHelpText,
} from "../../../../data/tooltips/index.js";

const SYSTEM_ID = "uesrpg-3ev4";
const SETTING_KEY = "enableInlineRulesTooltips";

const DATA_HELP = "data-uesrpg-inline-help";
const DATA_HELP_LABEL = "data-uesrpg-inline-help-label";
const DATA_HELP_TEXT = "data-uesrpg-inline-help-text";
const DATA_HELP_DIALOG_TEXT = "data-uesrpg-inline-help-dialog-text";
const DATA_HELP_PREV_TITLE = "data-uesrpg-inline-help-prev-title";
const DATA_HELP_HAD_TITLE = "data-uesrpg-inline-help-had-title";
const EMPTY_HELP_FALLBACK = "Rules reference available in the UESRPG compendium.";

const _tooltipStateBySheet = new WeakMap();

function _isInlineHelpEnabled() {
  try {
    return Boolean(game?.settings?.get?.(SYSTEM_ID, SETTING_KEY));
  } catch (_e) {
    return false;
  }
}

function _escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function _humanizeIdentifier(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unknown";
  const spaced = raw
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function _getQualityLabelMap(itemType) {
  // Primary source: centralized label catalog (covers all quality + trait keys).
  const map = new Map(Object.entries(ITEM_QUALITY_LABELS));
  // Supplement with any catalog keys the label map might not cover (forward-compat).
  const core = UESRPG?.QUALITIES_CORE_BY_TYPE?.[itemType] ?? [];
  const traits = UESRPG?.TRAITS_BY_TYPE?.[itemType] ?? [];
  for (const entry of [...core, ...traits]) {
    const key = String(entry?.key ?? "").trim();
    if (!key || map.has(key)) continue;
    map.set(key, key);
  }
  return map;
}

function _annotateElement(element, { label, text, dialogText }, annotatedElements) {
  if (!(element instanceof HTMLElement)) return;
  if (!element.hasAttribute(DATA_HELP_HAD_TITLE)) {
    const hadTitle = element.hasAttribute("title");
    element.setAttribute(DATA_HELP_HAD_TITLE, hadTitle ? "1" : "0");
    if (hadTitle) {
      element.setAttribute(DATA_HELP_PREV_TITLE, element.getAttribute("title") ?? "");
    }
  }
  element.setAttribute("title", text);
  element.setAttribute(DATA_HELP, "true");
  element.setAttribute(DATA_HELP_LABEL, label);
  element.setAttribute(DATA_HELP_TEXT, text);
  element.setAttribute(DATA_HELP_DIALOG_TEXT, String(dialogText ?? text));
  annotatedElements.add(element);
}

function _findHelpContainer(inputEl, preferredSelector) {
  if (!(inputEl instanceof Element)) return null;
  return inputEl.closest(preferredSelector) ?? inputEl.parentElement;
}

function _extractInputSuffix(inputName, prefix) {
  const raw = String(inputName ?? "");
  if (!raw.startsWith(prefix)) return "";
  return raw.slice(prefix.length).trim();
}

function _bindQualityTooltips(rootEl, itemType, annotatedElements) {
  const labelMap = _getQualityLabelMap(itemType);
  const qualityInputSelectors = [
    'input[name^="qualitiesStructured.toggle."]',
    'input[name^="qualitiesStructured.value."]',
    'input[name^="qualitiesTraits.toggle."]',
  ].join(", ");

  const qualityInputs = rootEl.querySelectorAll(qualityInputSelectors);
  for (const input of qualityInputs) {
    const name = String(input.getAttribute("name") ?? "");
    const prefix = name.startsWith("qualitiesTraits.toggle.")
      ? "qualitiesTraits.toggle."
      : name.startsWith("qualitiesStructured.toggle.")
        ? "qualitiesStructured.toggle."
        : "qualitiesStructured.value.";
    const key = _extractInputSuffix(name, prefix);
    if (!key) continue;

    const label = labelMap.get(key) ?? _humanizeIdentifier(key);
    const text = buildQualityTooltipText({ label, key, itemType });
    const dialogText = buildQualityHelpText({ label, key, itemType });
    const containerSelector = prefix === "qualitiesTraits.toggle."
      ? ".uesrpg-pill"
      : ".structured-qualities-cell";
    const container = _findHelpContainer(input, containerSelector);
    if (!container) continue;

    _annotateElement(container, { label, text, dialogText }, annotatedElements);
  }
}

function _bindSpecialActionTooltips(rootEl, annotatedElements) {
  const actionInputs = rootEl.querySelectorAll('input[name^="system.specialAdvantages."]');
  for (const input of actionInputs) {
    const id = _extractInputSuffix(input.getAttribute("name"), "system.specialAdvantages.");
    if (!id) continue;

    const def = getSpecialActionById(id) ?? SPECIAL_ACTIONS_BY_ID?.[id] ?? null;
    const name = String(def?.name ?? _humanizeIdentifier(id));
    const actionType = String(def?.actionType ?? "primary/secondary");
    const text = buildSpecialActionTooltipText({ name, id, actionType });
    const dialogText = buildSpecialActionHelpText({ name, id });
    const container = _findHelpContainer(input, ".uesrpg-combatstyle-special");
    if (!container) continue;

    _annotateElement(container, { label: name, text, dialogText }, annotatedElements);
  }
}

function _bindCombatActionTooltips(rootEl, annotatedElements) {
  const quickActionButtons = rootEl.querySelectorAll('button[data-action="combatQuickAction"][data-combat-action]');
  for (const button of quickActionButtons) {
    const actionId = String(button.getAttribute("data-combat-action") ?? "").trim();
    if (!actionId) continue;

    const label = String(button.getAttribute("data-label") ?? button.textContent ?? actionId).trim();

    if (actionId === "specialAction") {
      const specialId = String(button.getAttribute("data-special-id") ?? "").trim();
      const actionType = String(button.getAttribute("data-action-type") ?? "primary/secondary").trim();
      const specialLabel = label || _humanizeIdentifier(specialId || actionId);
      const text = buildSpecialActionTooltipText({ name: specialLabel, id: specialId || actionId, actionType });
      const dialogText = buildSpecialActionHelpText({ name: specialLabel, id: specialId || actionId });
      _annotateElement(button, { label: specialLabel, text, dialogText }, annotatedElements);
      continue;
    }

    const text = buildCombatActionTooltipText({ label, actionId });
    const dialogText = buildCombatActionHelpText({ label, actionId });
    _annotateElement(button, { label, text, dialogText }, annotatedElements);
  }

  const castMagicButtons = rootEl.querySelectorAll('button[data-action="castMagic"]');
  for (const button of castMagicButtons) {
    const actionType = String(button.getAttribute("data-action-type") ?? "").trim().toLowerCase();
    const actionId = actionType === "secondary" ? "castMagicSecondary" : "castMagicPrimary";
    const label = String(button.textContent ?? "Cast Magic").trim() || "Cast Magic";
    const text = buildCombatActionTooltipText({ label, actionId });
    const dialogText = buildCombatActionHelpText({ label, actionId });
    _annotateElement(button, { label, text, dialogText }, annotatedElements);
  }
}

function _buildAltClickHandler(rootEl) {
  return (event) => {
    if (!event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const helpEl = target?.closest?.(`[${DATA_HELP}="true"]`);
    if (!helpEl || !(rootEl instanceof Element) || !rootEl.contains(helpEl)) return;

    event.preventDefault();
    event.stopPropagation();

    const label = helpEl.getAttribute(DATA_HELP_LABEL) || "Rules Help";
    const helpText = helpEl.getAttribute(DATA_HELP_DIALOG_TEXT) || helpEl.getAttribute(DATA_HELP_TEXT) || EMPTY_HELP_FALLBACK;
    const content = `<p>${_escapeHtml(helpText)}</p><p>Open the Rules Compendium for full details.</p>`;
    void alertDialog({
      title: `${label} - Help`,
      content,
    });
  };
}

function _getSheetTooltipState(sheet, { create = false } = {}) {
  let state = _tooltipStateBySheet.get(sheet);
  if (!state && create) {
    state = {
      rootsByEl: new WeakMap(),
      roots: new Set(),
    };
    _tooltipStateBySheet.set(sheet, state);
  }
  return state ?? null;
}

function _clearBoundRoot(sheetState, rootEl) {
  if (!sheetState || !(rootEl instanceof HTMLElement)) return;
  const rootState = sheetState.rootsByEl.get(rootEl);
  if (!rootState) return;

  if (typeof rootState.clickHandler === "function") {
    rootEl.removeEventListener("click", rootState.clickHandler, true);
  }

  if (rootState.annotatedElements instanceof Set) {
    for (const el of rootState.annotatedElements) {
      if (!(el instanceof HTMLElement)) continue;

      const hadTitle = el.getAttribute(DATA_HELP_HAD_TITLE) === "1";
      if (hadTitle) {
        const prevTitle = el.getAttribute(DATA_HELP_PREV_TITLE) ?? "";
        el.setAttribute("title", prevTitle);
      } else {
        el.removeAttribute("title");
      }

      el.removeAttribute(DATA_HELP);
      el.removeAttribute(DATA_HELP_LABEL);
      el.removeAttribute(DATA_HELP_TEXT);
      el.removeAttribute(DATA_HELP_DIALOG_TEXT);
      el.removeAttribute(DATA_HELP_PREV_TITLE);
      el.removeAttribute(DATA_HELP_HAD_TITLE);
    }
  }

  sheetState.rootsByEl.delete(rootEl);
  sheetState.roots.delete(rootState);
}

export function bindItemDescriptionTooltips(sheet, rootEl) {
  if (!sheet || !(rootEl instanceof HTMLElement)) return;

  const sheetState = _getSheetTooltipState(sheet, { create: true });
  _clearBoundRoot(sheetState, rootEl);
  if (!_isInlineHelpEnabled()) {
    if (sheetState.roots.size === 0) _tooltipStateBySheet.delete(sheet);
    return;
  }

  const itemType = String(sheet?.document?.type ?? "").trim().toLowerCase();
  const annotatedElements = new Set();

  _bindQualityTooltips(rootEl, itemType, annotatedElements);
  _bindSpecialActionTooltips(rootEl, annotatedElements);
  _bindCombatActionTooltips(rootEl, annotatedElements);

  const clickHandler = _buildAltClickHandler(rootEl);
  rootEl.addEventListener("click", clickHandler, true);

  const rootState = {
    rootEl,
    clickHandler,
    annotatedElements,
  };
  sheetState.rootsByEl.set(rootEl, rootState);
  sheetState.roots.add(rootState);
}

export function clearItemDescriptionTooltip(sheet) {
  if (!sheet) return;
  const sheetState = _getSheetTooltipState(sheet, { create: false });
  if (!sheetState) return;

  for (const rootState of [...sheetState.roots]) {
    if (!(rootState?.rootEl instanceof HTMLElement)) continue;
    _clearBoundRoot(sheetState, rootState.rootEl);
  }

  _tooltipStateBySheet.delete(sheet);
}
