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

let _qualityLabelIndexCache = null;

/**
 * Get cached quality label index (key → display label mapping).
 * Combines core qualities, traits, and catalog entries.
 * 
 * @returns {Map<string, string>} Quality key → label mapping
 * @private
 */
export function getQualityLabelIndex() {
  if (_qualityLabelIndexCache) return _qualityLabelIndexCache;
  
  const core = UESRPG?.QUALITIES_CORE_BY_TYPE?.weapon ?? UESRPG?.QUALITIES_CATALOG ?? [];
  const traits = UESRPG?.TRAITS_BY_TYPE?.weapon ?? [];
  const idx = new Map();
  
  for (const q of [...core, ...traits, ...(UESRPG?.QUALITIES_CATALOG ?? [])]) {
    if (!q?.key) continue;
    idx.set(String(q.key).toLowerCase(), String(q.label ?? q.key));
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
    const key = String(q?.key ?? q ?? "").toLowerCase().trim();
    if (!key) continue;
    const label = labelIndex.get(key) ?? key;
    const v = (q?.value !== undefined && q?.value !== null && q?.value !== "") ? Number(q.value) : null;
    out.push(`<span class="tag">${v != null && !Number.isNaN(v) ? `${label} (${v})` : label}</span>`);
  }

  for (const t of traits) {
    const key = String(t ?? "").toLowerCase().trim();
    if (!key) continue;
    const label = labelIndex.get(key) ?? key;
    out.push(`<span class="tag">${label}</span>`);
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
    .map(q => q?.name)
    .filter(Boolean);

  const traits = Array.isArray(weapon.system?.qualitiesTraits) ? weapon.system.qualitiesTraits : [];
  const pills = [...structured, ...traits].filter(Boolean);
  
  return pills.map(p => `<span class="uesrpg-pill">${p}</span>`).join(" ");
}
