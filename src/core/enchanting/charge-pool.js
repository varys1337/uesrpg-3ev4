import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../constants.js";

const _finiteEnergy = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
};

/**
 * Resolve the one authoritative charge pool for an item. Workshop enchantment
 * flags take priority, followed by the item-spellcasting extension. The old
 * system.charge object is retained only as a compatibility lane/mirror.
 */
export function resolveEnchantmentChargeState(item) {
  const flags = item?.flags?.[SYSTEM_ID] ?? {};
  const enchanting = flags.enchanting ?? {};
  const enchantType = String(enchanting.enchantType ?? "").trim().toLowerCase();
  const systemCharge = item?.system?.charge ?? {};

  let source = "";
  let valuePath = "";
  let maxPath = "";
  let pool = null;

  if (enchanting.version === 2 && enchantType === "cast") {
    source = "workshop";
    valuePath = `flags.${SYSTEM_ID}.enchanting.cast.pool.value`;
    maxPath = `flags.${SYSTEM_ID}.enchanting.cast.pool.max`;
    pool = enchanting.cast?.pool ?? {};
  } else if (enchanting.version === 2 && enchantType === "strike" && enchanting.strike?.useCharges === true) {
    source = "strike";
    valuePath = "system.charge.value";
    maxPath = "system.charge.max";
    pool = systemCharge;
  } else if (flags.itemSpellcasting?.enabled === true) {
    source = "extension";
    valuePath = `flags.${SYSTEM_ID}.itemSpellcasting.pool.value`;
    maxPath = `flags.${SYSTEM_ID}.itemSpellcasting.pool.max`;
    pool = flags.itemSpellcasting.pool ?? {};
  } else if (_finiteEnergy(systemCharge.max) > 0 || _finiteEnergy(systemCharge.value) > 0) {
    source = "legacy";
    valuePath = "system.charge.value";
    maxPath = "system.charge.max";
    pool = systemCharge;
  }

  if (!pool) return null;
  const fallbackValue = _finiteEnergy(systemCharge.value);
  const fallbackMax = _finiteEnergy(systemCharge.max, fallbackValue);
  const value = _finiteEnergy(pool.value, fallbackValue);
  const max = Math.max(value, _finiteEnergy(pool.max, fallbackMax));
  return {
    source,
    value,
    max,
    valuePath,
    maxPath,
    isCanonical: source === "workshop" || source === "extension",
  };
}

/** Build an atomic update that keeps legacy system.charge in sync. */
export function buildEnchantmentChargeUpdate(item, { value, max } = {}) {
  const state = resolveEnchantmentChargeState(item);
  if (!state) return null;
  const nextMax = _finiteEnergy(max, state.max);
  const nextValue = Math.min(nextMax, _finiteEnergy(value, state.value));
  return {
    [state.valuePath]: nextValue,
    [state.maxPath]: nextMax,
    "system.charge.value": nextValue,
    "system.charge.max": nextMax,
  };
}

/** Persist the resolved pool and compatibility mirror together. */
export async function updateEnchantmentCharge(item, changes = {}) {
  const update = buildEnchantmentChargeUpdate(item, changes);
  if (!update) return false;
  return requestUpdateDocument(item, update);
}
