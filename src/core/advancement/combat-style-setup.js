import { _num as asNumber } from "../../utils/coerce.js";
import { t } from "../../utils/i18n.js";
import { SPECIAL_ACTIONS_BY_ID } from "../config/special-actions.js";
import { SKILL_RANK_ORDER, SKILL_RANK_XP_COST, normalizeRank, isFavoredSkillForActor, discountCostIfFavored } from "./skill-advancement.js";
const RANK_OPTIONS = SKILL_RANK_ORDER;

export function computeCombatSetupCost(actor, input) {
  if (!input || !RANK_OPTIONS.includes(input.rank)) {
    return { ok: false, reason: t("UESRPG.Notifications.CharGen.InvalidCombatStyleRank") };
  }
  if (!Array.isArray(input.trainedEquipment) || input.trainedEquipment.length > 10
      || !Array.isArray(input.specialAdvantages) || input.specialAdvantages.some(id => !Object.hasOwn(SPECIAL_ACTIONS_BY_ID, id))) {
    return { ok: false, reason: t("UESRPG.Notifications.CharGen.InvalidCombatStyleSetup") };
  }

  const styleIsNew = input.styleId === "__new__";
  const style = styleIsNew ? null : (actor.items.get(input.styleId) ?? null);
  if (!styleIsNew && (!style || style.type !== "combatStyle")) {
    return { ok: false, reason: t("UESRPG.Notifications.CharGen.CombatStyleMissing") };
  }

  const currentRank = styleIsNew ? "untrained" : normalizeRank(style.system?.rank ?? "untrained");
  const targetRank = normalizeRank(input.rank);
  const currentIdx = SKILL_RANK_ORDER.indexOf(currentRank);
  const targetIdx = SKILL_RANK_ORDER.indexOf(targetRank);
  if (targetIdx < currentIdx) {
    return { ok: false, reason: t("UESRPG.Notifications.CharGen.CombatStyleCannotDecrease") };
  }

  const favored = styleIsNew
    ? isFavoredSkillForActor(actor, "str,agi")
    : isFavoredSkillForActor(actor, style.system?.governingCha ?? style.system?.baseCha ?? "");
  let rankCost = 0;
  if (targetIdx > currentIdx) {
    for (let idx = currentIdx + 1; idx <= targetIdx; idx += 1) {
      const rankKey = SKILL_RANK_ORDER[idx];
      const base = asNumber(SKILL_RANK_XP_COST[rankKey], 0);
      rankCost += discountCostIfFavored(base, favored);
    }
  }

  const currentTe = styleIsNew
    ? Array.from({ length: 10 }, () => "")
    : (Array.isArray(style.system?.trainedEquipment)
      ? style.system.trainedEquipment.map((v) => String(v ?? "").trim()).slice(0, 10)
      : Array.from({ length: 10 }, () => ""));
  while (currentTe.length < 10) currentTe.push("");
  const desiredTe = Array.from({ length: 10 }, (_, idx) => String(input.trainedEquipment[idx] ?? "").trim());
  const currentTeCount = currentTe.filter(Boolean).length;
  const desiredTeCount = desiredTe.filter(Boolean).length;
  const freeTe = styleIsNew ? 5 : currentTeCount;
  const teDeltaPaid = Math.max(0, desiredTeCount - freeTe);
  const teCost = teDeltaPaid > 0 ? 25 * teDeltaPaid : 0;

  const currentSa = styleIsNew ? {} : (style.system?.specialAdvantages ?? {});
  const currentSaCount = Object.values(currentSa).filter(Boolean).length;
  const nextSa = { ...currentSa };
  for (const sa of input.specialAdvantages) nextSa[sa] = true;
  const nextSaCount = Object.values(nextSa).filter(Boolean).length;
  const freeSa = styleIsNew ? 1 : currentSaCount;
  const saDeltaPaid = Math.max(0, nextSaCount - freeSa);
  const saCost = saDeltaPaid > 0 ? 25 * saDeltaPaid : 0;

  return {
    ok: true,
    styleIsNew,
    style,
    targetRank,
    favored,
    desiredTe,
    nextSa,
    actualXpCost: rankCost + teCost + saCost,
    xpCost: input.freeCombatStyle ? 0 : (rankCost + teCost + saCost),
    freeCombatStyle: Boolean(input.freeCombatStyle),
    breakdown: { rankCost, teCost, saCost },
  };
}
