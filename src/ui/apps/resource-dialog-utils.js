/**
 * Small shared helpers for resource dialogs.
 */

export function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clampNumber(value, min = 0, max = Number.POSITIVE_INFINITY) {
  const n = toFiniteNumber(value, min);
  return Math.max(min, Math.min(max, n));
}

