/**
 * Canonical helpers for lucky/unlucky number slot logic.
 * Keep this module read-centric and side-effect free.
 */

export const LUCKY_SLOT_KEYS = Object.freeze([
  "ln1", "ln2", "ln3", "ln4", "ln5", "ln6", "ln7", "ln8", "ln9", "ln10"
]);

export const UNLUCKY_SLOT_KEYS = Object.freeze([
  "ul1", "ul2", "ul3", "ul4", "ul5", "ul6"
]);

const THIEF_SIGNS = Object.freeze(new Set([
  "the thief",
  "the star-cursed thief"
]));

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function _toSystem(source) {
  if (!source) return {};
  if (source.system && typeof source.system === "object") return source.system;
  if (typeof source === "object") return source;
  return {};
}

function _bag(systemOrActor, path) {
  const system = _toSystem(systemOrActor);
  const value = system?.[path];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export function hasThiefBirthsign(actor) {
  const items = actor?.items;
  if (!items) return false;
  for (const item of items) {
    if (!item || String(item.type ?? "").toLowerCase() !== "trait") continue;
    const key = String(item.name ?? "").trim().toLowerCase();
    if (THIEF_SIGNS.has(key)) return true;
  }
  return false;
}

export function resolveLuckBonus(actor, { clampNonNegative = false } = {}) {
  const system = _toSystem(actor);
  const prepared = _num(system?.characteristics?.lck?.bonus, NaN);
  const fallback = Math.floor(_num(system?.characteristics?.lck?.total, 0) / 10);
  let bonus = Number.isFinite(prepared) ? prepared : fallback;
  if (clampNonNegative) bonus = Math.max(0, bonus);
  return bonus;
}

export function resolveLuckyUnluckyAllocation(actor, { clampNonNegativeBonus = true } = {}) {
  const baseLuckBonus = resolveLuckBonus(actor, { clampNonNegative: clampNonNegativeBonus });
  const thiefBonus = hasThiefBirthsign(actor) ? 1 : 0;
  const luckyCount = _clamp(baseLuckBonus + thiefBonus, 0, LUCKY_SLOT_KEYS.length);
  const unluckyCount = _clamp(5 - baseLuckBonus, 0, UNLUCKY_SLOT_KEYS.length);
  return { baseLuckBonus, thiefBonus, luckyCount, unluckyCount };
}

export function extractConfiguredLuckyNumbers(systemOrActor, { keys = LUCKY_SLOT_KEYS } = {}) {
  const bag = _bag(systemOrActor, "lucky_numbers");
  return keys
    .map((key) => _num(bag?.[key], 0))
    .filter((value) => value > 0);
}

export function extractConfiguredUnluckyNumbers(systemOrActor, { keys = UNLUCKY_SLOT_KEYS } = {}) {
  const bag = _bag(systemOrActor, "unlucky_numbers");
  return keys
    .map((key) => _num(bag?.[key], 0))
    .filter((value) => value > 0);
}

export function readLuckySlotMap(systemOrActor, { keys = LUCKY_SLOT_KEYS } = {}) {
  const bag = _bag(systemOrActor, "lucky_numbers");
  return Object.fromEntries(keys.map((key) => [key, _num(bag?.[key], 0)]));
}

export function readUnluckySlotMap(systemOrActor, { keys = UNLUCKY_SLOT_KEYS } = {}) {
  const bag = _bag(systemOrActor, "unlucky_numbers");
  return Object.fromEntries(keys.map((key) => [key, _num(bag?.[key], 0)]));
}
