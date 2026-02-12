/**
 * @module traits/trait-resistance-ui
 * @description UI helpers for rendering trait resistance option selectors.
 *
 * Target: Foundry VTT v13.351
 */

import { getResistanceBonusOptions } from "./trait-registry.js";
import { _bool } from "../../utils/coerce.js";

function _escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildResistanceBonusSection(actor, { selected = [] } = {}) {
  const options = getResistanceBonusOptions(actor);
  if (!options.length) return { html: "", options: [] };

  const selectedSet = new Set((selected ?? []).map(s => String(s || "").toLowerCase()));
  const rows = options.map((opt) => {
    const rawKey = String(opt.key ?? "").toLowerCase();
    const key = _escapeHtml(rawKey);
    const checked = selectedSet.has(rawKey) ? "checked" : "";
    const label = _escapeHtml(String(opt.label ?? opt.key ?? "Resistance"));
    const bonus = Number(opt.bonus ?? (Number(opt.value || 0) * 10)) || 0;
    return `
      <label style="display:flex; gap:8px; align-items:center;">
        <input type="checkbox" name="resistanceBonus" value="${key}" ${checked} />
        <span>${label} (+${bonus})</span>
      </label>`;
  }).join("");

  const html = `
    <div class="form-group" style="margin-top:10px;">
      <label><b>Resistance Bonus</b></label>
      <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
        ${rows}
      </div>
      <p style="opacity:0.8; font-size:12px; margin-top:6px;">RAW: +10 per Resistance (X) when resisting non-damaging effects of that type.</p>
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
