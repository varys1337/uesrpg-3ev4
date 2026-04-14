/**
 * Shared circumstance modifier helpers for opposed and casting dialogs.
 * Labels are resolved from CIRCUMSTANCE_MOD_LABELS in label-catalog.js.
 */

import { CIRCUMSTANCE_MOD_LABELS } from "../config/label-catalog.js";
import { t } from "../../utils/i18n.js";

/**
 * Valid circumstance modifier values (ordered for dropdown rendering).
 * Labels for each value live in CIRCUMSTANCE_MOD_LABELS.
 */
export const CIRCUMSTANCE_OPTIONS = Object.freeze([30, 20, 10, 0, -10, -20, -30]);

export function normalizeCircumstanceMod(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number(fallback) || 0;
  return CIRCUMSTANCE_OPTIONS.includes(n) ? n : (Number(fallback) || 0);
}

export function circumstanceLabel(value) {
  const normalized = normalizeCircumstanceMod(value, 0);
  const fallback = CIRCUMSTANCE_MOD_LABELS[normalized] ?? "\u2014";
  return t(`UESRPG.Choices.Circumstance.${normalized}`, fallback);
}

export function buildCircumstanceOptionsHtml(selectedValue = 0) {
  const normalized = normalizeCircumstanceMod(selectedValue, 0);
  return CIRCUMSTANCE_OPTIONS.map((value) => {
    const selected = value === normalized ? "selected" : "";
    const label = CIRCUMSTANCE_MOD_LABELS[value] ?? String(value);
    return `<option value="${value}" ${selected}>${label}</option>`;
  }).join("\n");
}
