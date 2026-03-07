import { UESRPG } from "../../constants.js";
import {
  hasLegacyQuality,
  roundPriceUp,
  safeNumber,
} from "../item-utils.js";

export function prepareArmorItem(actorData, itemData) {
  const baseEnc = safeNumber(itemData.enc, 0);
  const basePrice = safeNumber(itemData.price, 0);

  const qualityKey = String(itemData.qualityLevel || "common").toLowerCase();
  const qRule = UESRPG.ARMOR_QUALITY_RULES?.[qualityKey] ?? UESRPG.ARMOR_QUALITY_RULES.common;
  const qualityPriceMult = safeNumber(qRule?.priceMult, 1.0);
  const weightDelta = safeNumber(qRule?.weightClassDelta, 0);

  const isShield = Boolean(itemData.isShield) || String(itemData.category || "").toLowerCase() === "shield";
  itemData.isShieldEffective = isShield;

  let derivedEnc = baseEnc;
  let derivedPrice = roundPriceUp(basePrice * qualityPriceMult);
  let derivedWeightClass = itemData.weightClass ?? "none";

  itemData.autoQualitiesStructured = [];

  const injected = itemData.qualitiesStructuredInjected ?? itemData.qualitiesStructured ?? [];
  const damagedQ = injected.find(q => q?.key === "damaged");
  const damagedValue = safeNumber(damagedQ?.value, 0);

  const stepWeightClass = (base, delta) => {
    const order = ["none", "light", "medium", "heavy", "superheavy", "crippling"];
    let i = order.indexOf(String(base || "none").toLowerCase());
    if (i === -1) i = 0;
    i = Math.max(0, Math.min(order.length - 1, i + delta));
    return order[i];
  };

  const materialKey = String(itemData.material || "").trim();

  if (isShield) {
    const shieldProfile = UESRPG.SHIELD_PROFILES?.[materialKey] ?? null;
    const typeKey = String(itemData.shieldType || "normal").toLowerCase();
    const typeRule = UESRPG.SHIELD_TYPE_RULES?.[typeKey] ?? UESRPG.SHIELD_TYPE_RULES.normal;
    itemData.treatAsFreeHandForSmallOrGrapple = (typeKey === "targe");

    if (shieldProfile) {
      derivedEnc = safeNumber(shieldProfile.enc, derivedEnc) + safeNumber(typeRule.encDelta, 0);
      derivedWeightClass = stepWeightClass(shieldProfile.weightClass, weightDelta + safeNumber(typeRule.weightClassDelta, 0));
      derivedPrice = roundPriceUp(safeNumber(shieldProfile.price, basePrice) * qualityPriceMult * safeNumber(typeRule.priceMult, 1.0));
      itemData.enchant_levelEffective = safeNumber(shieldProfile.enchantLevel, itemData.enchant_level);

      const brBase = safeNumber(shieldProfile.br, itemData.blockRating);
      const brMult = safeNumber(typeRule.brMult, 1.0);
      const br = (typeKey === "targe")
        ? Math.ceil(brBase * brMult)
        : Math.round(brBase * brMult);
      itemData.blockRatingEffective = Math.max(0, br - damagedValue);

      const magicBR = (shieldProfile.magicBR != null)
        ? safeNumber(shieldProfile.magicBR, 0)
        : safeNumber(shieldProfile.magicBRHalf, 0);
      itemData.magic_brEffective = Math.max(0, magicBR - damagedValue);
      itemData.magic_brSpecial = shieldProfile.magicBRSpecial ?? null;
    }
  } else {
    const armorClass = String(itemData.armorClass || "partial").toLowerCase();
    const profile = UESRPG.ARMOR_PROFILES?.[armorClass]?.[materialKey] ?? null;

    if (profile) {
      derivedEnc = safeNumber(profile.enc, derivedEnc);
      derivedWeightClass = stepWeightClass(profile.weightClass, weightDelta);
      derivedPrice = roundPriceUp(safeNumber(profile.priceBody, basePrice) * qualityPriceMult);
      itemData.enchant_levelEffective = safeNumber(profile.enchantLevel, itemData.enchant_level);

      const ar = safeNumber(profile.ar, itemData.armor);
      const magicAR = safeNumber(profile.magicAR, 0);
      itemData.armorEffective = Math.max(0, ar - damagedValue);
      itemData.magic_arEffective = Math.max(0, magicAR - damagedValue);
      itemData.special_ar_typeEffective = profile.magicARType || "";
    }
  }

  const hasRuned = itemData.runed === true
    || injected.some(q => String(q?.key ?? "").toLowerCase() === "runed")
    || hasLegacyQuality(itemData.qualities, "runed");
  if (hasRuned) {
    derivedPrice = roundPriceUp(Number(derivedPrice ?? 0) * 1.25);
  }

  itemData.encEffective = derivedEnc;
  itemData.priceEffective = derivedPrice;
  itemData.weightClassEffective = derivedWeightClass;
}
