/**
 * Shared circumstance modifier helpers for opposed and casting dialogs.
 * Labels are resolved from CIRCUMSTANCE_MOD_LABELS in label-catalog.js.
 */

import { CIRCUMSTANCE_MOD_LABELS } from "../config/label-catalog.js";
import { maybeT, t } from "../../utils/i18n.js";

/**
 * Valid circumstance modifier values (ordered for dropdown rendering).
 * Labels for each value live in CIRCUMSTANCE_MOD_LABELS.
 */
export const CIRCUMSTANCE_OPTIONS = Object.freeze([30, 20, 10, 0, -10, -20, -30]);

const CIRCUMSTANCE_FALLBACK_LABELS = Object.freeze({
  30: "Major Advantage (+30)",
  20: "Advantage (+20)",
  10: "Minor Advantage (+10)",
  0: "\u2014",
  [-10]: "Minor Disadvantage (-10)",
  [-20]: "Disadvantage (-20)",
  [-30]: "Major Disadvantage (-30)",
});

export function normalizeCircumstanceMod(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number(fallback) || 0;
  return CIRCUMSTANCE_OPTIONS.includes(n) ? n : (Number(fallback) || 0);
}

export function circumstanceLabel(value) {
  const normalized = normalizeCircumstanceMod(value, 0);
  const fallback = maybeT(CIRCUMSTANCE_MOD_LABELS[normalized], CIRCUMSTANCE_FALLBACK_LABELS[normalized] ?? String(normalized));
  return t(`UESRPG.Choices.Circumstance.${normalized}`, fallback);
}

function _escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildCircumstanceOptionsHtml(selectedValue = 0) {
  const normalized = normalizeCircumstanceMod(selectedValue, 0);
  return CIRCUMSTANCE_OPTIONS.map((value) => {
    const selected = value === normalized ? "selected" : "";
    const label = circumstanceLabel(value);
    return `<option value="${value}" ${selected}>${_escapeHtml(label)}</option>`;
  }).join("\n");
}
