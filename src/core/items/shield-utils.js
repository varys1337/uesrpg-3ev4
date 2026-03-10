/**
 * Canonical shield identity and shield-profile helpers.
 *
 * Compatibility window:
 * - Canonical shields: Item.type === "shield"
 * - Legacy shields: Item.type === "armor" with shield flags/category
 */

function _norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isLegacyShieldSystemData(system = {}) {
  const itemCat = _norm(system?.item_cat);
  const category = _norm(system?.category);
  return Boolean(system?.isShieldEffective ?? system?.isShield) || itemCat === "shield" || category === "shield";
}

export function isShieldItem(item, { allowLegacy = true } = {}) {
  if (!item) return false;
  const type = _norm(item.type);
  if (type === "shield") return true;
  if (!allowLegacy || type !== "armor") return false;
  return isLegacyShieldSystemData(item.system ?? {});
}

export function isEquippedShieldItem(item, { allowLegacy = true } = {}) {
  if (!isShieldItem(item, { allowLegacy })) return false;
  return item?.system?.equipped === true;
}

export function getShieldTypeKey(item) {
  return _norm(item?.system?.shieldType) || "normal";
}

export function listEquippedShields(actor, { includeBuckler = false, allowLegacy = true } = {}) {
  const items = actor?.items?.contents ?? actor?.items ?? [];
  const shields = [];
  for (const item of items) {
    if (!isEquippedShieldItem(item, { allowLegacy })) continue;
    if (!includeBuckler && getShieldTypeKey(item) === "buckler") continue;
    shields.push(item);
  }
  return shields;
}

export function hasEquippedShield(actor, opts = {}) {
  return listEquippedShields(actor, opts).length > 0;
}

export function hasEquippedShieldType(actor, typeKey, { allowLegacy = true } = {}) {
  const target = _norm(typeKey);
  if (!target) return false;
  const items = actor?.items?.contents ?? actor?.items ?? [];
  for (const item of items) {
    if (!isEquippedShieldItem(item, { allowLegacy })) continue;
    if (getShieldTypeKey(item) === target) return true;
  }
  return false;
}

export function getShieldBlockProfile(item, damageType = "physical") {
  if (!isShieldItem(item, { allowLegacy: true })) {
    return { isShield: false, shieldType: "normal", canBlock: false, baseBR: 0, magicBR: 0, effectiveBR: 0 };
  }

  const sys = item?.system ?? {};
  const shieldType = getShieldTypeKey(item);
  const canBlock = shieldType !== "buckler";
  const baseBR = Math.max(0, Number(sys.blockRatingEffective ?? sys.blockRating ?? 0) || 0);
  const magicBR = Math.max(0, Number(sys.magic_brEffective ?? sys.magic_br ?? 0) || 0);
  const dt = _norm(damageType);

  let effectiveBR = baseBR;
  if (dt && dt !== "physical") {
    if (magicBR > 0) {
      effectiveBR = magicBR;
    } else {
      effectiveBR = Math.ceil(baseBR / 2);
    }
  }

  return {
    isShield: true,
    shieldType,
    canBlock,
    baseBR,
    magicBR,
    effectiveBR: Math.max(0, effectiveBR),
    treatAsFreeHandForSmallOrGrapple: shieldType === "targe",
  };
}

