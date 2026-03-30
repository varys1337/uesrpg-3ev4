import { UESRPG } from "../../constants.js";
import {
  roundPriceUp,
  safeNumber,
} from "../item-utils.js";
import { isLegacyShieldSystemData } from "../../items/shield-utils.js";
import { prepareShieldItem } from "./shield.js";
import { getDamagedQualityValue, hasRunedQuality, stepWeightClass } from "./shared.js";

/**
 * Resolve the native coverage lane key from armorClass.
 * @param {string} armorClass
 * @returns {"full"|"partial"}
 */
function _nativeLane(armorClass) {
  return String(armorClass || "partial").toLowerCase() === "full" ? "full" : "partial";
}

/**
 * Read one manual armor lane from armorValues, falling back to legacy root fields.
 * Returns a safe numeric object; never throws.
 *
 * @param {object} itemData
 * @param {"full"|"partial"} lane
 * @returns {{ armor:number, magic_ar:number, special_ar:number, special_ar_type:string }}
 */
function _getManualLane(itemData, lane) {
  const src = itemData?.armorValues?.[lane] ?? {};
  return {
    armor:          Number(src.armor    ?? 0) || 0,
    magic_ar:       Number(src.magic_ar ?? 0) || 0,
    special_ar:     Number(src.special_ar ?? 0) || 0,
    special_ar_type: String(src.special_ar_type ?? "").trim().toLowerCase(),
  };
}

export function prepareArmorItem(actorData, itemData) {
  if (isLegacyShieldSystemData(itemData)) {
    prepareShieldItem(actorData, itemData);
    return;
  }

  const baseEnc   = safeNumber(itemData.enc, 0);
  const basePrice = safeNumber(itemData.price, 0);

  const qualityKey     = String(itemData.qualityLevel || "common").toLowerCase();
  const qRule          = UESRPG.ARMOR_QUALITY_RULES?.[qualityKey] ?? UESRPG.ARMOR_QUALITY_RULES.common;
  const qualityPriceMult = safeNumber(qRule?.priceMult, 1.0);
  const weightDelta    = safeNumber(qRule?.weightClassDelta, 0);

  itemData.isShieldEffective = false;
  itemData.autoQualitiesStructured = [];

  // Weight class: authored base + quality step (material no longer contributes).
  const derivedWeightClass = stepWeightClass(itemData.weightClass ?? "none", weightDelta);

  // Damaged quality value: applied after selecting the native lane.
  const damagedValue = getDamagedQualityValue(itemData);

  // Select the native lane and compute prepared effective values.
  // These fields are native-lane prep/display data only; combat runtime resolution lives in src/core/combat/armor-state.js.
  const nativeLane = _nativeLane(itemData.armorClass);
  const laneValues = _getManualLane(itemData, nativeLane);

  itemData.armorEffective       = Math.max(0, laneValues.armor    - damagedValue);
  itemData.magic_arEffective    = Math.max(0, laneValues.magic_ar - damagedValue);
  itemData.special_arEffective  = Math.max(0, laneValues.special_ar - damagedValue);
  itemData.special_ar_typeEffective = laneValues.special_ar_type;

  // ENC, price, and enchant level are fully manual — no material table derivation.
  const derivedPrice = roundPriceUp(basePrice * qualityPriceMult);
  const derivedEnc   = baseEnc;
  itemData.enchant_levelEffective = safeNumber(itemData.enchant_level, 0);

  // Runed price multiplier (quality flag, not AR mutation).
  const finalPrice = hasRunedQuality(itemData) ? roundPriceUp(derivedPrice * 1.25) : derivedPrice;

  itemData.encEffective        = derivedEnc;
  itemData.priceEffective      = finalPrice;
  itemData.weightClassEffective = derivedWeightClass;
}
