/**
 * Shared item preparation helpers.
 */

/**
 * Add a flat bonus to a dice string.
 * - Accepts numeric values or strings (e.g. "1d8", "1d10+2").
 * - Returns a string suitable for Foundry dice rolling.
 */
export function normalizeDiceExpression(expr) {
  const raw = String(expr ?? "").trim();
  if (!raw) return "0";

  if (/uses\s+nat\.?\s*weapon/i.test(raw)) return "0";

  const paren = raw.match(/^(.+?)\s*\((.+?)\)\s*$/);
  const base = paren ? String(paren[1]).trim() : raw;

  const ascii = base.replace(/[\u2012\u2013\u2014\u2212]/g, "-");

  let cleaned = ascii.replace(/[^0-9dDkKfFhHlL+\-*/().,\s@]/g, " ").trim();
  cleaned = cleaned.replace(/(\d),(\d)/g, "$1.$2");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/[+\-*/.,\s]+$/g, "").trim();
  cleaned = cleaned.replace(/^[+\-*/.,\s]+/g, "").trim();

  return cleaned || "0";
}

export function addDiceBonus(dice, bonus) {
  const b = Number(bonus || 0);
  if (!b) return String(dice ?? "");
  const d = normalizeDiceExpression(dice);
  if (!d) return String(b);

  if (/^-?\d+(?:\.\d+)?$/.test(d)) return String(Number(d) + b);

  const m = d.match(/^(.*?)([+-])\s*(\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const base = m[1].trim();
    const sign = m[2] === "-" ? -1 : 1;
    const existing = sign * Number(m[3]);
    const total = existing + b;
    if (total === 0) return base;
    return `${base}${total >= 0 ? "+" : ""}${total}`;
  }
  return `${d}${b >= 0 ? "+" : ""}${b}`;
}

export function halveDiceExpression(dice) {
  const d = normalizeDiceExpression(dice);
  if (!d) return "0";
  if (/^-?\d+(?:\.\d+)?$/.test(d)) return String(Math.floor(Number(d) / 2));
  return `floor((${d})/2)`;
}

export function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function roundPriceUp(v) {
  return Math.max(0, Math.ceil(safeNumber(v, 0)));
}

export function hasLegacyQuality(qualitiesText, needle) {
  const q = String(qualitiesText ?? "").toLowerCase();
  return q.includes(String(needle).toLowerCase());
}

/**
 * Extract and sum numeric parameters for a legacy quality from free-text qualities.
 * Example: "Damaged (1), Damaged (2)" => 3
 */
export function sumLegacyQualityParam(qualitiesText, qualityName) {
  const q = String(qualitiesText ?? "");
  if (!q) return 0;
  const name = String(qualityName ?? "").trim();
  if (!name) return 0;

  const re = new RegExp(`${name}\\s*\\(\\s*(\\d+)\\s*\\)`, "gi");
  let total = 0;
  let m;
  while ((m = re.exec(q)) !== null) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

export function hasLegacyQualityToken(qualitiesText, qualityName) {
  const q = String(qualitiesText ?? "").toLowerCase();
  const needle = String(qualityName ?? "").toLowerCase().trim();
  if (!q || !needle) return false;
  const re = new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`, "i");
  return re.test(q);
}

export function hasStructuredQuality(qualitiesStructured, key) {
  if (!Array.isArray(qualitiesStructured)) return false;
  return qualitiesStructured.some(q => (q?.key ?? q) === key);
}

export function parseRangeTriplet(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  return { close: Number(m[1]), effective: Number(m[2]), long: Number(m[3]) };
}
