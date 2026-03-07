/**
 * @module enchanting/enchant-level
 *
 * src/core/enchanting/enchant-level.js
 *
 * Enchantment Level (EL) resolution for the Enchanting Workshop.
 *
 * RAW:
 *  - Items have an Enchantment Level (EL) which caps usable soul energy.
 *  - Excess soul energy beyond EL is lost.
 *  - Items without an explicit EL are treated as EL 10.
 *
 * EL sources (in priority order):
 *  1. flags["uesrpg-3ev4"].itemEL  (manual GM override)
 *  2. system.enchantLevel           (computed from material/quality via UESRPG.WEAPON_MATERIAL_RULES_MELEE etc.)
 *  3. Default: 10
 *
 * Target: Foundry VTT v13.351
 */

import { SYSTEM_ID } from "../constants.js";

const _NS = SYSTEM_ID;
const DEFAULT_EL = 10;

/**
 * Resolve the Enchantment Level for an item.
 *
 * @param {Item} item
 * @returns {number} EL (>= 0)
 */
export function getItemEL(item) {
  if (!item) return DEFAULT_EL;

  // 1) Manual flag override
  const flagEL = item.flags?.[_NS]?.itemEL;
  if (flagEL != null && Number.isFinite(Number(flagEL))) {
    return Math.max(0, Number(flagEL));
  }

  // 2) System-computed enchantLevel (from material rules)
  const sysEL = item.system?.enchantLevel;
  if (sysEL != null && Number.isFinite(Number(sysEL))) {
    return Math.max(0, Number(sysEL));
  }

  // 3) Default
  return DEFAULT_EL;
}

/**
 * Compute the effective soul energy pool maximum.
 *
 * Pool max = min(itemEL, gemSoulEnergy).
 * Excess gem energy beyond EL is lost (RAW).
 *
 * @param {number} itemEL
 * @param {number} gemSoulEnergy
 * @returns {{ poolMax: number, energyLost: number }}
 */
export function computePoolMax(itemEL, gemSoulEnergy) {
  const el = Math.max(0, Number(itemEL ?? DEFAULT_EL));
  const gem = Math.max(0, Number(gemSoulEnergy ?? 0));
  const poolMax = Math.min(el, gem);
  const energyLost = Math.max(0, gem - el);
  return { poolMax, energyLost };
}

/**
 * Check whether an item is already enchanted (has enchanting flags).
 *
 * @param {Item} item
 * @returns {boolean}
 */
export function isItemEnchanted(item) {
  return Boolean(item?.flags?.[_NS]?.enchanting?.enchantType);
}

/**
 * Get the enchant type of an already-enchanted item.
 *
 * @param {Item} item
 * @returns {"cast"|"strike"|"constant"|null}
 */
export function getItemEnchantType(item) {
  return item?.flags?.[_NS]?.enchanting?.enchantType ?? null;
}
