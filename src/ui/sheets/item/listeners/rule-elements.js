/**
 * src/ui/sheets/item/listeners/rule-elements.js
 *
 * Event listeners for the Rule Elements UI on the Automation tab.
 * Handles add/remove/toggle/expand/collapse and per-element field rendering.
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

/**
 * Register all rule-element listeners on an item sheet.
 *
 * @param {ItemSheet} sheet
 * @param {jQuery} html
 */
export function registerRuleElementListeners(sheet, html) {
  const item = sheet.item;
  if (!item) return;

  const featureTypes = new Set(["trait", "talent", "power"]);
  if (!featureTypes.has(item.type)) return;

  // ── Add rule element ─────────────────────────────────────────────
  html.find(".re-add-btn").on("click.re", async (ev) => {
    ev.preventDefault();
    const select = html.find(".re-add-type");
    const type = select.val();
    if (!type) return;

    const el = createRuleElement(type);
    if (!el) return;

    const elements = getRuleElements(item);
    elements.push(el);
    await setRuleElements(item, elements);
    select.val("");
  });

  // ── Delete rule element ──────────────────────────────────────────
  html.find(".re-item-delete").on("click.re", async (ev) => {
    ev.preventDefault();
    const li = $(ev.currentTarget).closest(".re-item");
    const reId = li.data("re-id");
    if (!reId) return;

    const elements = getRuleElements(item).filter(el => el.id !== reId);
    await setRuleElements(item, elements);
  });

  // ── Toggle enable/disable ────────────────────────────────────────
  html.find('.re-item-toggle input[type="checkbox"]').on("change.re", async (ev) => {
    const li = $(ev.currentTarget).closest(".re-item");
    const reId = li.data("re-id");
    if (!reId) return;

    const elements = getRuleElements(item);
    const el = elements.find(e => e.id === reId);
    if (!el) return;

    el.enabled = ev.currentTarget.checked;
    await setRuleElements(item, elements);
  });

  // ── Edit label ───────────────────────────────────────────────────
  html.find(".re-item-label").on("change.re", async (ev) => {
    const li = $(ev.currentTarget).closest(".re-item");
    const reId = li.data("re-id");
    if (!reId) return;

    const elements = getRuleElements(item);
    const el = elements.find(e => e.id === reId);
    if (!el) return;

    el.label = ev.currentTarget.value || RULE_ELEMENT_TYPES[el.type]?.label || "Rule Element";
    await setRuleElements(item, elements);
  });

  // ── Predicate editor ─────────────────────────────────────────────
  html.find(".re-predicate-input").on("change.re", async (ev) => {
    const li = $(ev.currentTarget).closest(".re-item");
    const reId = li.data("re-id");
    if (!reId) return;

    const elements = getRuleElements(item);
    const el = elements.find((e) => e.id === reId);
    if (!el) return;

    el.predicate = _parsePredicateInput(ev.currentTarget.value);
    await setRuleElements(item, elements);
  });

  // ── Workflow scope toggles ───────────────────────────────────────
  html.find(".re-workflow-toggle").on("change.re", async (ev) => {
    const li = $(ev.currentTarget).closest(".re-item");
    const reId = li.data("re-id");
    const workflow = String(ev.currentTarget.dataset.workflow ?? "").trim();
    if (!reId || !workflow) return;

    const elements = getRuleElements(item);
    const el = elements.find((e) => e.id === reId);
    if (!el) return;

    let workflows = Array.isArray(el.workflows) ? el.workflows.slice() : ["all"];
    workflows = workflows.filter((w) => w !== "all");
    if (ev.currentTarget.checked) {
      if (!workflows.includes(workflow)) workflows.push(workflow);
    } else {
      workflows = workflows.filter((w) => w !== workflow);
    }
    el.workflows = workflows.length ? workflows : ["all"];
    await setRuleElements(item, elements);
  });

  // ── Expand / collapse (client-only, no persistence) ──────────────
  html.find(".re-item-expand").on("click.re", (ev) => {
    ev.preventDefault();
    const li = $(ev.currentTarget).closest(".re-item");
    const body = li.find(".re-item-body");
    const icon = $(ev.currentTarget).find("i");

    if (body.is(":visible")) {
      body.slideUp(150);
      icon.removeClass("fa-chevron-up").addClass("fa-chevron-down");
    } else {
      body.slideDown(150);
      icon.removeClass("fa-chevron-down").addClass("fa-chevron-up");
      // Render fields on first expand
      renderFieldsForElement(li, item);
      renderConditionFieldsForElement(li, item);
    }
  });

  // ── Add condition ────────────────────────────────────────────────
  html.find(".re-add-condition").on("click.re", async (ev) => {
    ev.preventDefault();
    const reId = $(ev.currentTarget).data("re-id");
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
  });

  // ── Delete condition ─────────────────────────────────────────────
  html.find(".re-condition-delete").on("click.re", async (ev) => {
    ev.preventDefault();
    const condDiv = $(ev.currentTarget).closest(".re-condition");
    const condIdx = condDiv.data("cond-idx");
    const li = $(ev.currentTarget).closest(".re-item");
    const reId = li.data("re-id");
    if (!reId || condIdx === undefined) return;

    const elements = getRuleElements(item);
    const el = elements.find(e => e.id === reId);
    if (!el || !el.conditions) return;

    el.conditions.splice(condIdx, 1);
    await setRuleElements(item, elements);
  });

  // ── Condition field edits ────────────────────────────────────────
  html.off("change.re", ".re-condition-input").on("change.re", ".re-condition-input", async (ev) => {
    const li = $(ev.currentTarget).closest(".re-item");
    const reId = li.data("re-id");
    const condIdx = Number(ev.currentTarget.dataset.condIdx);
    const condField = String(ev.currentTarget.dataset.condField ?? "").trim();
    if (!reId || !Number.isInteger(condIdx) || !condField) return;

    const elements = getRuleElements(item);
    const el = elements.find((e) => e.id === reId);
    if (!el || !Array.isArray(el.conditions) || !el.conditions[condIdx]) return;

    if (ev.currentTarget.type === "checkbox") {
      el.conditions[condIdx][condField] = Boolean(ev.currentTarget.checked);
    } else if (ev.currentTarget.type === "number") {
      el.conditions[condIdx][condField] = Number(ev.currentTarget.value) || 0;
    } else {
      el.conditions[condIdx][condField] = ev.currentTarget.value;
    }

    await setRuleElements(item, elements);
  });

  // ── Reorder rule elements ────────────────────────────────────────
  html.find(".re-item").attr("draggable", "true");
  html.find(".re-item").on("dragstart.re", (ev) => {
    const reId = $(ev.currentTarget).data("re-id");
    ev.originalEvent?.dataTransfer?.setData("text/plain", String(reId ?? ""));
  });
  html.find(".re-item").on("dragover.re", (ev) => {
    ev.preventDefault();
  });
  html.find(".re-item").on("drop.re", async (ev) => {
    ev.preventDefault();
    const sourceId = ev.originalEvent?.dataTransfer?.getData("text/plain");
    const targetId = $(ev.currentTarget).data("re-id");
    if (!sourceId || !targetId || sourceId === String(targetId)) return;

    const elements = getRuleElements(item);
    const sourceIdx = elements.findIndex((e) => String(e.id) === String(sourceId));
    const targetIdx = elements.findIndex((e) => String(e.id) === String(targetId));
    if (sourceIdx < 0 || targetIdx < 0) return;

    const [moved] = elements.splice(sourceIdx, 1);
    elements.splice(targetIdx, 0, moved);
    await setRuleElements(item, elements);
  });
}


// ─── Internal helpers ────────────────────────────────────────────────

/**
 * Dynamically render the type-specific fields for a rule element inside
 * its `.re-fields` container. Called on first expand or after re-render
 * state restoration.
 */
export function renderFieldsForElement(li, item) {
  const fieldsContainer = li.find(".re-fields");
  if (!fieldsContainer.length) return;
  if (fieldsContainer.data("rendered")) return; // already rendered
  fieldsContainer.data("rendered", true);

  const reId = li.data("re-id");
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
  fieldsContainer.html(html);

  // Bind change events on rendered fields
  fieldsContainer.find(".re-field-input").on("change.re", async (ev) => {
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

export function renderConditionFieldsForElement(li, item) {
  const reId = li.data("re-id");
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

    const container = li.find(`.re-condition-fields[data-cond-idx="${condIdx}"]`);
    if (!container.length || container.data("rendered")) continue;
    container.data("rendered", true);

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
    container.html(html);
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

  return new Promise(resolve => {
    const d = new Dialog({
      title: "Add Condition",
      content: `
        <form>
          <div class="form-group">
            <label>Condition Type</label>
            <select id="re-cond-type-select">${condOptions}</select>
          </div>
        </form>`,
      buttons: {
        add: {
          icon: '<i class="fas fa-plus"></i>',
          label: "Add",
          callback: (html) => resolve(html.find("#re-cond-type-select").val()),
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
          callback: () => resolve(null),
        },
      },
      default: "add",
    });
    d.render(true);
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
