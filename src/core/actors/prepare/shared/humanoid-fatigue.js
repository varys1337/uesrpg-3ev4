import { applyWoundThresholdAEs } from "../../ae/modifiers.js";
import { getActorTraitValue, isActorUndead } from "../../../traits/trait-registry.js";

export function applyHumanoidFatigueStage(stage) {
  const { actorContext, actorData, actorSystemData, agg, options } = stage;
  const fatigueAEs = stage.fatigueAEs ?? { bonus: { add: 0, override: null }, penalty: { add: 0, override: null } };

  for (const professionKey in actorSystemData.professions) {
    if (professionKey !== "profession1" && professionKey !== "profession2" && professionKey !== "profession3" && professionKey !== "commerce") continue;
    actorSystemData.professions[professionKey] === 0
      ? actorSystemData.professions[professionKey] = actorSystemData.skills[professionKey].tn
      : actorSystemData.professions[professionKey] = 0;
  }

  if (options.useActorSkillModifierCalc) {
    actorContext._calculateItemSkillModifiers(actorData, agg);
  } else if (agg.skillModifiers && Object.keys(agg.skillModifiers).length > 0) {
    for (const [skillName, value] of Object.entries(agg.skillModifiers)) {
      if (!actorSystemData.professions || !Object.prototype.hasOwnProperty.call(actorSystemData.professions, skillName)) continue;
      actorSystemData.professions[skillName] = Number(actorSystemData.professions[skillName] || 0) + Number(value);
      actorSystemData.professionsWound[skillName] = Number(actorSystemData.professionsWound[skillName] || 0) + Number(value);
    }
  }

  const woundState = game?.uesrpg?.wounds?.getWoundState?.(actorContext) ?? (actorSystemData.wounded ? "active" : "none");
  actorSystemData.wounded = woundState !== "none";
  const woundSuppressed = actorContext._hasWoundPenaltySuppression(actorData) || woundState === "suppressed";
  const woundActiveForPenalty = woundState === "active" || woundState === "treated";

  if (woundActiveForPenalty && !woundSuppressed) {
    const woundPenalty = agg.actorFlags.painIntolerant ? -30 : -20;
    actorSystemData.woundPenalty = actorContext._halfWoundPenalty(actorData) === true ? woundPenalty / 2 : woundPenalty;
    if (actorSystemData.professionsWound && actorSystemData.professions) {
      for (const skill in actorSystemData.professionsWound) actorSystemData.professionsWound[skill] = actorSystemData.professions[skill];
    }
  } else if (woundActiveForPenalty) {
    actorSystemData.woundPenalty = 0;
    if (actorSystemData.professionsWound && actorSystemData.professions) {
      for (const skill in actorSystemData.professionsWound) actorSystemData.professionsWound[skill] = actorSystemData.professions[skill];
    }
  } else {
    actorSystemData.woundPenalty = 0;
    for (const skill in actorSystemData.professionsWound) actorSystemData.professionsWound[skill] = actorSystemData.professions[skill];
  }

  {
    const modifier = fatigueAEs.bonus;
    if (modifier.override != null) actorSystemData.fatigue.bonus = Number(modifier.override);
    else if (modifier.add) actorSystemData.fatigue.bonus = Number(actorSystemData.fatigue.bonus ?? 0) + Number(modifier.add);
  }

  const negativeStamina = Math.max(0, -Number(actorSystemData.stamina.value ?? 0));
  actorSystemData.fatigue.level = negativeStamina + Number(actorSystemData.fatigue.bonus ?? 0);

  if (actorSystemData.fatigue.level > 0) {
    actorSystemData.fatigue.penalty = actorContext._calcFatiguePenalty(actorData);
  } else {
    actorSystemData.fatigue.level = 0;
    actorSystemData.fatigue.penalty = 0;
  }

  {
    const modifier = fatigueAEs.penalty;
    if (modifier.override != null) actorSystemData.fatigue.penalty = Number(modifier.override);
    else if (modifier.add) actorSystemData.fatigue.penalty = Number(actorSystemData.fatigue.penalty ?? 0) + Number(modifier.add);
  }

  if (isActorUndead(actorContext)) {
    actorSystemData.fatigue.penalty = 0;
  }

  applyWoundThresholdAEs(actorContext, actorSystemData);

  const weakBones = Math.max(0, Number(getActorTraitValue(actorContext, "weakBones", { mode: "max" })) || 0);
  if (weakBones > 0) {
    actorSystemData.wound_threshold.value = Math.max(0, Number(actorSystemData.wound_threshold.value ?? 0) - weakBones);
  }
}
