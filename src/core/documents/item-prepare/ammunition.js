import {
  normalizeDiceExpression,
  safeNumber,
} from "../item-utils.js";

export function prepareAmmunitionItem(actorData, itemData) {
  // Damage, damage type, and enchant level are manual — no material table derivation.
  itemData.damageEffective        = normalizeDiceExpression(itemData.damage);
  itemData.damageTypeEffective    = String(itemData.damageType ?? "").trim().toLowerCase();
  itemData.enchant_levelEffective = safeNumber(itemData.enchant_level, 0);
  itemData.autoQualitiesStructured = [];
}
