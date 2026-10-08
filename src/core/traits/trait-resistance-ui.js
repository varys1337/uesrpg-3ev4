import { escapeHtml as _escapeHtml } from '../../utils/html.js';
/**
 * @module traits/trait-resistance-ui
 * @description UI helpers for rendering trait resistance option selectors.
 *
 * Target: Foundry VTT v14.368+
 */

import { getResistanceBonusOptions } from "./trait-registry.js";
import { _bool } from "../../utils/coerce.js";
import { systemTooltipAttributes } from "../../ui/shared/system-tooltips.js";



export function buildResistanceBonusSection(actor, { selected = [] } = {}) {
  const options = getResistanceBonusOptions(actor);
  if (!options.length) return { html: "", options: [] };

  const selectedSet = new Set((selected ?? []).map(s => String(s || "").toLowerCase()));
  const explanation = "RAW: +10 per Resistance (X) when resisting non-damaging effects of that type.";
  const rows = options.map((opt) => {
    const rawKey = String(opt.key ?? "").toLowerCase();
    const key = _escapeHtml(rawKey);
    const checked = selectedSet.has(rawKey) ? "checked" : "";
    const label = _escapeHtml(String(opt.label ?? opt.key ?? "Resistance"));
    const bonus = Number(opt.bonus ?? (Number(opt.value || 0) * 10)) || 0;
    return `
      <label class="uesrpg-inline-check uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: explanation })}>
        <input type="checkbox" name="resistanceBonus" value="${key}" ${checked} aria-description="${_escapeHtml(explanation)}" />
        <span class="uesrpg-adv-choice__label">${label} (+${bonus})</span>
      </label>`;
  }).join("");

  const html = `
    <div class="form-group uesrpg-resistance-options">
      <label><b>Resistance Bonus</b></label>
      <div class="uesrpg-resistance-options__choices">
        ${rows}
      </div>
    </div>`;

  return { html, options };
}

export function readResistanceBonusSelections(root, options = []) {
  const out = [];
  const nodes = root?.querySelectorAll?.('input[name="resistanceBonus"]') ?? [];
  const selectedKeys = new Set();

  for (const node of nodes) {
    const val = String(node?.value ?? "").toLowerCase();
    if (!val) continue;
    if (_bool(node?.checked)) selectedKeys.add(val);
  }

  for (const opt of options) {
    const key = String(opt.key ?? "").toLowerCase();
    if (!selectedKeys.has(key)) continue;
    out.push(opt);
  }

  return out;
}

export function buildResistanceBonusMods(selectedOptions = []) {
  const out = [];
  for (const opt of (selectedOptions ?? [])) {
    const value = Number(opt.value ?? 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    const label = String(opt.label ?? opt.key ?? "Resistance");
    out.push({
      key: `resistance-${String(opt.key ?? "").toLowerCase()}`,
      label: `Resistance Bonus: ${label}`,
      value: value * 10,
      source: "resistanceTrait"
    });
  }
  return out;
}
