/**
 * src/ui/sheets/item/listeners/rule-elements.js
 *
 * Rule Elements business-logic handlers and dynamic field rendering
 * for the Automation tab on trait/talent/power item sheets.
 *
 * Click-action handlers are wired via SimpleItemSheetV2's `actions` map.
 * Change/drag listeners are registered natively in `_registerRuleElementListeners`.
 * Dynamic field rendering (`renderFieldsForElement`, `renderConditionFieldsForElement`)
 * is called on expand and on re-render state restoration.
 */

import {
  RULE_ELEMENT_TYPES,
  CONDITION_TYPES,
  getRuleElements,
  setRuleElements,
  createRuleElement,
  createCondition,
  getRuleElementOptions,
} from "../../../../core/traits/features/rule-elements.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";

// ─── Click-action handlers (called from SimpleItemSheetV2 actions map) ───

/**
 * Create a new rule element from the type-select dropdown.
 * @param {Item} item       The owning Item document
 * @param {HTMLElement} rootEl  The sheet element (used to find the select)
 */
export async function onReAdd(item, rootEl) {
  const select = rootEl.querySelector(".re-add-type");
  const type = select?.value;
  if (!type) return;

  const el = createRuleElement(type);
  if (!el) return;

  const elements = getRuleElements(item);
  elements.push(el);
  await setRuleElements(item, elements);
  if (select) select.value = "";
}

/**
 * Delete a rule element by id.
 * @param {Item} item
 * @param {string} reId
 */
export async function onReDelete(item, reId) {
  if (!reId) return;
  const elements = getRuleElements(item).filter(el => el.id !== reId);
  await setRuleElements(item, elements);
}

/**
 * Add a condition to a rule element via dialog prompt.
 * @param {Item} item
 * @param {string} reId
 */
export async function onReAddCondition(item, reId) {
  if (!reId) return;

  const condType = await _promptConditionType();
  if (!condType) return;

  const cond = createCondition(condType);
  if (!cond) return;

  const elements = getRuleElements(item);
  const el = elements.find(e => e.id === reId);
  if (!el) return;

  el.conditions.push(cond);
  await setRuleElements(item, elements);
}

/**
 * Delete a condition from a rule element.
 * @param {Item} item
 * @param {string} reId
 * @param {number} condIdx
 */
export async function onReConditionDelete(item, reId, condIdx) {
  if (!reId || condIdx === undefined) return;

  const elements = getRuleElements(item);
  const el = elements.find(e => e.id === reId);
  if (!el || !el.conditions) return;

  el.conditions.splice(condIdx, 1);
  await setRuleElements(item, elements);
}

// ─── Change-handler helpers (called from native addEventListener) ────

/**
 * Toggle a rule element's enabled state.
 * @param {Item} item
 * @param {string} reId
 * @param {boolean} enabled
 */
export async function onReToggle(item, reId, enabled) {
  if (!reId) return;
  const elements = getRuleElements(item);
  const el = elements.find(e => e.id === reId);
  if (!el) return;
  el.enabled = enabled;
  await setRuleElements(item, elements);
}

/**
 * Update a rule element's label.
 * @param {Item} item
 * @param {string} reId
 * @param {string} value
 */
export async function onReLabelChange(item, reId, value) {
  if (!reId) return;
  const elements = getRuleElements(item);
  const el = elements.find(e => e.id === reId);
  if (!el) return;
  el.label = value || RULE_ELEMENT_TYPES[el.type]?.label || "Rule Element";
  await setRuleElements(item, elements);
}

/**
 * Update a rule element's predicate.
 * @param {Item} item
 * @param {string} reId
 * @param {string} value  Raw input string (JSON or plain text)
 */
export async function onRePredicateChange(item, reId, value) {
  if (!reId) return;
  const elements = getRuleElements(item);
  const el = elements.find(e => e.id === reId);
  if (!el) return;
  el.predicate = _parsePredicateInput(value);
  await setRuleElements(item, elements);
}

/**
 * Toggle a workflow scope on/off for a rule element.
 * @param {Item} item
 * @param {string} reId
 * @param {string} workflow  The workflow key (e.g. "skill", "combat")
 * @param {boolean} checked
 */
export async function onReWorkflowToggle(item, reId, workflow, checked) {
  if (!reId || !workflow) return;
  const elements = getRuleElements(item);
  const el = elements.find(e => e.id === reId);
  if (!el) return;

  let workflows = Array.isArray(el.workflows) ? el.workflows.slice() : ["all"];
  workflows = workflows.filter(w => w !== "all");
  if (checked) {
    if (!workflows.includes(workflow)) workflows.push(workflow);
  } else {
    workflows = workflows.filter(w => w !== workflow);
  }
  el.workflows = workflows.length ? workflows : ["all"];
  await setRuleElements(item, elements);
}

/**
 * Update a single field on a condition within a rule element.
 * @param {Item} item
 * @param {string} reId
 * @param {number} condIdx
 * @param {string} condField
 * @param {*} value
 * @param {string} inputType  The input element's type ("checkbox", "number", etc.)
 */
export async function onReConditionFieldChange(item, reId, condIdx, condField, value, inputType) {
  if (!reId || !Number.isInteger(condIdx) || !condField) return;

  const elements = getRuleElements(item);
  const el = elements.find(e => e.id === reId);
  if (!el || !Array.isArray(el.conditions) || !el.conditions[condIdx]) return;

  if (inputType === "checkbox") {
    el.conditions[condIdx][condField] = Boolean(value);
  } else if (inputType === "number") {
    el.conditions[condIdx][condField] = Number(value) || 0;
  } else {
    el.conditions[condIdx][condField] = value;
  }

  await setRuleElements(item, elements);
}

/**
 * Reorder rule elements after a drag-drop.
 * @param {Item} item
 * @param {string} sourceId
 * @param {string} targetId
 */
export async function onReReorder(item, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === String(targetId)) return;

  const elements = getRuleElements(item);
  const sourceIdx = elements.findIndex(e => String(e.id) === String(sourceId));
  const targetIdx = elements.findIndex(e => String(e.id) === String(targetId));
  if (sourceIdx < 0 || targetIdx < 0) return;

  const [moved] = elements.splice(sourceIdx, 1);
  elements.splice(targetIdx, 0, moved);
  await setRuleElements(item, elements);
}


// ─── Internal helpers ────────────────────────────────────────────────

/**
 * Dynamically render the type-specific fields for a rule element inside
 * its `.re-fields` container. Called on first expand or after re-render
 * state restoration.
 *
 * @param {HTMLElement} li  Native <li> element for the rule element row
 * @param {Item} item       The owning Item document
 */
export function renderFieldsForElement(li, item) {
  const fieldsContainer = li.querySelector(".re-fields");
  if (!fieldsContainer) return;
  if (fieldsContainer.dataset.rendered) return; // already rendered
  fieldsContainer.dataset.rendered = "true";

  const reId = li.dataset.reId;
  const elements = getRuleElements(item);
  const el = elements.find(e => e.id === reId);
  if (!el) return;

  const typeDef = RULE_ELEMENT_TYPES[el.type];
  if (!typeDef || !typeDef.fields) return;

  const options = getRuleElementOptions();
  let html = '<div class="re-fields-grid">';

  for (const [fieldKey, fieldDef] of Object.entries(typeDef.fields)) {
    const currentVal = el[fieldKey] ?? fieldDef.default ?? "";
    html += `<div class="re-field-row">`;
    html += `<label class="re-field-label">${fieldDef.label}</label>`;

    if (fieldDef.type === "select") {
      const opts = options[fieldDef.options] ?? {};
      html += `<select class="re-field-input" data-re-field="${fieldKey}">`;
      for (const [val, label] of Object.entries(opts)) {
        const sel = (String(currentVal) === String(val)) ? " selected" : "";
        html += `<option value="${val}"${sel}>${label}</option>`;
      }
      html += `</select>`;
    } else if (fieldDef.type === "checkbox") {
      const chk = currentVal ? " checked" : "";
      html += `<input class="re-field-input checkbox" type="checkbox" data-re-field="${fieldKey}"${chk} />`;
    } else if (fieldDef.type === "number") {
      html += `<input class="re-field-input" type="number" data-re-field="${fieldKey}" value="${currentVal}" step="1" />`;
    } else {
      html += `<input class="re-field-input" type="text" data-re-field="${fieldKey}" value="${_escapeAttr(String(currentVal))}" />`;
    }

    html += `</div>`;
  }

  html += "</div>";
  fieldsContainer.innerHTML = html;

  // Bind change events on rendered fields
  for (const input of fieldsContainer.querySelectorAll(".re-field-input")) {
    input.addEventListener("change", async (ev) => {
      const field = ev.currentTarget.dataset.reField;
      if (!field) return;

      const elems = getRuleElements(item);
      const target = elems.find(e => e.id === reId);
      if (!target) return;

      if (ev.currentTarget.type === "checkbox") {
        target[field] = ev.currentTarget.checked;
      } else if (ev.currentTarget.type === "number") {
        target[field] = Number(ev.currentTarget.value) || 0;
      } else {
        target[field] = ev.currentTarget.value;
      }

      await setRuleElements(item, elems);
    });
  }
}

/**
 * Dynamically render condition-specific fields for each condition slot
 * inside a rule element's body.
 *
 * @param {HTMLElement} li  Native <li> element for the rule element row
 * @param {Item} item       The owning Item document
 */
export function renderConditionFieldsForElement(li, item) {
  const reId = li.dataset.reId;
  if (!reId) return;

  const elements = getRuleElements(item);
  const el = elements.find((e) => e.id === reId);
  if (!el || !Array.isArray(el.conditions)) return;
  const options = getRuleElementOptions();

  for (let condIdx = 0; condIdx < el.conditions.length; condIdx += 1) {
    const cond = el.conditions[condIdx];
    const condType = String(cond?.type ?? "");
    const def = CONDITION_TYPES[condType];
    if (!def) continue;

    const container = li.querySelector(`.re-condition-fields[data-cond-idx="${condIdx}"]`);
    if (!container || container.dataset.rendered) continue;
    container.dataset.rendered = "true";

    let html = '<div class="re-cond-grid">';
    for (const [fieldKey, fieldDef] of Object.entries(def.fields ?? {})) {
      const current = cond[fieldKey] ?? fieldDef.default ?? "";
      html += `<div class="re-cond-field">`;
      html += `<label class="re-cond-label">${fieldDef.label}</label>`;
      if (fieldDef.type === "select") {
        const opts = options[fieldDef.options] ?? {};
        html += `<select class="re-condition-input" data-cond-idx="${condIdx}" data-cond-field="${fieldKey}">`;
        for (const [value, label] of Object.entries(opts)) {
          const selected = String(value) === String(current) ? " selected" : "";
          html += `<option value="${value}"${selected}>${label}</option>`;
        }
        html += `</select>`;
      } else if (fieldDef.type === "number") {
        html += `<input class="re-condition-input" type="number" data-cond-idx="${condIdx}" data-cond-field="${fieldKey}" value="${Number(current) || 0}" />`;
      } else {
        html += `<input class="re-condition-input" type="text" data-cond-idx="${condIdx}" data-cond-field="${fieldKey}" value="${_escapeAttr(String(current ?? ""))}" />`;
      }
      html += `</div>`;
    }
    html += "</div>";
    container.innerHTML = html;
  }
}


/**
 * Prompt user to pick a condition type via a simple dialog.
 * @returns {Promise<string|null>}
 */
async function _promptConditionType() {
  const condOptions = Object.entries(CONDITION_TYPES)
    .map(([key, def]) => `<option value="${key}">${def.label}</option>`)
    .join("");

  const content = `
    <div>
      <div class="form-group">
        <label>Condition Type</label>
        <select id="re-cond-type-select">${condOptions}</select>
      </div>
    </div>`;

  return customDialog({
    title: "Add Condition",
    content,
    yes: {
      label: "Add",
      icon: "fas fa-plus",
      callback: (html) => {
        const el = html instanceof HTMLElement ? html : html?.[0];
        return el?.querySelector("#re-cond-type-select")?.value ?? null;
      }
    },
    no: { label: "Cancel", icon: "fas fa-times" },
    defaultButton: "yes"
  });
}


/**
 * Escape HTML attribute values.
 */
function _escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _parsePredicateInput(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch (_e) {
      return text;
    }
  }
  return text;
}

