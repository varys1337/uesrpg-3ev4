import { UESRPG } from "../../constants.js";
import {
  roundPriceUp,
  safeNumber,
} from "../item-utils.js";
import { getDamagedQualityValue, hasRunedQuality, stepWeightClass } from "./shared.js";

export function prepareShieldItem(actorData, itemData) {
  const baseEnc   = safeNumber(itemData.enc, 0);
  const basePrice = safeNumber(itemData.price, 0);

  const qualityKey       = String(itemData.qualityLevel || "common").toLowerCase();
  const qRule            = UESRPG.ARMOR_QUALITY_RULES?.[qualityKey] ?? UESRPG.ARMOR_QUALITY_RULES.common;
  const qualityPriceMult = safeNumber(qRule?.priceMult, 1.0);
  const weightDelta      = safeNumber(qRule?.weightClassDelta, 0);

  itemData.isShieldEffective = true;
  itemData.autoQualitiesStructured = [];

  const damagedValue = getDamagedQualityValue(itemData);

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

  if (hasRunedQuality(itemData)) {
    itemData.priceEffective = roundPriceUp(derivedPrice * 1.25);
  } else {
    itemData.priceEffective = derivedPrice;
  }

  itemData.encEffective         = derivedEnc;
  itemData.weightClassEffective = stepWeightClass(itemData.weightClass ?? "none", weightDelta);
  itemData.enchant_levelEffective = safeNumber(itemData.enchant_level, 0);
}
