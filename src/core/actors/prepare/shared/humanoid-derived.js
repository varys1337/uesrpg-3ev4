import { isDebugEnabled } from "../../../../utils/debug.js";
import {
  applyResistanceAEModifiers,
  getInitiativeAEModifiers,
  getResourceAEModifiers,
} from "../../ae/modifiers.js";
import { applyTraitDerived } from "../../../traits/trait-registry.js";
import { getPredictionInitiativeAgiBonus } from "../../../traits/intellectual-talents.js";
import { applyRacialTalentDerivedBonuses, applyRacialTalentPostSpeedDerived } from "../../../traits/racial-talents.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { collectFeatureMods, applyFeatureModTotals, filterModsForApplication, applyWeaknessToResistance } from "../../../traits/features/collect-feature-mods.js";
import { reduceAllByStacking } from "../../../traits/features/stacking.js";
import { getSpeedAgiMultiplier } from "../../../system/homebrew.js";
import {
  applyHpResourceWithAEs,
  applyLuckResourceWithAEs,
  applyMagickaResourceWithAEs,
  applyStaminaResourceWithAEs,
} from "./resources.js";

export function applyHumanoidDerivedStage(stage) {
  const { actorContext, actorData, actorSystemData, agg, options } = stage;
  const { str, end, agi, int, wp, prc, lck } = stage.characteristicBonuses;

  actorSystemData.hp.bonus = agg.hpBonus;
  actorSystemData.magicka.bonus = agg.mpBonus;
  actorSystemData.stamina.bonus = agg.spBonus;
  actorSystemData.luck_points.bonus = agg.lpBonus;
  actorSystemData.wound_threshold.bonus = agg.wtBonus;
  actorSystemData.speed.bonus = agg.speedBonus;
  actorSystemData.initiative.bonus = agg.iniBonus;

  actorSystemData.resistance.diseaseR = agg.resist.diseaseR;
  actorSystemData.resistance.fireR = agg.resist.fireR;
  actorSystemData.resistance.frostR = agg.resist.frostR;
  actorSystemData.resistance.shockR = agg.resist.shockR;
  actorSystemData.resistance.poisonR = agg.resist.poisonR;
  actorSystemData.resistance.magicR = agg.resist.magicR;
  actorSystemData.resistance.natToughness = agg.resist.natToughnessR;
  actorSystemData.resistance.silverR = agg.resist.silverR;
  actorSystemData.resistance.sunlightR = agg.resist.sunlightR;

  applyRacialTalentDerivedBonuses({ actor: actorContext, actorSystemData, agg });

  const resistanceWithAE = applyResistanceAEModifiers(actorContext, actorSystemData.resistance);
  Object.assign(actorSystemData.resistance, resistanceWithAE);

  actorSystemData.ui = actorSystemData.ui ?? {};
  actorSystemData.ui.traitAutomation = agg.traitDamage ?? null;
  applyTraitDerived(actorSystemData, actorSystemData.ui.traitAutomation);

  try {
    const featureMods = collectFeatureMods({ actor: actorContext });
    const { byPath, totals } = reduceAllByStacking(featureMods);
    actorSystemData.ui.featureMods = featureMods;
    actorSystemData.ui.featureModsByPath = byPath;
    actorSystemData.ui.featureModTotals = totals;

    const applyMods = filterModsForApplication(featureMods);
    const { totals: applyTotals } = reduceAllByStacking(applyMods);
    applyFeatureModTotals(actorSystemData, applyTotals);
    applyWeaknessToResistance(actorSystemData);
  } catch (_featureErr) {
    if (isDebugEnabled("aeLifecycleDebug")) {
      console.debug("uesrpg | Feature mod collection failed (non-critical)", _featureErr);
    }
  }

  if (agg.actorFlags.isMechanical === true) {
    actorSystemData.wound_threshold.base = str + (end * 2);
  } else {
    actorSystemData.wound_threshold.base = str + end + wp + actorSystemData.wound_threshold.bonus;
  }
  actorSystemData.wound_threshold.value = actorSystemData.wound_threshold.base;
  actorSystemData.wound_threshold.value = actorContext._woundThresholdCalc(actorData);

  if (hasTalent(actorContext, "untouchable")) {
    actorSystemData.wound_threshold.value = Math.max(0, 3 * Number(lck || 0));
  }

  if (options.useDwemerSphereSpeedOverride && agg.actorFlags.dwemerSphere === true) {
    actorSystemData.speed.base = 16;
    actorSystemData.professions.evade = 70;
  } else {
    const agiMultiplier = getSpeedAgiMultiplier();
    actorSystemData.speed.base = str + (agiMultiplier * agi) + actorSystemData.speed.bonus;
  }
  actorSystemData.speed.value = actorContext._speedCalc(actorData);
  actorSystemData.speed.swimSpeed = Math.floor(actorSystemData.speed.value / 2);
  actorSystemData.speed.swimSpeed += agg.doubleSwimSpeed ? (agg.swimBonus * 2) : agg.swimBonus;
  actorSystemData.speed.flySpeed = agg.flyBonus || actorContext._flyCalc(actorData);
  applyRacialTalentPostSpeedDerived({ actor: actorContext, actorSystemData });

  {
    const initiativeAE = getInitiativeAEModifiers(actorContext);
    const asNumber = (value, fallback = 0) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    };
    const multiplierFrom = (modifier) => {
      if (modifier?.override != null) return asNumber(modifier.override, 1);
      return 1 + asNumber(modifier?.add ?? 0, 0);
    };

    const mAgi = multiplierFrom(initiativeAE.mult?.agi);
    const mInt = multiplierFrom(initiativeAE.mult?.int);
    const mPrc = multiplierFrom(initiativeAE.mult?.prc);
    const flat = (initiativeAE.flat?.override != null)
      ? asNumber(initiativeAE.flat.override, 0)
      : asNumber(initiativeAE.flat?.add ?? 0, 0);

    const agiForInitiative = getPredictionInitiativeAgiBonus({ actor: actorContext, agiBonus: agi, intBonus: int });
    let baseComponent = (asNumber(agiForInitiative) * mAgi) + (asNumber(int) * mInt) + (asNumber(prc) * mPrc) + flat;

    let bonusComponent = asNumber(actorSystemData.initiative.bonus ?? 0, 0);
    if (initiativeAE.bonus?.override != null) bonusComponent = asNumber(initiativeAE.bonus.override, 0);
    else if (initiativeAE.bonus?.add) bonusComponent += asNumber(initiativeAE.bonus.add, 0);

    if (initiativeAE.base?.override != null) baseComponent = asNumber(initiativeAE.base.override, 0);
    else if (initiativeAE.base?.add) baseComponent += asNumber(initiativeAE.base.add, 0);

    const baseTotal = Math.trunc(baseComponent + bonusComponent);
    actorSystemData.initiative.bonus = bonusComponent;
    actorSystemData.initiative.base = baseTotal;

    let value = asNumber(actorContext._iniCalc(actorData), baseTotal);
    if (initiativeAE.value?.override != null) value = asNumber(initiativeAE.value.override, value);
    else if (initiativeAE.value?.add) value += asNumber(initiativeAE.value.add, 0);

    actorSystemData.initiative.value = Math.trunc(value);
  }

  actorSystemData.hp.base = Math.ceil(actorSystemData.characteristics.end.total / 2);
  applyHpResourceWithAEs(actorSystemData, getResourceAEModifiers(actorContext, "hp"));

  actorSystemData.magicka.max = actorSystemData.characteristics.int.total + actorSystemData.magicka.bonus + actorContext._determineIbMp(actorData);
  applyMagickaResourceWithAEs(actorSystemData, getResourceAEModifiers(actorContext, "magicka"));

  actorSystemData.stamina.max = end + actorSystemData.stamina.bonus;
  stage.staminaAE = getResourceAEModifiers(actorContext, "stamina");
  applyStaminaResourceWithAEs(actorSystemData, stage.staminaAE);

  actorSystemData.luck_points.max = lck + actorSystemData.luck_points.bonus;
  applyLuckResourceWithAEs(actorSystemData, getResourceAEModifiers(actorContext, "luck_points"));
}
