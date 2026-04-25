/**
 * @file src/core/combat/opposed/helpers/weapon-quality-display.js
 * Weapon quality and trait display utilities for chat cards.
 * @module opposed/helpers/weapon-quality-display
 *
 * Extracted from monolithic opposed-workflow.js Phase 18 (2026-02-03).
 * Provides presentational helpers for rendering weapon qualities/traits as inline tags and pills.
 *
 * Dependencies:
 * - UESRPG.QUALITIES_CORE_BY_TYPE, UESRPG.TRAITS_BY_TYPE (system catalogs)
 * - No DOM mutations or document writes (pure display logic)
 */

import { UESRPG } from "../../../constants.js";
import { ITEM_QUALITY_LABELS } from "../../../config/label-catalog.js";
import { buildQualityTooltipText } from "../../../../data/tooltips/index.js";
import { maybeT } from "../../../../utils/i18n.js";

let _qualityLabelIndexCache = null;

function _escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function _buildQualityTagHtml({ label, key, value = null, className = "tag" } = {}) {
  const normalizedKey = String(key ?? "").trim();
  const normalizedLabel = _resolveDisplayLabel(label, normalizedKey);
  const numericValue = (value !== undefined && value !== null && value !== "") ? Number(value) : null;
  const display = numericValue != null && !Number.isNaN(numericValue)
    ? `${normalizedLabel} (${numericValue})`
    : normalizedLabel;
  const tooltip = buildQualityTooltipText({ label: normalizedLabel, key: normalizedKey, itemType: "weapon" });
  return `<span class="${_escapeHtml(className)}" title="${_escapeHtml(tooltip)}">${_escapeHtml(display)}</span>`;
}

function _humanizeKey(key) {
  return String(key ?? "")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function _resolveDisplayLabel(label, key) {
  const rawLabel = String(label ?? "").trim();
  const fallback = rawLabel && !rawLabel.startsWith("UESRPG.")
    ? rawLabel
    : (_humanizeKey(key) || String(key ?? "").trim());
  return maybeT(rawLabel || key, fallback);
}

/**
 * Get cached quality label index (key → display label mapping).
 * Combines core qualities, traits, and catalog entries.
 * 
 * @returns {Map<string, string>} Quality key → label mapping
 * @private
 */
export function getQualityLabelIndex() {
  if (_qualityLabelIndexCache) return _qualityLabelIndexCache;

  // Build index from the centralized label catalog.
  // Catalog keys already cover all quality + trait keys (QUALITIES_CORE_BY_TYPE + TRAITS_BY_TYPE).
  const idx = new Map();
  for (const [key, label] of Object.entries(ITEM_QUALITY_LABELS)) {
    idx.set(String(key).toLowerCase(), String(label));
  }

  // Supplement with any catalog entries the label map might have missed (forward-compat).
  const core = UESRPG?.QUALITIES_CORE_BY_TYPE?.weapon ?? UESRPG?.QUALITIES_CATALOG ?? [];
  const traits = UESRPG?.TRAITS_BY_TYPE?.weapon ?? [];
  for (const q of [...core, ...traits, ...(UESRPG?.QUALITIES_CATALOG ?? [])]) {
    const k = String(q?.key ?? "").toLowerCase();
    if (k && !idx.has(k)) idx.set(k, k);
  }

  _qualityLabelIndexCache = idx;
  return idx;
}

/**
 * Build inline quality tags HTML from structured qualities and traits.
 * 
 * @param {Object} params - Quality data
 * @param {Array} [params.structured=[]] - Structured qualities with key/value
 * @param {Array} [params.traits=[]] - Trait keys (strings)
 * @returns {string} HTML string with inline <span class="tag"> elements
 */
export function buildInlineQualityTags({ structured = [], traits = [] } = {}) {
  const labelIndex = getQualityLabelIndex();
  const out = [];

  for (const q of structured) {
    const keyRaw = String(q?.key ?? q ?? "").trim();
    if (!keyRaw) continue;
    const key = keyRaw.toLowerCase();
    const label = labelIndex.get(key) ?? keyRaw;
    const v = (q?.value !== undefined && q?.value !== null && q?.value !== "") ? Number(q.value) : null;
    out.push(_buildQualityTagHtml({ label, key: keyRaw, value: v }));
  }

  for (const t of traits) {
    const keyRaw = String(t ?? "").trim();
    if (!keyRaw) continue;
    const key = keyRaw.toLowerCase();
    const label = labelIndex.get(key) ?? keyRaw;
    out.push(_buildQualityTagHtml({ label, key: keyRaw }));
  }

  if (!out.length) return '<span style="opacity:0.75;">-</span>';
  return `<span class="uesrpg-inline-tags">${out.join("")}</span>`;
}

/**
 * Collect weapon inline qualities from weapon item.
 * 
 * @param {Item} weapon - Weapon item
 * @returns {{structured: Array, traits: Array}} Qualities data
 */
export function collectWeaponInlineQualities(weapon) {
  if (!weapon) return { structured: [], traits: [] };
  
  const structured = Array.isArray(weapon.system?.qualitiesStructuredInjected)
    ? weapon.system.qualitiesStructuredInjected
    : Array.isArray(weapon.system?.qualitiesStructured)
      ? weapon.system.qualitiesStructured
      : [];
      
  const traits = Array.isArray(weapon.system?.qualitiesTraits) ? weapon.system.qualitiesTraits : [];
  
  return { structured, traits };
}

/**
 * Collect activation damage qualities (for special attacks).
 * 
 * @param {Object} activationDamage - Activation damage data
 * @returns {{structured: Array, traits: Array}} Qualities data
 */
export function collectActivationDamageQualities(activationDamage) {
  if (!activationDamage) return { structured: [], traits: [] };
  
  const structured = Array.isArray(activationDamage.qualitiesStructured) ? activationDamage.qualitiesStructured : [];
  const traits = Array.isArray(activationDamage.qualitiesTraits) ? activationDamage.qualitiesTraits : [];
  
  return { structured, traits };
}

/**
 * Build weapon quality pills HTML (inline display).
 * Filters to active structured qualities + all traits.
 * 
 * @param {Item} weapon - Weapon item
 * @returns {string} HTML string with <span class="uesrpg-pill"> elements
 */
export function buildWeaponPillsInline(weapon) {
  if (!weapon) return "";
  
  const injected = Array.isArray(weapon.system?.qualitiesStructuredInjected)
    ? weapon.system.qualitiesStructuredInjected
    : Array.isArray(weapon.system?.qualitiesStructured)
      ? weapon.system.qualitiesStructured
      : [];

  const structured = injected
    .filter(q => q?.active)
    .map((q) => {
      const key = String(q?.key ?? "").trim();
      const label = q?.name ?? q?.label ?? key;
      const value = (q?.value !== undefined && q?.value !== null && q?.value !== "") ? Number(q.value) : null;
      return { key, label, value };
    })
    .filter((q) => q.key || q.label);

  const traits = Array.isArray(weapon.system?.qualitiesTraits) ? weapon.system.qualitiesTraits : [];
  const pills = [
    ...structured.map((q) => _buildQualityTagHtml({ label: q.label, key: q.key, value: q.value, className: "uesrpg-pill" })),
    ...traits
      .map((t) => {
        const keyRaw = String(t ?? "").trim();
        if (!keyRaw) return "";
        const key = keyRaw.toLowerCase();
        const label = getQualityLabelIndex().get(key) ?? keyRaw;
        return _buildQualityTagHtml({ label, key: keyRaw, className: "uesrpg-pill" });
      })
      .filter(Boolean),
  ].filter(Boolean);

  return pills.join(" ");
}
