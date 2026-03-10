import { UESRPG } from "../../constants.js";
import {
  addDiceBonus,
  halveDiceExpression,
  hasLegacyQuality,
  hasStructuredQuality,
  normalizeDiceExpression,
  parseRangeTriplet,
  roundPriceUp,
  safeNumber,
} from "../item-utils.js";

export function prepareWeaponItem(itemDoc, actorData, itemData) {
  itemData.weapon2H ? itemData.damage3 = itemData.damage2 : itemData.damage3 = itemData.damage;

  const baseDamage = normalizeDiceExpression(itemData.damage);
  const baseDamage2 = normalizeDiceExpression(itemData.damage2);
  const baseEnc = safeNumber(itemData.enc, 0);
  const basePrice = safeNumber(itemData.price, 0);

  const qualityKey = String(itemData.qualityLevel || "common").toLowerCase();
  const qRule = UESRPG.WEAPON_QUALITY_RULES?.[qualityKey] ?? UESRPG.WEAPON_QUALITY_RULES.common;

  const matKey = String(itemData.material || "iron").toLowerCase();
  const attackMode = String(itemData.attackMode || "melee").toLowerCase();

  const isThrown = hasStructuredQuality(itemData.qualitiesStructured, "thrown") || hasLegacyQuality(itemData.qualities, "thrown");
  const useMeleeMaterial = (attackMode === "melee") || (attackMode === "ranged" && isThrown);

  const injected = itemData.qualitiesStructuredInjected ?? itemData.qualitiesStructured ?? [];
  const traits = Array.isArray(itemData.qualitiesTraits) ? itemData.qualitiesTraits : [];
  const isSling = injected.some(q => String(q?.key ?? q ?? "").toLowerCase() === "sling")
    || traits.some(t => String(t ?? "").toLowerCase() === "sling")
    || hasLegacyQuality(itemData.qualities, "sling");

  const mRule = isSling
    ? (UESRPG.WEAPON_MATERIAL_RULES_SLING?.[matKey] ?? null)
    : (useMeleeMaterial
      ? (UESRPG.WEAPON_MATERIAL_RULES_MELEE?.[matKey] ?? null)
      : (UESRPG.WEAPON_MATERIAL_RULES_RANGED?.[matKey] ?? null));

  const damageMod = safeNumber(mRule?.damageMod, 0);
  const encDelta = safeNumber(mRule?.encDelta, 0);
  const matPriceMult = safeNumber(mRule?.priceMult, 1.0);
  const qualityPriceMult = safeNumber(qRule?.priceMult, 1.0);

  let special = null;
  if (useMeleeMaterial && mRule?.autoQualities?.some(q => q?.key === "specialDamageRule")) {
    special = mRule.autoQualities.find(q => q?.key === "specialDamageRule")?.value;
  }

  const nameLower = String(itemDoc.name ?? "").toLowerCase();
  const woodException = nameLower.includes("quarterstaff") || nameLower.includes("mace");

  const applyHalfDamage = (special === "bone") || (special === "wood" && !woodException);

  itemData.damageEffective = applyHalfDamage ? halveDiceExpression(baseDamage) : addDiceBonus(baseDamage, damageMod);
  itemData.damage2Effective = applyHalfDamage ? halveDiceExpression(baseDamage2) : addDiceBonus(baseDamage2, damageMod);
  itemData.damage3Effective = itemData.weapon2H ? itemData.damage2Effective : itemData.damageEffective;
  itemData.encEffective = baseEnc + encDelta;
  itemData.priceEffective = roundPriceUp(basePrice * matPriceMult * qualityPriceMult);
  itemData.enchant_levelEffective = (mRule?.enchantLevel != null)
    ? safeNumber(mRule.enchantLevel, 0)
    : safeNumber(itemData.enchant_level, 0);

  const hasRuned = itemData.runed === true
    || injected.some(q => String(q?.key ?? q ?? "").toLowerCase() === "runed")
    || hasLegacyQuality(itemData.qualities, "runed");
  if (hasRuned) {
    itemData.priceEffective = roundPriceUp(Number(itemData.priceEffective ?? 0) * 1.2);
  }

  const materialAuto = Array.isArray(mRule?.autoQualities) ? mRule.autoQualities : [];
  const qualityAuto = Array.isArray(qRule?.autoQualities) ? qRule.autoQualities : [];
  itemData.autoQualitiesStructured = [...qualityAuto, ...materialAuto]
    .filter(q => q?.key && q.key !== "specialDamageRule")
    .map(q => ({ key: q.key, value: q.value }));

  let reloadAPCost = 0;
  let requiresReload = false;

  if (attackMode === "ranged") {
    const storedRaw = Number(itemData?.reloadState?.reloadAPCost ?? 0);
    const stored = Number.isFinite(storedRaw) ? Math.max(0, Math.trunc(storedRaw)) : 0;

    const reloadQuality = injected.find(q => String(q?.key ?? "").toLowerCase() === "reload");
    const qRaw = (reloadQuality && reloadQuality.value !== undefined) ? Number(reloadQuality.value) : NaN;
    const fromQuality = Number.isFinite(qRaw) ? Math.max(0, Math.trunc(qRaw)) : 0;

    reloadAPCost = (stored > 0) ? stored : (fromQuality > 0 ? fromQuality : 0);
    requiresReload = reloadAPCost > 0;
  }

  itemData.reloadState = itemData.reloadState ?? {};
  itemData.reloadState.reloadAPCost = reloadAPCost;
  itemData.reloadState.requiresReload = requiresReload;
  if (itemData.reloadState.isLoaded === undefined) {
    itemData.reloadState.isLoaded = true;
  }
  if (itemData.reloadState.reloadProgress === undefined) {
    itemData.reloadState.reloadProgress = 0;
  }

  // Compute range bands for ranged weapons and thrown weapons (melee attackMode + thrown quality)
  // when system.range is a valid triplet. Thrown weapons that have their range stored only in
  // the qualities free-text fall through to the legacy parser in getWeaponRangeBands.
  if (attackMode === "ranged" || isThrown) {
    const parsed = parseRangeTriplet(itemData.range);
    if (parsed && Number.isFinite(parsed.long)) {
      const rangeMod = (mRule?.rangeMod != null) ? safeNumber(mRule.rangeMod, 0) : 0;
      const close = Math.max(0, Number(parsed.close) + rangeMod);
      const medium = Math.max(0, Number(parsed.effective) + rangeMod);
      const long = Math.max(0, Number(parsed.long) + rangeMod);

      itemData.rangeBandsDerived = {
        kind: isThrown ? "thrown" : "ranged",
        source: "rangeField",
        close: Number(parsed.close) || 0,
        medium: Number(parsed.effective) || 0,
        long: Number(parsed.long) || 0,
        rangeMod,
        display: `${close}/${medium}/${long}`
      };
      itemData.rangeBandsDerivedEffective = {
        kind: isThrown ? "thrown" : "ranged",
        source: "rangeField",
        close,
        medium,
        long,
        rangeMod,
        display: `${close}/${medium}/${long}`
      };
    }
  }
}
