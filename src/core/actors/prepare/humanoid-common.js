/**
 * @file Shared humanoid actor preparation
 * @module core/actors/prepare/humanoid-common
 */

import { aggregateItemStats } from "../rules/item-aggregation.js";
import { applyHumanoidCharacteristicsStage } from "./shared/humanoid-characteristics.js";
import { applyHumanoidDerivedStage } from "./shared/humanoid-derived.js";
import { applyHumanoidFatigueStage } from "./shared/humanoid-fatigue.js";
import { applyHumanoidMovementStage } from "./shared/humanoid-movement.js";
import { applyHumanoidSocialStage } from "./shared/humanoid-social.js";
import { applyNpcThreatTemplateStage } from "./shared/npc-threat-template.js";
import { getCarryAEModifiers } from "../ae/modifiers.js";
import { ARMOR_WEIGHT_CLASSES, buildArmorMobilityPenalties } from "../rules/armor-mobility.js";

/**
 * Shared prepare pipeline for humanoid actors (character + npc).
 *
 * @param {Object} actorContext
 * @param {Object} actorData
 * @param {Object} opts
 */
export function prepareHumanoidData(actorContext, actorData, opts = {}) {
  const actorSystemData = actorData.system;
  const agg = aggregateItemStats(actorContext, actorData);

  const armorAdjustment = getCarryAEModifiers(actorContext).armorWeightClass;
  const armorIndex = ARMOR_WEIGHT_CLASSES.indexOf(agg.mobility.armorWeightClass);
  const adjustedIndex = Math.max(0, Math.min(ARMOR_WEIGHT_CLASSES.length - 1,
    Math.trunc(armorAdjustment.override ?? (armorIndex + armorAdjustment.add))));
  actorSystemData.mobility = adjustedIndex === armorIndex ? agg.mobility
    : buildArmorMobilityPenalties(ARMOR_WEIGHT_CLASSES[adjustedIndex], agg.mobility.sources);
  const weightClass = String(actorSystemData.mobility?.armorWeightClass ?? "none").toLowerCase();
  actorSystemData.armor_class = (weightClass === "superheavy") ? "super_heavy" : weightClass;

  const stage = {
    actorContext,
    actorData,
    actorSystemData,
    agg,
    options: {
      isNPC: Boolean(opts.isNPC),
      useDwemerSphereSpeedOverride: Boolean(opts.useDwemerSphereSpeedOverride),
      useActorSkillModifierCalc: Boolean(opts.useActorSkillModifierCalc),
      applyFormShiftSkillBuffs: Boolean(opts.applyFormShiftSkillBuffs),
      cripplingSpeedPenalty: Number.isFinite(Number(opts.cripplingSpeedPenalty)) ? Number(opts.cripplingSpeedPenalty) : 0,
    },
    aeTotalsMap: null,
    characteristicBonuses: null,
    staminaAE: null,
    fatigueAEs: null,
  };

  applyHumanoidCharacteristicsStage(stage);
  applyHumanoidSocialStage(stage);
  applyHumanoidDerivedStage(stage);
  applyHumanoidMovementStage(stage);
  applyHumanoidFatigueStage(stage);
  applyNpcThreatTemplateStage(stage);
}
