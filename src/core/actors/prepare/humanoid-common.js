/**
 * @file Shared humanoid actor preparation
 * @module core/actors/prepare/humanoid-common
 */

import { isDebugEnabled } from "../../../utils/debug.js";
import { aggregateItemStats } from "../rules/item-aggregation.js";
import {
  buildActorAETotalsMap,
  getResourceAEModifiers,
  getInitiativeAEModifiers,
  getCarryAEModifiers,
  getFatigueAEModifiers,
  getSpeedAEModifiers,
  getActionPointsAEModifiers,
  getLuckyUnluckySlotAEModifiers,
  applyResistanceAEModifiers,
  applyWoundThresholdAEs
} from "../ae/modifiers.js";
import { applyTraitDerived, getActorTraitValue, isActorUndead } from "../../traits/trait-registry.js";
import { hasTalent } from "../../traits/talents-api.js";
import { getPredictionInitiativeAgiBonus } from "../../traits/intellectual-talents.js";
import { applyRacialTalentDerivedBonuses, applyRacialTalentPostSpeedDerived } from "../../traits/racial-talents.js";
import { collectFeatureMods, applyFeatureModTotals, filterModsForApplication, applyWeaknessToResistance } from "../../traits/features/collect-feature-mods.js";
import { reduceAllByStacking } from "../../traits/features/stacking.js";
import { getSocialStateFromSystem } from "../../social/social-data.js";
import { getSpeedAgiMultiplier } from "../../system/homebrew.js";
import {
  applyHpResourceWithAEs,
  applyMagickaResourceWithAEs,
  applyStaminaResourceWithAEs,
  applyLuckResourceWithAEs,
  isResourceValueOvercapAllowed
} from "./shared/resources.js";

const CHAR_BONUS_KEYS = [
  ["system.characteristics.str.bonus", "str"],
  ["system.characteristics.end.bonus", "end"],
  ["system.characteristics.agi.bonus", "agi"],
  ["system.characteristics.int.bonus", "int"],
  ["system.characteristics.wp.bonus", "wp"],
  ["system.characteristics.prc.bonus", "prc"],
  ["system.characteristics.prs.bonus", "prs"],
  ["system.characteristics.lck.bonus", "lck"],
];

function applyNpcThreatLuckyNumbers(actorSystemData) {
  const byThreat = {
    minorSolo:    { lucky: [0,0,0,0,0,0,0,0,0,0], unlucky: [95,96,97,98,99,100] },
    minorGroup:   { lucky: [1,0,0,0,0,0,0,0,0,0], unlucky: [0,96,97,98,99,100] },
    majorSolo:    { lucky: [1,2,0,0,0,0,0,0,0,0], unlucky: [0,0,97,98,99,100] },
    majorGroup:   { lucky: [1,2,3,0,0,0,0,0,0,0], unlucky: [0,0,0,98,99,100] },
    deadlySolo:   { lucky: [1,2,3,4,0,0,0,0,0,0], unlucky: [0,0,0,0,99,100] },
    deadlyGroup:  { lucky: [1,2,3,4,5,0,0,0,0,0], unlucky: [0,0,0,0,0,100] },
    legendarySolo:{ lucky: [1,2,3,4,5,6,7,8,9,10], unlucky: [0,0,0,0,0,0] },
    legendaryGroup:{ lucky: [1,2,3,4,5,6,7,8,9,10], unlucky: [0,0,0,0,0,0] },
  };
  const entry = byThreat[String(actorSystemData?.threat ?? "")];
  if (!entry) return;
  actorSystemData.lucky_numbers.ln1 = entry.lucky[0];
  actorSystemData.lucky_numbers.ln2 = entry.lucky[1];
  actorSystemData.lucky_numbers.ln3 = entry.lucky[2];
  actorSystemData.lucky_numbers.ln4 = entry.lucky[3];
  actorSystemData.lucky_numbers.ln5 = entry.lucky[4];
  actorSystemData.lucky_numbers.ln6 = entry.lucky[5];
  actorSystemData.lucky_numbers.ln7 = entry.lucky[6];
  actorSystemData.lucky_numbers.ln8 = entry.lucky[7];
  actorSystemData.lucky_numbers.ln9 = entry.lucky[8];
  actorSystemData.lucky_numbers.ln10 = entry.lucky[9];
  actorSystemData.unlucky_numbers.ul1 = entry.unlucky[0];
  actorSystemData.unlucky_numbers.ul2 = entry.unlucky[1];
  actorSystemData.unlucky_numbers.ul3 = entry.unlucky[2];
  actorSystemData.unlucky_numbers.ul4 = entry.unlucky[3];
  actorSystemData.unlucky_numbers.ul5 = entry.unlucky[4];
  actorSystemData.unlucky_numbers.ul6 = entry.unlucky[5];
}

/**
 * Shared prepare pipeline for humanoid actors (character + npc).
 * 
 * @param {Object} actorContext - Actor context with access to private helper methods
 * @param {Object} actorData - The actor's data (actorData.system contains derived values)
 * @param {Object} opts
 */
export function prepareHumanoidData(actorContext, actorData, opts = {}) {
  const isNPC = Boolean(opts.isNPC);
  const applyThreatLuckyNumbers = Boolean(opts.applyThreatLuckyNumbers);
  const useDwemerSphereSpeedOverride = Boolean(opts.useDwemerSphereSpeedOverride);
  const useActorSkillModifierCalc = Boolean(opts.useActorSkillModifierCalc);
  const applyFormShiftSkillBuffs = Boolean(opts.applyFormShiftSkillBuffs);
  const cripplingSpeedPenalty = Number.isFinite(Number(opts.cripplingSpeedPenalty)) ? Number(opts.cripplingSpeedPenalty) : 0;
  const actorSystemData = actorData.system;

  // PERF: optional profiling (comment out in production)
  // const t0 = actorContext._perfStart('_prepareHumanoidData');

  // Aggregate items once to avoid many item.filter() passes
  const agg = aggregateItemStats(actorContext, actorData);

  // --- Mobility penalties from effective armor weight class (Step 9 scaffold) ---
  // Compute once per prepare, store for later automation consumption.
  // Note: We apply only speed penalties directly here; the Agility test penalty is
  // stored on actor.system.mobility for skill-roll logic to consume later.
  const mobility = agg.mobility;
  actorSystemData.mobility = mobility;

  // Normalize legacy armor_class field (used later in this file) to reflect *effective* class.
  // This maintains backward compatibility with existing speed adjustment code paths.
  // Mapping: superheavy -> super_heavy
  const wc = String(mobility?.armorWeightClass ?? "none").toLowerCase();
  actorSystemData.armor_class = (wc === "superheavy") ? "super_heavy" : wc;

  //Add bonuses from items to Characteristics (use aggregated sums)
  actorSystemData.characteristics.str.total = actorSystemData.characteristics.str.base + agg.charBonus.str;
  actorSystemData.characteristics.end.total = actorSystemData.characteristics.end.base + agg.charBonus.end;
  actorSystemData.characteristics.agi.total = actorSystemData.characteristics.agi.base + agg.charBonus.agi;
  actorSystemData.characteristics.int.total = actorSystemData.characteristics.int.base + agg.charBonus.int;
  actorSystemData.characteristics.wp.total = actorSystemData.characteristics.wp.base + agg.charBonus.wp;
  actorSystemData.characteristics.prc.total = actorSystemData.characteristics.prc.base + agg.charBonus.prc;
  actorSystemData.characteristics.prs.total = actorSystemData.characteristics.prs.base + agg.charBonus.prs;
  actorSystemData.characteristics.lck.total = actorSystemData.characteristics.lck.base + agg.charBonus.lck;


  // Active Effects: apply characteristic additive modifiers
  {
    const cMods = actorSystemData.modifiers?.characteristics ?? {};
    actorSystemData.characteristics.str.total += Number(cMods.str ?? 0);
    actorSystemData.characteristics.end.total += Number(cMods.end ?? 0);
    actorSystemData.characteristics.agi.total += Number(cMods.agi ?? 0);
    actorSystemData.characteristics.int.total += Number(cMods.int ?? 0);
    actorSystemData.characteristics.wp.total += Number(cMods.wp ?? 0);
    actorSystemData.characteristics.prc.total += Number(cMods.prc ?? 0);
    actorSystemData.characteristics.prs.total += Number(cMods.prs ?? 0);
    actorSystemData.characteristics.lck.total += Number(cMods.lck ?? 0);
  }


  


  //Characteristic Bonuses
  const strBonus = Math.floor(actorSystemData.characteristics.str.total / 10);
  const endBonus = Math.floor(actorSystemData.characteristics.end.total / 10);
  const agiBonus = Math.floor(actorSystemData.characteristics.agi.total / 10);
  const intBonus = Math.floor(actorSystemData.characteristics.int.total / 10);
  const wpBonus = Math.floor(actorSystemData.characteristics.wp.total / 10);
  const prcBonus = Math.floor(actorSystemData.characteristics.prc.total / 10);
  const prsBonus = Math.floor(actorSystemData.characteristics.prs.total / 10);
  const lckBonus = Math.floor(actorSystemData.characteristics.lck.total / 10);

  // Set characteristic bonus values
  actorSystemData.characteristics.str.bonus = strBonus;
  actorSystemData.characteristics.end.bonus = endBonus;
  actorSystemData.characteristics.agi.bonus = agiBonus;
  actorSystemData.characteristics.int.bonus = intBonus;
  actorSystemData.characteristics.wp.bonus = wpBonus;
  actorSystemData.characteristics.prc.bonus = prcBonus;
  actorSystemData.characteristics.prs.bonus = prsBonus;
  actorSystemData.characteristics.lck.bonus = lckBonus;

  // Apply Active Effect modifiers to characteristic bonuses (e.g., Frenzied +SB)
  // These are applied AFTER calculation from total to ensure they modify the final bonus
  // Primes the actor-level AE totals map cache; all subsequent helper calls reuse it.
  const charBonusMods = buildActorAETotalsMap(actorContext);
  for (const [key, charKey] of CHAR_BONUS_KEYS) {
    if (!charKey || !actorSystemData.characteristics?.[charKey]) {
      // Silently skip - this is expected for some actor types
      continue;
    }
    const m = charBonusMods[key] ?? { add: 0, override: null };
    if (m.override != null) {
      actorSystemData.characteristics[charKey].bonus = Number(m.override);
    } else if (m.add) {
      actorSystemData.characteristics[charKey].bonus = Number(actorSystemData.characteristics[charKey].bonus ?? 0) + Number(m.add);
    }
  }

//Set Campaign Rank (RAW thresholds, synced with XP dialog in character-menus.js)
if (!isNPC) {
if (actorSystemData.xpTotal >= 7000) {
  actorSystemData.campaignRank = "Master"
} else if (actorSystemData.xpTotal >= 5500) {
  actorSystemData.campaignRank = "Expert"
} else if (actorSystemData.xpTotal >= 4000) {
  actorSystemData.campaignRank = "Adept"
} else if (actorSystemData.xpTotal >= 2500) {
  actorSystemData.campaignRank = "Journeyman"
} else if (actorSystemData.xpTotal >= 1000) {
  actorSystemData.campaignRank = "Apprentice"
} else {
  actorSystemData.campaignRank = "Novice"
}
}

  // RAW Chapter 1: Linguistics = IB - 2, max 4.
  // "Cyrodilic is free and doesn't count."
  {
    const ib = Number(actorSystemData.characteristics?.int?.bonus ?? 0);
    actorSystemData.linguistics = actorSystemData.linguistics ?? {};
    actorSystemData.linguistics.max = Math.min(4, Math.max(0, ib - 2));
    // Preserve existing known languages string
    actorSystemData.linguistics.known = actorSystemData.linguistics.known ?? "";
  }

  // Social data is canonical, linguistics.known remains a compatibility mirror.
  {
    const socialState = getSocialStateFromSystem(actorSystemData);
    actorSystemData.social = actorSystemData.social ?? {};
    actorSystemData.social.languages = actorSystemData.social.languages ?? {};
    actorSystemData.social.languages.entries = socialState.languages.entries;
    actorSystemData.social.factions = socialState.factions;
    actorSystemData.linguistics.known = socialState.languages.knownString;
  }

  //Talent/Power/Trait Resource Bonuses (use aggregated values)
  actorSystemData.hp.bonus = agg.hpBonus;
  actorSystemData.magicka.bonus = agg.mpBonus;
  actorSystemData.stamina.bonus = agg.spBonus;
  actorSystemData.luck_points.bonus = agg.lpBonus;
  actorSystemData.wound_threshold.bonus = agg.wtBonus;
  actorSystemData.speed.bonus = agg.speedBonus;
  actorSystemData.initiative.bonus = agg.iniBonus;

  //Talent/Power/Trait Resistance Bonuses (use aggregated values)
  actorSystemData.resistance.diseaseR = agg.resist.diseaseR;
  actorSystemData.resistance.fireR = agg.resist.fireR;
  actorSystemData.resistance.frostR = agg.resist.frostR;
  actorSystemData.resistance.shockR = agg.resist.shockR;
  actorSystemData.resistance.poisonR = agg.resist.poisonR;
  actorSystemData.resistance.magicR = agg.resist.magicR;
  actorSystemData.resistance.natToughness = agg.resist.natToughnessR;
  actorSystemData.resistance.silverR = agg.resist.silverR;
  actorSystemData.resistance.sunlightR = agg.resist.sunlightR;

  // Racial talents (Chapter 4): passive derived bonuses (legacy-safe).
  applyRacialTalentDerivedBonuses({ actor: actorContext, actorSystemData, agg });

  // Apply Active Effect modifiers to resistances (Chapter 4 expansion)
  // This ensures AE values are reflected in the actor sheet display
  const resistanceWithAE = applyResistanceAEModifiers(actorContext, actorSystemData.resistance);
  Object.assign(actorSystemData.resistance, resistanceWithAE);

  actorSystemData.ui = actorSystemData.ui ?? {};
  actorSystemData.ui.traitAutomation = agg.traitDamage ?? null;
  applyTraitDerived(actorSystemData, actorSystemData.ui.traitAutomation);

  // Feature Automation (Chapter 4): collect provenance-tracked contributions
  // for the Feature Inspector and Rule Element application.
  //
  // The full mods array feeds the Feature Inspector display (read-only).
  // For actual application to actor data, we filter to ONLY Rule Element
  // contributions, boolean flags, and set/override values — item schema
  // bonus/resistance fields are already handled by aggregation above.
  try {
    const featureMods = collectFeatureMods({ actor: actorContext });
    const { byPath, totals } = reduceAllByStacking(featureMods);
    actorSystemData.ui.featureMods = featureMods;
    actorSystemData.ui.featureModsByPath = byPath;
    actorSystemData.ui.featureModTotals = totals;

    // Apply ONLY Rule Element and override/flag totals — legacy-mirror
    // "add" mods from item schema fields are excluded to prevent double-counting.
    const applyMods = filterModsForApplication(featureMods);
    const { totals: applyTotals } = reduceAllByStacking(applyMods);
    applyFeatureModTotals(actorSystemData, applyTotals);
    applyWeaknessToResistance(actorSystemData);
  } catch (_featureErr) {
    // Non-critical: Feature Inspector will just show empty.
    if (isDebugEnabled("aeLifecycleDebug")) console.debug("uesrpg | Feature mod collection failed (non-critical)", _featureErr);
  }

  //Derived Calculations
  if (agg.actorFlags.isMechanical === true) {
    actorSystemData.wound_threshold.base = strBonus + (endBonus * 2);
  } else {
    actorSystemData.wound_threshold.base = strBonus + endBonus + wpBonus + (actorSystemData.wound_threshold.bonus);
  }
  actorSystemData.wound_threshold.value = actorSystemData.wound_threshold.base;
  actorSystemData.wound_threshold.value = actorContext._woundThresholdCalc(actorData);

  // Untouchable (Chapter 4): replace WT with 3 × Luck Bonus (derived only; do not persist).
  if (hasTalent(actorContext, "untouchable")) {
    actorSystemData.wound_threshold.value = Math.max(0, 3 * Number(lckBonus || 0));
  }

  if (useDwemerSphereSpeedOverride && agg.actorFlags.dwemerSphere === true) {
    actorSystemData.speed.base = 16;
    actorSystemData.professions.evade = 70;
  } else {
    const agiMult = getSpeedAgiMultiplier();
    actorSystemData.speed.base = strBonus + (agiMult * agiBonus) + (actorSystemData.speed.bonus);
  }
  actorSystemData.speed.value = actorContext._speedCalc(actorData);
  actorSystemData.speed.swimSpeed = Math.floor(actorSystemData.speed.value/2);
  actorSystemData.speed.swimSpeed += agg.doubleSwimSpeed ? (agg.swimBonus * 2) : agg.swimBonus;
  actorSystemData.speed.flySpeed = agg.flyBonus || actorContext._flyCalc(actorData);
  applyRacialTalentPostSpeedDerived({ actor: actorContext, actorSystemData });

  // Initiative Rating (IR): derived formula + deterministic AE lanes
  // Base formula (default): IR = AB + IB + PcB + bonus
  // Special formula support: IR = AB*mAgi + IB*mInt + PcB*mPrc + flat + bonus
  {
    const iniAE = getInitiativeAEModifiers(actorContext);

    const asNum = (v, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };

    const multFrom = (m) => {
      if (m?.override != null) return asNum(m.override, 1);
      // ADD is treated as delta on top of 1
      return 1 + asNum(m?.add ?? 0, 0);
    };

    const mAgi = multFrom(iniAE.mult?.agi);
    const mInt = multFrom(iniAE.mult?.int);
    const mPrc = multFrom(iniAE.mult?.prc);

    const flat = (iniAE.flat?.override != null) ? asNum(iniAE.flat.override, 0) : asNum(iniAE.flat?.add ?? 0, 0);

    // Base component from characteristic bonuses (post-AE characteristic-bonus stage)
    // Prediction (Chapter 4): use Int bonus in place of Agi bonus for Initiative Rating.
    const agiForInitiative = getPredictionInitiativeAgiBonus({ actor: actorContext, agiBonus, intBonus });
    let baseComponent = (asNum(agiForInitiative) * mAgi) + (asNum(intBonus) * mInt) + (asNum(prcBonus) * mPrc) + flat;

    // Bonus component (from items/talents) with AE support
    let bonusComponent = asNum(actorSystemData.initiative.bonus ?? 0, 0);
    if (iniAE.bonus?.override != null) bonusComponent = asNum(iniAE.bonus.override, 0);
    else if (iniAE.bonus?.add) bonusComponent = bonusComponent + asNum(iniAE.bonus.add, 0);

    // Base lane AE support (applies to baseComponent only)
    if (iniAE.base?.override != null) baseComponent = asNum(iniAE.base.override, 0);
    else if (iniAE.base?.add) baseComponent = baseComponent + asNum(iniAE.base.add, 0);

    const baseTotal = Math.trunc(baseComponent + bonusComponent);

    actorSystemData.initiative.bonus = bonusComponent;
    actorSystemData.initiative.base = baseTotal;

    // Item-based replacement (legacy trait/talent replace.ini semantics)
    let value = asNum(actorContext._iniCalc(actorData), baseTotal);

    // Final value lane AE support (post-replacement)
    if (iniAE.value?.override != null) value = asNum(iniAE.value.override, value);
    else if (iniAE.value?.add) value = value + asNum(iniAE.value.add, 0);

    actorSystemData.initiative.value = Math.trunc(value);
  }


// Health / Magicka / Stamina / Luck Points
// Active Effects: deterministic resource max pipeline.
//
// Effects authoring contract (recommended):
//  - Use keys under system.modifiers.<resource>.<base|bonus|max|value>
//  - ADD: treated as additive
//  - OVERRIDE: sets the corresponding derived component directly (ADDs ignored for that key)
//
// NOTE: This system recomputes derived stats each prepare cycle, so we cannot rely on Foundry
// directly applying changes to derived fields like system.hp.max.

// HP
actorSystemData.hp.base = Math.ceil(actorSystemData.characteristics.end.total / 2);
const hpAE = getResourceAEModifiers(actorContext, 'hp');
applyHpResourceWithAEs(actorSystemData, hpAE);

// Magicka
actorSystemData.magicka.max = actorSystemData.characteristics.int.total + actorSystemData.magicka.bonus + actorContext._determineIbMp(actorData);
const mAE = getResourceAEModifiers(actorContext, 'magicka');
applyMagickaResourceWithAEs(actorSystemData, mAE);

// Stamina — sAE declared outside block so it can be reused in the negative-SP-max check below.
actorSystemData.stamina.max = endBonus + actorSystemData.stamina.bonus;
const sAE = getResourceAEModifiers(actorContext, 'stamina');
applyStaminaResourceWithAEs(actorSystemData, sAE);

// Luck Points
actorSystemData.luck_points.max = lckBonus + actorSystemData.luck_points.bonus;
const lAE = getResourceAEModifiers(actorContext, 'luck_points');
applyLuckResourceWithAEs(actorSystemData, lAE);

  // Carry Rating (base formula) + deterministic AE modifiers
  const carryAEs = getCarryAEModifiers(actorContext);
  const fatigueAEs = getFatigueAEModifiers(actorContext);

  // Bonus lane modifies carry_rating.bonus
  {
    const bonus = (carryAEs.bonus.override != null)
      ? Number(carryAEs.bonus.override)
      : (Number(actorSystemData.carry_rating.bonus ?? 0) + Number(carryAEs.bonus.add ?? 0));
    actorSystemData.carry_rating.bonus = bonus;
  }

  // Base formula lane (4*STR + 2*END) plus optional base modifier
  const baseFormula = Math.floor((4 * strBonus) + (2 * endBonus));
  const baseMod = (carryAEs.base.override != null)
    ? Number(carryAEs.base.override)
    : Number(carryAEs.base.add ?? 0);

  const computedMax = baseFormula + baseMod + Number(actorSystemData.carry_rating.bonus ?? 0);
  const withAdd = computedMax + Number(carryAEs.override.add ?? 0);

  // Override lane: hard set carry_rating.max (OVERRIDE), otherwise apply additive.
  actorSystemData.carry_rating.max = (carryAEs.override.override != null)
    ? Number(carryAEs.override.override)
    : withAdd;
  
  // RAW Chapter 1: "Total ENC = sum of ENC of all equipment they are carrying"
  // RAW Chapter 7: "ENC is halved when armor is worn (but not for carried shields)"
  // Note: agg.totalEnc already has worn armor halved and contained items halved
  // agg.excludedEnc contains items flagged to not count (already subtracted from totalEnc)
  actorSystemData.carry_rating.current = Number((agg.totalEnc - agg.excludedEnc).toFixed(1));

  //Form Shift Calcs
  // Pre-index skill items for form-shift lookups (single pass replaces 18 linear scans)
  const _formShiftSkills = {};
  for (const item of actorData.items) {
    if ((item.name === 'Survival' || item.name === 'Navigate' || item.name === 'Observe') && !_formShiftSkills[item.name]) {
      _formShiftSkills[item.name] = item;
    }
  }
  const _applyFormShiftSkills = () => {
    const s = _formShiftSkills['Survival']; if (s?.system) s.system.miscValue = 30;
    const n = _formShiftSkills['Navigate']; if (n?.system) n.system.miscValue = 30;
    const o = _formShiftSkills['Observe']; if (o?.system) o.system.miscValue = 30;
  };

  if (agg.forms.wereWolf === true) {
    actorSystemData.resistance.silverR = actorSystemData.resistance.silverR - 5;
    actorSystemData.resistance.diseaseR = actorSystemData.resistance.diseaseR + 200;
    actorSystemData.hp.max = actorSystemData.hp.max + 5;
    actorSystemData.stamina.max = actorSystemData.stamina.max + 1;
    actorSystemData.speed.base = actorSystemData.speed.base + 9;
    actorSystemData.speed.value = actorContext._speedCalc(actorData);
    actorSystemData.speed.swimSpeed = Math.round(actorSystemData.speed.value/2);
    actorSystemData.resistance.natToughness = 5;
    actorSystemData.wound_threshold.value = actorSystemData.wound_threshold.value + 5;
    actorSystemData.action_points.max = actorSystemData.action_points.max - 1;
    if (applyFormShiftSkillBuffs) _applyFormShiftSkills();
  } else if (agg.forms.wereBat === true) {
      actorSystemData.resistance.silverR = actorSystemData.resistance.silverR - 5;
      actorSystemData.resistance.diseaseR = actorSystemData.resistance.diseaseR + 200;
      actorSystemData.hp.max = actorSystemData.hp.max + 5;
      actorSystemData.stamina.max = actorSystemData.stamina.max + 1;
      actorSystemData.speed.value = Math.round(actorContext._speedCalc(actorData)/2);
      actorSystemData.speed.flySpeed = actorSystemData.speed.base + 9;
      actorSystemData.speed.swimSpeed = Math.round(actorSystemData.speed.value/2);
      actorSystemData.resistance.natToughness = 5;
      actorSystemData.wound_threshold.value = actorSystemData.wound_threshold.value + 3;
      actorSystemData.action_points.max = actorSystemData.action_points.max - 1;
      if (applyFormShiftSkillBuffs) _applyFormShiftSkills();
  } else if (agg.forms.wereBoar === true) {
      actorSystemData.resistance.silverR = actorSystemData.resistance.silverR - 5;
      actorSystemData.resistance.diseaseR = actorSystemData.resistance.diseaseR + 200;
      actorSystemData.hp.max = actorSystemData.hp.max + 5;
      actorSystemData.speed.base = actorSystemData.speed.base + 9;
      actorSystemData.speed.value = actorContext._speedCalc(actorData);
      actorSystemData.speed.swimSpeed = Math.round(actorSystemData.speed.value/2);
      actorSystemData.resistance.natToughness = 7;
      actorSystemData.wound_threshold.value = actorSystemData.wound_threshold.value + 5;
      actorSystemData.action_points.max = actorSystemData.action_points.max - 1;
      if (applyFormShiftSkillBuffs) _applyFormShiftSkills();
  } else if (agg.forms.wereBear === true) {
      actorSystemData.resistance.silverR = actorSystemData.resistance.silverR - 5;
      actorSystemData.resistance.diseaseR = actorSystemData.resistance.diseaseR + 200;
      actorSystemData.hp.max = actorSystemData.hp.max + 10;
      actorSystemData.stamina.max = actorSystemData.stamina.max + 1;
      actorSystemData.speed.base = actorSystemData.speed.base + 5;
      actorSystemData.speed.value = actorContext._speedCalc(actorData);
      actorSystemData.speed.swimSpeed = Math.round(actorSystemData.speed.value/2);
      actorSystemData.resistance.natToughness = 5;
      actorSystemData.wound_threshold.value = actorSystemData.wound_threshold.value + 5;
      actorSystemData.action_points.max = actorSystemData.action_points.max - 1;
      if (applyFormShiftSkillBuffs) _applyFormShiftSkills();
  } else if (agg.forms.wereCrocodile === true) {
      actorSystemData.resistance.silverR = actorSystemData.resistance.silverR - 5;
      actorSystemData.resistance.diseaseR = actorSystemData.resistance.diseaseR + 200;
      actorSystemData.hp.max = actorSystemData.hp.max + 5;
      actorSystemData.stamina.max = actorSystemData.stamina.max + 1;
      actorSystemData.speed.value = Math.round(actorContext._addHalfSpeed(actorData));
      actorSystemData.speed.swimSpeed = parseFloat(actorContext._speedCalc(actorData)) + 9;
      actorSystemData.resistance.natToughness = 5;
      actorSystemData.wound_threshold.value = actorSystemData.wound_threshold.value + 5;
      actorSystemData.action_points.max = actorSystemData.action_points.max - 1;
      if (applyFormShiftSkillBuffs) _applyFormShiftSkills();
  } else if (agg.forms.wereVulture === true) {
      actorSystemData.resistance.silverR = actorSystemData.resistance.silverR - 5;
      actorSystemData.resistance.diseaseR = actorSystemData.resistance.diseaseR + 200;
      actorSystemData.hp.max = actorSystemData.hp.max + 5;
      actorSystemData.stamina.max = actorSystemData.stamina.max + 1;
      actorSystemData.speed.value = Math.round(actorContext._speedCalc(actorData)/2);
      actorSystemData.speed.flySpeed = actorSystemData.speed.base + 9;
      actorSystemData.speed.swimSpeed = Math.round(actorSystemData.speed.value/2);
      actorSystemData.resistance.natToughness = 5;
      actorSystemData.wound_threshold.value = actorSystemData.wound_threshold.value + 3;
      actorSystemData.action_points.max = actorSystemData.action_points.max - 1;
      if (applyFormShiftSkillBuffs) _applyFormShiftSkills();
  } else if (agg.forms.vampireLord === true) {
      actorSystemData.resistance.fireR = actorSystemData.resistance.fireR - 1;
      actorSystemData.resistance.sunlightR = actorSystemData.resistance.sunlightR - 1;
      actorSystemData.speed.flySpeed = 5;
      actorSystemData.hp.max = actorSystemData.hp.max + 5;
      actorSystemData.magicka.max = actorSystemData.magicka.max + 25;
      actorSystemData.resistance.natToughness = 3;
  }

  //Speed Recalculation
  actorSystemData.speed.value = actorContext._addHalfSpeed(actorData);

  //ENC Burden Calculations
  if (actorSystemData.carry_rating.current > actorSystemData.carry_rating.max * 3) {
    actorSystemData.carry_rating.label = 'Crushing'
    actorSystemData.carry_rating.penalty = -40
    actorSystemData.speed.value = 0;
    actorSystemData.stamina.max = actorSystemData.stamina.max - 5;
  } else if (actorSystemData.carry_rating.current > actorSystemData.carry_rating.max * 2) {
    actorSystemData.carry_rating.label = 'Severe'
    actorSystemData.carry_rating.penalty = -20
    actorSystemData.speed.value = Math.floor(actorSystemData.speed.value / 2);
    actorSystemData.stamina.max = actorSystemData.stamina.max - 3;
  } else if (actorSystemData.carry_rating.current > actorSystemData.carry_rating.max) {
    actorSystemData.carry_rating.label = 'Moderate'
    actorSystemData.carry_rating.penalty = -10
    actorSystemData.speed.value = actorSystemData.speed.value - 1;
    actorSystemData.stamina.max = actorSystemData.stamina.max - 1;
  } else if (actorSystemData.carry_rating.current <= actorSystemData.carry_rating.max) {
    actorSystemData.carry_rating.label = 'Minimal'
    actorSystemData.carry_rating.penalty = 0
  }

  // Encumbrance penalty AE modifier (applies after burden bracket computation)
  {
    const m = (carryAEs?.encTestPenalty) ? carryAEs.encTestPenalty : getCarryAEModifiers(actorContext).encTestPenalty;
    if (m.override != null) actorSystemData.carry_rating.penalty = Number(m.override);
    else if (m.add) actorSystemData.carry_rating.penalty = Number(actorSystemData.carry_rating.penalty ?? 0) + Number(m.add);
  }

  // Encumbrance speed penalty AE modifier (RAW lane: modifies the encumbrance-applied speed penalty only).
  // Semantics: ADD is applied as a post-bracket delta to current speed.value; OVERRIDE sets that delta.
  {
    const m = (carryAEs?.encSpeedPenalty) ? carryAEs.encSpeedPenalty : getCarryAEModifiers(actorContext).encSpeedPenalty;
    const delta = (m.override != null) ? Number(m.override) : (m.add ? Number(m.add) : 0);
    if (delta) actorSystemData.speed.value = Math.max(0, Number(actorSystemData.speed.value ?? 0) + delta);
  }

  // Encumbrance stamina penalty AE modifier (RAW lane: modifies the encumbrance-applied SP max penalty only).
  // Semantics: ADD is applied as a post-bracket delta to current stamina.max; OVERRIDE sets that delta.
  {
    const m = (carryAEs?.encStaminaPenalty) ? carryAEs.encStaminaPenalty : getCarryAEModifiers(actorContext).encStaminaPenalty;
    const delta = (m.override != null) ? Number(m.override) : (m.add ? Number(m.add) : 0);
    if (delta) actorSystemData.stamina.max = Number(actorSystemData.stamina.max ?? 0) + delta;
  }


  // RAW: If encumbrance Stamina Penalty would reduce SP max below 0, excess converts into fatigue levels.
  // Implementation: keep stamina.max at 0 (never negative) and add the excess as derived fatigue.bonus.
  // This is derived-only; we do not persist document changes.
  {
    const spMax = Number(actorSystemData.stamina.max ?? 0);
    if (spMax < 0) {
      const excess = Math.abs(Math.trunc(spMax));
      actorSystemData.stamina.max = 0;
      // Ensure current SP does not exceed the new max.
      // If a deterministic AE `.value` modifier is present for Stamina, we allow overcap and do not
// force current SP down to 0 here. Otherwise, keep the normal invariant (value <= max).
// sAE is the same result from the stamina block above — no re-evaluation needed.
const stamina_allowOvercap = isResourceValueOvercapAllowed(sAE.value);
actorSystemData.stamina.value = stamina_allowOvercap
? Math.max(0, Number(actorSystemData.stamina.value ?? 0))
: 0;
      actorSystemData.fatigue.bonus = Number(actorSystemData.fatigue.bonus ?? 0) + excess;
    }
  }

  // Armor Weight Class Calculations
  // Use effective armor weight class as authoritative input (per contract).
  // We apply speed penalties here to keep existing derived speed math intact.
  const effWC = String(actorSystemData.mobility?.armorWeightClass ?? "none").toLowerCase();
  let spdPenalty = 0;
  if (effWC === "medium") spdPenalty = -1;
  else if (effWC === "heavy") spdPenalty = -2;
  else if (effWC === "superheavy") spdPenalty = -3;
  else if (effWC === "crippling") {
    if (cripplingSpeedPenalty === 0 && isDebugEnabled("aeLifecycleDebug")) {
      console.warn("uesrpg-3ev4 | Armor weight class 'crippling' equipped; mobility penalty table not finalized. No speed penalty applied.", actorContext);
    }
    spdPenalty = cripplingSpeedPenalty;
  }

  if (spdPenalty !== 0) {
    actorSystemData.speed.value = Math.max(0, Number(actorSystemData.speed.value || 0) + spdPenalty);
    actorSystemData.speed.swimSpeed = Math.max(0, Number(actorSystemData.speed.swimSpeed || 0) + spdPenalty);
  }


// Chapter 5 (Package 4): Movement restriction semantics derived from conditions.
// - Slowed: halve Speed (round up)
// - Entangled: halve Speed (round up)
// - Prone: movement costs double -> effective ground Speed is halved (round down)
// - Immobilized/Restrained/Paralyzed/Unconscious: cannot move (Speed 0)
actorContext._applyMovementRestrictionSemantics(actorData, actorSystemData);

  // AE: Final Speed lane (ADD/OVERRIDE) applied after movement restriction semantics.
  // Keys: system.modifiers.speed.value, .flySpeed, .swimSpeed
  {
    const spdAE = getSpeedAEModifiers(actorContext);
    const m = spdAE?.value ?? { add: 0, override: null };

    if (m.override != null) actorSystemData.speed.value = Number(m.override);
    else if (m.add) actorSystemData.speed.value = Number(actorSystemData.speed.value ?? 0) + Number(m.add);

    actorSystemData.speed.value = Math.max(0, Math.trunc(Number(actorSystemData.speed.value ?? 0)));

    // Keep swimSpeed consistent with final ground speed while preserving the existing swim bonus pipeline.
    const baseSwim = Math.floor(Number(actorSystemData.speed.value ?? 0) / 2);
    const swimBonus = (typeof agg !== "undefined")
      ? (Number(agg.doubleSwimSpeed ? (agg.swimBonus * 2) : agg.swimBonus) || 0)
      : 0;
    actorSystemData.speed.swimSpeed = Math.max(0, baseSwim + swimBonus);

    // AE: Swim Speed modifier (ADD/OVERRIDE) — applied after base swim calculation.
    const swimAE = spdAE?.swimSpeed ?? { add: 0, override: null };
    if (swimAE.override != null) actorSystemData.speed.swimSpeed = Math.max(0, Number(swimAE.override));
    else if (swimAE.add) actorSystemData.speed.swimSpeed = Math.max(0, actorSystemData.speed.swimSpeed + Number(swimAE.add));

    // AE: Fly Speed modifier (ADD/OVERRIDE) — Levitate and similar.
    // Base flySpeed comes from trait aggregation (agg.flyBonus); AE adds on top.
    const flyAE = spdAE?.flySpeed ?? { add: 0, override: null };
    if (flyAE.override != null) actorSystemData.speed.flySpeed = Math.max(0, Number(flyAE.override));
    else if (flyAE.add) actorSystemData.speed.flySpeed = Math.max(0, Number(actorSystemData.speed.flySpeed ?? 0) + Number(flyAE.add));
  }

  // AE: Action Points deterministic lanes (ADD/OVERRIDE).
  // Keys:
  //  - system.modifiers.action_points.max
  //  - system.modifiers.action_points.value
  {
    const apAE = getActionPointsAEModifiers(actorContext);
    const asNum = (v, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };

    let max = asNum(actorSystemData.action_points?.max ?? 0, 0);
    if (apAE.max?.override != null) max = asNum(apAE.max.override, max);
    else if (apAE.max?.add) max = max + asNum(apAE.max.add, 0);
    max = Math.max(0, Math.trunc(max));

    let value = asNum(actorSystemData.action_points?.value ?? 0, 0);
    if (apAE.value?.override != null) value = asNum(apAE.value.override, value);
    else if (apAE.value?.add) value = value + asNum(apAE.value.add, 0);

    actorSystemData.action_points.max = max;
    actorSystemData.action_points.value = Math.clamp(Math.trunc(value), 0, max);
  }

  // AE: Lucky / Unlucky active slot counts for critical matching.
  // Primary keys:
  //  - system.modifiers.lucky_numbers.max (alias: .value)
  //  - system.modifiers.unlucky_numbers.max (alias: .value)
  //
  // Interpretation: only the first N slots are considered active for crit matching.
  // This does NOT mutate stored lucky/unlucky numbers.
  {
    const slotAE = getLuckyUnluckySlotAEModifiers(actorContext);
    const asNum = (v, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };

    const lb = asNum(actorSystemData.characteristics?.lck?.bonus ?? 0, 0);
    const baseLucky = lb;
    const baseUnlucky = Math.max(0, 5 - lb);

    const luckySlots = (slotAE.lucky?.override != null)
      ? asNum(slotAE.lucky.override, baseLucky)
      : (baseLucky + asNum(slotAE.lucky?.add ?? 0, 0));

    const unluckySlots = (slotAE.unlucky?.override != null)
      ? asNum(slotAE.unlucky.override, baseUnlucky)
      : (baseUnlucky + asNum(slotAE.unlucky?.add ?? 0, 0));

    actorSystemData.lucky_numbers ??= {};
    actorSystemData.unlucky_numbers ??= {};

    actorSystemData.lucky_numbers._activeSlots = Math.clamp(Math.trunc(luckySlots), 0, 10);
    actorSystemData.unlucky_numbers._activeSlots = Math.clamp(Math.trunc(unluckySlots), 0, 6);
  }


  // Set Skill professions to regular professions (This is a fucking mess, but it's the way it's done for now...)
  for (let prof in actorSystemData.professions) {
    if (prof === 'profession1'||prof === 'profession2'||prof === 'profession3'||prof === 'commerce') {
      actorSystemData.professions[prof] === 0 ? actorSystemData.professions[prof] = actorSystemData.skills[prof].tn : actorSystemData.professions[prof] = 0
    }
  }

  if (useActorSkillModifierCalc) {
    actorContext._calculateItemSkillModifiers(actorData, agg);
  } else {
    // Apply aggregated item skill modifiers (one-pass)
    if (agg.skillModifiers && Object.keys(agg.skillModifiers).length > 0) {
      for (let [skillName, value] of Object.entries(agg.skillModifiers)) {
        // Guard: safe hasOwnProperty check for profession skill
        if (actorSystemData.professions && Object.prototype.hasOwnProperty.call(actorSystemData.professions, skillName)) {
          actorSystemData.professions[skillName] = Number(actorSystemData.professions[skillName] || 0) + Number(value);
          actorSystemData.professionsWound[skillName] = Number(actorSystemData.professionsWound[skillName] || 0) + Number(value);
        }
      }
    }
  }

  // Wound Penalties (effects-canonical; system.wounded is a derived mirror)
  const woundState = game?.uesrpg?.wounds?.getWoundState?.(actorContext) ?? (actorSystemData.wounded ? "active" : "none");
  actorSystemData.wounded = woundState !== "none";
  const woundSuppressed = actorContext._hasWoundPenaltySuppression(actorData) || woundState === "suppressed";
  const woundActiveForPenalty = woundState === "active" || woundState === "treated";
  if (woundActiveForPenalty && !woundSuppressed) {
    let woundPen = 0;
    agg.actorFlags.painIntolerant ? woundPen = -30 : woundPen = -20;

    if (actorContext._halfWoundPenalty(actorData) === true) {
      actorSystemData.woundPenalty = woundPen / 2;
    } else {
      actorSystemData.woundPenalty = woundPen;
    }

    // professionsWound mirrors professions; wound penalty is applied by TN calculation code
    if (actorSystemData.professionsWound && actorSystemData.professions) {
      for (const skill in actorSystemData.professionsWound) {
        actorSystemData.professionsWound[skill] = actorSystemData.professions[skill];
      }
    }
  }
  else if (woundActiveForPenalty && woundSuppressed) {
    // Passive wound penalties are suppressed by first aid / magical healing forestall,
    // without clearing the wounded state.
    actorSystemData.woundPenalty = 0;

    if (actorSystemData.professionsWound && actorSystemData.professions) {
      for (const skill in actorSystemData.professionsWound) {
        actorSystemData.professionsWound[skill] = actorSystemData.professions[skill];
      }
    }
  }

  else {
    // Ensure stale wound penalties do not persist once wounded state is cleared.
    actorSystemData.woundPenalty = 0;
    for (const skill in actorSystemData.professionsWound) {
      actorSystemData.professionsWound[skill] = actorSystemData.professions[skill];
    }
  }

  //Fatigue Penalties
  // Active Effects: Fatigue/Exhaustion modifiers (bonus/penalty).
  {
    const m = (fatigueAEs?.bonus) ? fatigueAEs.bonus : getFatigueAEModifiers(actorContext).bonus;
    if (m.override != null) actorSystemData.fatigue.bonus = Number(m.override);
    else if (m.add) actorSystemData.fatigue.bonus = Number(actorSystemData.fatigue.bonus ?? 0) + Number(m.add);
  }
  const negStamina = Math.max(0, -Number(actorSystemData.stamina.value ?? 0));
  actorSystemData.fatigue.level = negStamina + Number(actorSystemData.fatigue.bonus ?? 0);

  switch (actorSystemData.fatigue.level > 0) {
    case true:
      actorSystemData.fatigue.penalty = actorContext._calcFatiguePenalty(actorData)
      break

    case false:
      actorSystemData.fatigue.level = 0
      actorSystemData.fatigue.penalty = 0
      break
  }
  // Active Effects: Fatigue/Exhaustion penalty modifiers (applied after fatigue penalty is calculated).
  {
    const m = (fatigueAEs?.penalty) ? fatigueAEs.penalty : getFatigueAEModifiers(actorContext).penalty;
    if (m.override != null) actorSystemData.fatigue.penalty = Number(m.override);
    else if (m.add) actorSystemData.fatigue.penalty = Number(actorSystemData.fatigue.penalty ?? 0) + Number(m.add);
  }

  if (isActorUndead(actorContext)) {
    actorSystemData.fatigue.penalty = 0;
  }

  if (isNPC && applyThreatLuckyNumbers) {
    applyNpcThreatLuckyNumbers(actorSystemData);
  }


  // Active Effects: Wound Threshold modifiers (bonus/value) applied after all other rule adjustments.
  applyWoundThresholdAEs(actorContext, actorSystemData);

  // Chapter 4 X-traits: highest value wins when duplicated.
  const weakBones = Math.max(0, Number(getActorTraitValue(actorContext, "weakBones", { mode: "max" })) || 0);
  if (weakBones > 0) {
    actorSystemData.wound_threshold.value = Math.max(0, Number(actorSystemData.wound_threshold.value ?? 0) - weakBones);
  }

  // PERF end
  // actorContext._perfEnd('_prepareHumanoidData', t0);
}
