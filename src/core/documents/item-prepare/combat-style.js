import { skillModHelper } from "../../../utils/skillCalcHelper.js";

export function prepareCombatStyleData(itemDoc, actorData, itemData) {
  const RANK_BONUS = { novice: 0, apprentice: 10, journeyman: 20, adept: 30, expert: 40, master: 50 };
  const rankBonus = RANK_BONUS[itemData.rank];
  if (rankBonus !== undefined) {
    itemData.bonus = rankBonus;
  } else {
    itemData.bonus = -20 + itemDoc._untrainedException(actorData);
  }

  const woundPenalty = Number(actorData.system?.woundPenalty || 0);
  const fatiguePenalty = Number(actorData.system?.fatigue?.penalty || 0);

  let itemSkillBonus = skillModHelper(actorData, itemDoc.name);
  let chaTotal = 0;
  if (itemData.baseCha !== undefined && itemData.baseCha !== "" && itemData.baseCha !== "none") {
    const characteristics = actorData?.system?.characteristics?.[itemData.baseCha];
    chaTotal = Number((characteristics?.total || 0) + itemData.bonus + (itemData.miscValue || 0));
  }

  itemData.value = Number(woundPenalty + fatiguePenalty + chaTotal + itemSkillBonus);
}
