import { UESRPG } from "../../constants.js";
import {
  hasLegacyQuality,
  roundPriceUp,
  safeNumber,
} from "../item-utils.js";

export function prepareShieldItem(actorData, itemData) {
  const baseEnc   = safeNumber(itemData.enc, 0);
  const basePrice = safeNumber(itemData.price, 0);

  const qualityKey       = String(itemData.qualityLevel || "common").toLowerCase();
  const qRule            = UESRPG.ARMOR_QUALITY_RULES?.[qualityKey] ?? UESRPG.ARMOR_QUALITY_RULES.common;
  const qualityPriceMult = safeNumber(qRule?.priceMult, 1.0);
  const weightDelta      = safeNumber(qRule?.weightClassDelta, 0);

  const stepWeightClass = (base, delta) => {
    const order = ["none", "light", "medium", "heavy", "superheavy", "crippling"];
    let i = order.indexOf(String(base || "none").toLowerCase());
    if (i === -1) i = 0;
    i = Math.max(0, Math.min(order.length - 1, i + delta));
    return order[i];
  };

  itemData.isShieldEffective = true;
  itemData.autoQualitiesStructured = [];

  const injected = itemData.qualitiesStructuredInjected ?? itemData.qualitiesStructured ?? [];
  const damagedQ = injected.find(q => q?.key === "damaged");
  const damagedValue = safeNumber(damagedQ?.value, 0);

  // Shield type: only used for the targe free-hand flag. No longer modifies BR or ENC.
  const typeKey = String(itemData.shieldType || "normal").toLowerCase();
  itemData.treatAsFreeHandForSmallOrGrapple = (typeKey === "targe");

  // Block and Magic BR: header values are authoritative. Apply Damaged(X) reduction only.
  itemData.blockRatingEffective = Math.max(0, safeNumber(itemData.blockRating, 0) - damagedValue);
  itemData.magic_brEffective    = Math.max(0, safeNumber(itemData.magic_br, 0)    - damagedValue);
  itemData.magic_brSpecial      = null;

  // ENC and price: header values are authoritative. Quality price multiplier still applies.
  const derivedPrice = roundPriceUp(basePrice * qualityPriceMult);
  const derivedEnc   = baseEnc;

  const hasRuned = itemData.runed === true
    || injected.some(q => String(q?.key ?? "").toLowerCase() === "runed")
    || hasLegacyQuality(itemData.qualities, "runed");
  if (hasRuned) {
    itemData.priceEffective = roundPriceUp(derivedPrice * 1.25);
  } else {
    itemData.priceEffective = derivedPrice;
  }

  itemData.encEffective         = derivedEnc;
  itemData.weightClassEffective = stepWeightClass(itemData.weightClass ?? "none", weightDelta);
  itemData.enchant_levelEffective = safeNumber(itemData.enchant_level, 0);
}
