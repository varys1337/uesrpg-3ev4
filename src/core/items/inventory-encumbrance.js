import { isShieldItem } from "./shield-utils.js";
import { resolveWeaponMaterialRule } from "./weapon-material.js";

export const PHYSICAL_ITEM_TYPES = Object.freeze([
  "item", "equipment", "weapon", "armor", "shield", "ammunition", "container", "scroll",
]);
const physicalTypes = new Set(PHYSICAL_ITEM_TYPES);
const nonnegative = (value, fallback = 0) => {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
};

export function getInventoryRules(item) {
  return item?.flags?.["uesrpg-3ev4"]?.inventoryRules ?? {};
}

export function getPhysicalItemUnitEnc(item) {
  const system = item?.system ?? {};
  const base = nonnegative(system.enc);
  if (item?.type !== "weapon") return base;
  const adjustment = Number(resolveWeaponMaterialRule(system).rule?.encDelta ?? 0);
  return Math.max(0, base + (Number.isFinite(adjustment) ? adjustment : 0));
}

export function getPhysicalItemQuantity(item) {
  return Math.trunc(nonnegative(item?.system?.quantity, 1));
}

export function getPhysicalItemRawEnc(item) {
  return getPhysicalItemUnitEnc(item) * getPhysicalItemQuantity(item);
}

/** A pointer is valid only when its entire parent chain exists and is acyclic. */
export function isValidInventoryContainment(item, inventory) {
  const resolve = id => typeof inventory?.get === "function" ? inventory.get(id)
    : Array.from(inventory?.contents ?? inventory ?? []).find(candidate => String(candidate?.id ?? candidate?._id ?? "").trim() === id);
  const seen = new Set([String(item?.id ?? item?._id ?? "").trim()]);
  let pointer = String(item?.system?.containerStats?.container_id ?? "").trim();
  if (!pointer) return false;
  while (pointer) {
    if (seen.has(pointer)) return false;
    seen.add(pointer);
    const parent = resolve(pointer);
    if (parent?.type !== "container" || parent.system?.isPhysicalObject === false) return false;
    pointer = String(parent.system?.containerStats?.container_id ?? "").trim();
  }
  return true;
}

/** Document-derived only. Invalid/cyclic containment never grants an ENC discount. */
export function buildInventoryEncumbrance(inventory = []) {
  const items = Array.from(inventory?.contents ?? inventory ?? []);
  const byId = new Map(items.map(item => [String(item?.id ?? item?._id ?? ""), item]));
  const rows = [];
  const totals = { totalEnc: 0, armorEncRaw: 0, excludedEnc: 0, zeroEncItemCount: 0, zeroEncEffectiveEnc: 0 };
  for (const item of items) {
    if (!physicalTypes.has(item?.type) || item?.system?.isPhysicalObject === false) continue;
    const rules = getInventoryRules(item);
    const enc = getPhysicalItemUnitEnc(item);
    const qty = getPhysicalItemQuantity(item);
    const isShield = isShieldItem(item, { allowLegacy: true });
    const equipped = item.system?.equipped === true;
    const isWornArmor = item.type === "armor" && equipped && !isShield;
    const hasWornOverride = equipped && rules.wornEnc !== undefined
      && rules.wornEnc !== null && Number.isFinite(Number(rules.wornEnc));
    const isWornClothing = hasWornOverride;
    const isContained = isValidInventoryContainment(item, byId);
    const invalidContainment = Boolean(String(item.system?.containerStats?.container_id ?? "").trim()) && !isContained;
    let unitEnc = hasWornOverride ? nonnegative(rules.wornEnc) : enc;
    if (item.flags?.["uesrpg-3ev4"]?.isBoundItem === true) unitEnc = 0;
    if (isWornArmor && !hasWornOverride) unitEnc = Math.floor(unitEnc / 2);
    let contributedEnc = unitEnc * qty;
    if (isContained) contributedEnc /= 2;
    if (rules.portable === false) contributedEnc = 0;
    if (enc === 0 && rules.portable !== false) totals.zeroEncItemCount += qty;
    totals.totalEnc += contributedEnc;
    if (isWornArmor) totals.armorEncRaw += enc * qty;
    rows.push({ itemId: item.id ?? item._id ?? "", name: item.name ?? "", type: item.type,
      qty, enc, contributedEnc, isContained, invalidContainment, isWornArmor, isWornClothing, isShield,
      nonportable: rules.portable === false });
  }
  // Retain the established actor-wide bulk rule, including for contained objects.
  totals.zeroEncEffectiveEnc = Math.floor(totals.zeroEncItemCount / 10);
  totals.totalEnc += totals.zeroEncEffectiveEnc;
  return { rows, totals };
}
