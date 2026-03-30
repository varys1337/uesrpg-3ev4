import {
  getActionPointsAEModifiers,
  getCarryAEModifiers,
  getFatigueAEModifiers,
  getLuckyUnluckySlotAEModifiers,
  getSpeedAEModifiers,
} from "../../ae/modifiers.js";
import { isDebugEnabled } from "../../../../utils/debug.js";
import { isResourceValueOvercapAllowed } from "./resources.js";

export function applyHumanoidMovementStage(stage) {
  const { actorContext, actorData, actorSystemData, agg, options, staminaAE } = stage;
  const { str, end, lck } = stage.characteristicBonuses;

  const carryAEs = getCarryAEModifiers(actorContext);
  stage.fatigueAEs = getFatigueAEModifiers(actorContext);

  {
    const bonus = (carryAEs.bonus.override != null)
      ? Number(carryAEs.bonus.override)
      : (Number(actorSystemData.carry_rating.bonus ?? 0) + Number(carryAEs.bonus.add ?? 0));
    actorSystemData.carry_rating.bonus = bonus;
  }

  const baseFormula = Math.floor((4 * str) + (2 * end));
  const baseMod = (carryAEs.base.override != null)
    ? Number(carryAEs.base.override)
    : Number(carryAEs.base.add ?? 0);
  const computedMax = baseFormula + baseMod + Number(actorSystemData.carry_rating.bonus ?? 0);
  const withAdd = computedMax + Number(carryAEs.override.add ?? 0);
  actorSystemData.carry_rating.max = (carryAEs.override.override != null)
    ? Number(carryAEs.override.override)
    : withAdd;

  actorSystemData.carry_rating.current = Number((agg.totalEnc - agg.excludedEnc).toFixed(1));

  const formShiftSkills = {};
  for (const item of actorData.items) {
    if ((item.name === "Survival" || item.name === "Navigate" || item.name === "Observe") && !formShiftSkills[item.name]) {
      formShiftSkills[item.name] = item;
    }
  }
  const applyFormShiftSkills = () => {
    const survival = formShiftSkills.Survival;
    const navigate = formShiftSkills.Navigate;
    const observe = formShiftSkills.Observe;
    if (survival?.system) survival.system.miscValue = 30;
    if (navigate?.system) navigate.system.miscValue = 30;
    if (observe?.system) observe.system.miscValue = 30;
  };

  if (agg.forms.wereWolf === true) {
    actorSystemData.resistance.silverR -= 5;
    actorSystemData.resistance.diseaseR += 200;
    actorSystemData.hp.max += 5;
    actorSystemData.stamina.max += 1;
    actorSystemData.speed.base += 9;
    actorSystemData.speed.value = actorContext._speedCalc(actorData);
    actorSystemData.speed.swimSpeed = Math.round(actorSystemData.speed.value / 2);
    actorSystemData.resistance.natToughness = 5;
    actorSystemData.wound_threshold.value += 5;
    actorSystemData.action_points.max -= 1;
    if (options.applyFormShiftSkillBuffs) applyFormShiftSkills();
  } else if (agg.forms.wereBat === true) {
    actorSystemData.resistance.silverR -= 5;
    actorSystemData.resistance.diseaseR += 200;
    actorSystemData.hp.max += 5;
    actorSystemData.stamina.max += 1;
    actorSystemData.speed.value = Math.round(actorContext._speedCalc(actorData) / 2);
    actorSystemData.speed.flySpeed = actorSystemData.speed.base + 9;
    actorSystemData.speed.swimSpeed = Math.round(actorSystemData.speed.value / 2);
    actorSystemData.resistance.natToughness = 5;
    actorSystemData.wound_threshold.value += 3;
    actorSystemData.action_points.max -= 1;
    if (options.applyFormShiftSkillBuffs) applyFormShiftSkills();
  } else if (agg.forms.wereBoar === true) {
    actorSystemData.resistance.silverR -= 5;
    actorSystemData.resistance.diseaseR += 200;
    actorSystemData.hp.max += 5;
    actorSystemData.speed.base += 9;
    actorSystemData.speed.value = actorContext._speedCalc(actorData);
    actorSystemData.speed.swimSpeed = Math.round(actorSystemData.speed.value / 2);
    actorSystemData.resistance.natToughness = 7;
    actorSystemData.wound_threshold.value += 5;
    actorSystemData.action_points.max -= 1;
    if (options.applyFormShiftSkillBuffs) applyFormShiftSkills();
  } else if (agg.forms.wereBear === true) {
    actorSystemData.resistance.silverR -= 5;
    actorSystemData.resistance.diseaseR += 200;
    actorSystemData.hp.max += 10;
    actorSystemData.stamina.max += 1;
    actorSystemData.speed.base += 5;
    actorSystemData.speed.value = actorContext._speedCalc(actorData);
    actorSystemData.speed.swimSpeed = Math.round(actorSystemData.speed.value / 2);
    actorSystemData.resistance.natToughness = 5;
    actorSystemData.wound_threshold.value += 5;
    actorSystemData.action_points.max -= 1;
    if (options.applyFormShiftSkillBuffs) applyFormShiftSkills();
  } else if (agg.forms.wereCrocodile === true) {
    actorSystemData.resistance.silverR -= 5;
    actorSystemData.resistance.diseaseR += 200;
    actorSystemData.hp.max += 5;
    actorSystemData.stamina.max += 1;
    actorSystemData.speed.value = Math.round(actorContext._addHalfSpeed(actorData));
    actorSystemData.speed.swimSpeed = Number(actorContext._speedCalc(actorData)) + 9;
    actorSystemData.resistance.natToughness = 5;
    actorSystemData.wound_threshold.value += 5;
    actorSystemData.action_points.max -= 1;
    if (options.applyFormShiftSkillBuffs) applyFormShiftSkills();
  } else if (agg.forms.wereVulture === true) {
    actorSystemData.resistance.silverR -= 5;
    actorSystemData.resistance.diseaseR += 200;
    actorSystemData.hp.max += 5;
    actorSystemData.stamina.max += 1;
    actorSystemData.speed.value = Math.round(actorContext._speedCalc(actorData) / 2);
    actorSystemData.speed.flySpeed = actorSystemData.speed.base + 9;
    actorSystemData.speed.swimSpeed = Math.round(actorSystemData.speed.value / 2);
    actorSystemData.resistance.natToughness = 5;
    actorSystemData.wound_threshold.value += 3;
    actorSystemData.action_points.max -= 1;
    if (options.applyFormShiftSkillBuffs) applyFormShiftSkills();
  } else if (agg.forms.vampireLord === true) {
    actorSystemData.resistance.fireR -= 1;
    actorSystemData.resistance.sunlightR -= 1;
    actorSystemData.speed.flySpeed = 5;
    actorSystemData.hp.max += 5;
    actorSystemData.magicka.max += 25;
    actorSystemData.resistance.natToughness = 3;
  }

  actorSystemData.speed.value = actorContext._addHalfSpeed(actorData);

  if (actorSystemData.carry_rating.current > actorSystemData.carry_rating.max * 3) {
    actorSystemData.carry_rating.label = "Crushing";
    actorSystemData.carry_rating.penalty = -40;
    actorSystemData.speed.value = 0;
    actorSystemData.stamina.max -= 5;
  } else if (actorSystemData.carry_rating.current > actorSystemData.carry_rating.max * 2) {
    actorSystemData.carry_rating.label = "Severe";
    actorSystemData.carry_rating.penalty = -20;
    actorSystemData.speed.value = Math.floor(actorSystemData.speed.value / 2);
    actorSystemData.stamina.max -= 3;
  } else if (actorSystemData.carry_rating.current > actorSystemData.carry_rating.max) {
    actorSystemData.carry_rating.label = "Moderate";
    actorSystemData.carry_rating.penalty = -10;
    actorSystemData.speed.value -= 1;
    actorSystemData.stamina.max -= 1;
  } else {
    actorSystemData.carry_rating.label = "Minimal";
    actorSystemData.carry_rating.penalty = 0;
  }

  {
    const modifier = carryAEs.encTestPenalty;
    if (modifier.override != null) actorSystemData.carry_rating.penalty = Number(modifier.override);
    else if (modifier.add) actorSystemData.carry_rating.penalty = Number(actorSystemData.carry_rating.penalty ?? 0) + Number(modifier.add);
  }

  {
    const modifier = carryAEs.encSpeedPenalty;
    const delta = (modifier.override != null) ? Number(modifier.override) : (modifier.add ? Number(modifier.add) : 0);
    if (delta) actorSystemData.speed.value = Math.max(0, Number(actorSystemData.speed.value ?? 0) + delta);
  }

  {
    const modifier = carryAEs.encStaminaPenalty;
    const delta = (modifier.override != null) ? Number(modifier.override) : (modifier.add ? Number(modifier.add) : 0);
    if (delta) actorSystemData.stamina.max = Number(actorSystemData.stamina.max ?? 0) + delta;
  }

  {
    const staminaMax = Number(actorSystemData.stamina.max ?? 0);
    if (staminaMax < 0) {
      const excess = Math.abs(Math.trunc(staminaMax));
      actorSystemData.stamina.max = 0;
      const allowOvercap = isResourceValueOvercapAllowed(staminaAE?.value);
      actorSystemData.stamina.value = allowOvercap
        ? Math.max(0, Number(actorSystemData.stamina.value ?? 0))
        : 0;
      actorSystemData.fatigue.bonus = Number(actorSystemData.fatigue.bonus ?? 0) + excess;
    }
  }

  const effectiveWeightClass = String(actorSystemData.mobility?.armorWeightClass ?? "none").toLowerCase();
  let speedPenalty = 0;
  if (effectiveWeightClass === "medium") speedPenalty = -1;
  else if (effectiveWeightClass === "heavy") speedPenalty = -2;
  else if (effectiveWeightClass === "superheavy") speedPenalty = -3;
  else if (effectiveWeightClass === "crippling") {
    if (options.cripplingSpeedPenalty === 0 && isDebugEnabled("aeLifecycleDebug")) {
      console.warn("uesrpg-3ev4 | Armor weight class 'crippling' equipped; mobility penalty table not finalized. No speed penalty applied.", actorContext);
    }
    speedPenalty = options.cripplingSpeedPenalty;
  }

  if (speedPenalty !== 0) {
    actorSystemData.speed.value = Math.max(0, Number(actorSystemData.speed.value || 0) + speedPenalty);
    actorSystemData.speed.swimSpeed = Math.max(0, Number(actorSystemData.speed.swimSpeed || 0) + speedPenalty);
  }

  actorContext._applyMovementRestrictionSemantics(actorData, actorSystemData);

  {
    const speedAE = getSpeedAEModifiers(actorContext);
    const modifier = speedAE?.value ?? { add: 0, override: null };
    if (modifier.override != null) actorSystemData.speed.value = Number(modifier.override);
    else if (modifier.add) actorSystemData.speed.value = Number(actorSystemData.speed.value ?? 0) + Number(modifier.add);
    actorSystemData.speed.value = Math.max(0, Math.trunc(Number(actorSystemData.speed.value ?? 0)));

    const baseSwim = Math.floor(Number(actorSystemData.speed.value ?? 0) / 2);
    const swimBonus = Number(agg.doubleSwimSpeed ? (agg.swimBonus * 2) : agg.swimBonus) || 0;
    actorSystemData.speed.swimSpeed = Math.max(0, baseSwim + swimBonus);

    const swimAE = speedAE?.swimSpeed ?? { add: 0, override: null };
    if (swimAE.override != null) actorSystemData.speed.swimSpeed = Math.max(0, Number(swimAE.override));
    else if (swimAE.add) actorSystemData.speed.swimSpeed = Math.max(0, actorSystemData.speed.swimSpeed + Number(swimAE.add));

    const flyAE = speedAE?.flySpeed ?? { add: 0, override: null };
    if (flyAE.override != null) actorSystemData.speed.flySpeed = Math.max(0, Number(flyAE.override));
    else if (flyAE.add) actorSystemData.speed.flySpeed = Math.max(0, Number(actorSystemData.speed.flySpeed ?? 0) + Number(flyAE.add));
  }

  {
    const actionPointAE = getActionPointsAEModifiers(actorContext);
    const asNumber = (value, fallback = 0) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    };

    let max = asNumber(actorSystemData.action_points?.max ?? 0, 0);
    if (actionPointAE.max?.override != null) max = asNumber(actionPointAE.max.override, max);
    else if (actionPointAE.max?.add) max += asNumber(actionPointAE.max.add, 0);
    max = Math.max(0, Math.trunc(max));

    let value = asNumber(actorSystemData.action_points?.value ?? 0, 0);
    if (actionPointAE.value?.override != null) value = asNumber(actionPointAE.value.override, value);
    else if (actionPointAE.value?.add) value += asNumber(actionPointAE.value.add, 0);

    actorSystemData.action_points.max = max;
    actorSystemData.action_points.value = Math.clamp(Math.trunc(value), 0, max);
  }

  {
    const slotAE = getLuckyUnluckySlotAEModifiers(actorContext);
    const asNumber = (value, fallback = 0) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    };
    const baseLucky = asNumber(lck, 0);
    const baseUnlucky = Math.max(0, 5 - baseLucky);

    const luckySlots = (slotAE.lucky?.override != null)
      ? asNumber(slotAE.lucky.override, baseLucky)
      : (baseLucky + asNumber(slotAE.lucky?.add ?? 0, 0));
    const unluckySlots = (slotAE.unlucky?.override != null)
      ? asNumber(slotAE.unlucky.override, baseUnlucky)
      : (baseUnlucky + asNumber(slotAE.unlucky?.add ?? 0, 0));

    actorSystemData.lucky_numbers ??= {};
    actorSystemData.unlucky_numbers ??= {};
    actorSystemData.lucky_numbers._activeSlots = Math.clamp(Math.trunc(luckySlots), 0, 10);
    actorSystemData.unlucky_numbers._activeSlots = Math.clamp(Math.trunc(unluckySlots), 0, 6);
  }
}
