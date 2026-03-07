import { UESRPG } from "../../constants.js";
import {
  addDiceBonus,
  normalizeDiceExpression,
  safeNumber,
} from "../item-utils.js";

export function prepareAmmunitionItem(actorData, itemData) {
  const baseDamage = normalizeDiceExpression(itemData.damage);
  const matKey = String(itemData.ammoMaterial || "iron").toLowerCase();
  const mRule = UESRPG.AMMO_MATERIAL_RULES?.[matKey] ?? null;

  const damageMod = safeNumber(mRule?.damageMod, 0);

  itemData.damageEffective = addDiceBonus(baseDamage, damageMod);
  itemData.enchant_levelEffective = (mRule?.enchantLevel != null)
    ? safeNumber(mRule.enchantLevel, 0)
    : safeNumber(itemData.enchant_level, 0);

  const materialAuto = Array.isArray(mRule?.autoQualities) ? mRule.autoQualities : [];
  itemData.autoQualitiesStructured = materialAuto
    .filter(q => q?.key)
    .map(q => ({ key: q.key, value: q.value }));
}
