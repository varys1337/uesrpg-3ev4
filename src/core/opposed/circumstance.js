/**
 * Shared circumstance modifier helpers for opposed and casting dialogs.
 */

export const CIRCUMSTANCE_OPTIONS = Object.freeze([
  { value: 30, label: "Major Advantage (+30)" },
  { value: 20, label: "Advantage (+20)" },
  { value: 10, label: "Minor Advantage (+10)" },
  { value: 0, label: "\u2014" },
  { value: -10, label: "Minor Disadvantage (-10)" },
  { value: -20, label: "Disadvantage (-20)" },
  { value: -30, label: "Major Disadvantage (-30)" }
]);

export function normalizeCircumstanceMod(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number(fallback) || 0;
  return CIRCUMSTANCE_OPTIONS.some((opt) => opt.value === n) ? n : (Number(fallback) || 0);
}

export function circumstanceLabel(value) {
  const normalized = normalizeCircumstanceMod(value, 0);
  return CIRCUMSTANCE_OPTIONS.find((opt) => opt.value === normalized)?.label ?? "\u2014";
}

export function buildCircumstanceOptionsHtml(selectedValue = 0) {
  const normalized = normalizeCircumstanceMod(selectedValue, 0);
  return CIRCUMSTANCE_OPTIONS.map((opt) => {
    const selected = opt.value === normalized ? "selected" : "";
    return `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
  }).join("\n");
}
