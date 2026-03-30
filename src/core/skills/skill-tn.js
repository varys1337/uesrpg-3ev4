/**
 * src/core/skills/skill-tn.js
 *
 * Skill TN computation for UESRPG 3ev4 (Foundry v13.351).
 *
 * Design:
 *  - Deterministic TN computation with an explicit breakdown (for debug / UI).
 *  - Does not mutate documents.
 */

import { collectCombatTNModifierEntries } from "../combat/tn.js";
import { evaluateAEModifierKeys } from "../active-effects/modifier-evaluator.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { normalizeKey } from "./key-utils.js";
import {
  getParsedGoverningData,
  isKnownCharacteristicKey,
  canonicalCharacteristicToken
} from "./skill-tn-characteristics.js";
import {
  maybeAddObservantEvadeMod,
  maybeAddSenseLossAwarenessMods,
  isAgilityBasedSkill,
  isPhysicalSkill,
  isStrOrEndSkill,
  isCombatStyle,
  encumbrancePhysicalKey,
  getArmoredAgilityAcrobaticsBonus
} from "./skill-tn-situational.js";

export const SKILL_DIFFICULTIES = Object.freeze([
  { key: "effortless", label: "Effortless", mod: 40 },
  { key: "simple", label: "Simple", mod: 30 },
  { key: "easy", label: "Easy", mod: 20 },
  { key: "ordinary", label: "Ordinary", mod: 10 },
  { key: "average", label: "Average", mod: 0 },
  { key: "challenging", label: "Challenging", mod: -10 },
  { key: "difficult", label: "Difficult", mod: -20 },
  { key: "hard", label: "Hard", mod: -30 },
  { key: "veryHard", label: "Very Hard", mod: -40 }
]);

export function getDifficultyByKey(key) {
  return SKILL_DIFFICULTIES.find((difficulty) => difficulty.key === key)
    ?? SKILL_DIFFICULTIES.find((difficulty) => difficulty.key === "average");
}

function asNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function computeSkillTN({
  actor,
  skillItem,
  itemBonuses = null,
  difficultyKey = "average",
  manualMod = 0,
  selectedCharacteristicKey = null,
  useSpecialization = false,
  situationalMods = []
} = {}) {
  const normalizedSkill = normalizeKey(skillItem?.name);
  const normalizedProfession = normalizeKey(skillItem?._professionKey);
  const normalizedCharacteristic = normalizeKey(skillItem?._characteristicKey);
  const aeSkillKeys = new Set([
    "system.modifiers.tests.all",
    "system.modifiers.skills._all",
    "system.modifiers.skills.frenziedPenalty",
    "system.modifiers.skills.physicalExertion"
  ]);
  if (normalizedSkill) aeSkillKeys.add(`system.modifiers.skills.${normalizedSkill}`);
  if (normalizedProfession) aeSkillKeys.add(`system.modifiers.skills.${normalizedProfession}`);
  if (normalizedCharacteristic) aeSkillKeys.add(`system.modifiers.characteristics.${normalizedCharacteristic}`);
  const aeSkillResolved = actor ? evaluateAEModifierKeys(actor, Array.from(aeSkillKeys)) : {};

  const fallbackSituational = [];
  if (
    actor &&
    !isCombatStyle({ type: skillItem?.type, name: skillItem?.name }) &&
    isStrOrEndSkill({ system: skillItem?.system ?? {} }, { selectedCharacteristicKey }) &&
    !asNumber(aeSkillResolved["system.modifiers.skills.physicalExertion"] ?? 0)
  ) {
    const hasLegacy = actor.effects?.some((effect) =>
      !effect.disabled && getFlagValueWithFallback(effect, "key") === "stamina-physical-exertion"
    );
    if (hasLegacy) {
      fallbackSituational.push({
        key: "physicalExertion",
        label: "Physical Exertion",
        value: 20,
        source: "staminaLegacy"
      });
    }
  }

  const situational = Array.isArray(situationalMods) ? [...situationalMods] : [];
  maybeAddObservantEvadeMod(actor, skillItem, situational);
  maybeAddSenseLossAwarenessMods(actor, skillItem, situational);

  return computeSkillTNFromData({
    actor,
    actorSystem: actor?.system ?? {},
    actorType: actor?.type,
    actorHasPlayerOwner: actor?.hasPlayerOwner,
    skill: {
      name: skillItem?.name,
      type: skillItem?.type,
      system: skillItem?.system ?? {},
      _professionKey: skillItem?._professionKey
    },
    itemBonuses,
    aeSkillResolved,
    combatTNBonuses: (() => {
      const combat = isCombatStyle({ type: skillItem?.type, name: skillItem?.name });
      return combat ? collectCombatTNModifierEntries(actor, "attacker") : null;
    })(),
    difficultyKey,
    manualMod,
    selectedCharacteristicKey,
    useSpecialization,
    situationalMods: [...situational, ...fallbackSituational]
  });
}

function computeSkillTNFromData({
  actor = null,
  actorSystem = {},
  actorType = null,
  actorHasPlayerOwner = true,
  skill = { name: null, type: null, system: {} },
  itemBonuses = null,
  aeSkillResolved = null,
  combatTNBonuses = null,
  difficultyKey = "average",
  manualMod = 0,
  selectedCharacteristicKey = null,
  useSpecialization = false,
  situationalMods = []
} = {}) {
  void actorType;
  void actorHasPlayerOwner;

  const breakdown = [];
  const isCharacteristic = skill?.type === "characteristic";
  const baseSkillRaw = asNumber(skill?.system?.value);
  const needsRuntimeFatigueWound = (skill?.type === "profession" || skill?.type === "characteristic");
  let baseSkill = baseSkillRaw;

  const selectedCharKey = canonicalCharacteristicToken(String(selectedCharacteristicKey ?? "").trim().toLowerCase());
  const { baseNorm: currentBaseCharKey } = getParsedGoverningData(skill);
  if (
    selectedCharKey &&
    isKnownCharacteristicKey(selectedCharKey) &&
    currentBaseCharKey &&
    selectedCharKey !== currentBaseCharKey &&
    ["skill", "magicSkill", "combatStyle"].includes(String(skill?.type ?? "")) &&
    isKnownCharacteristicKey(currentBaseCharKey)
  ) {
    const oldTotal = asNumber(actorSystem?.characteristics?.[currentBaseCharKey]?.total ?? 0);
    const newTotal = asNumber(actorSystem?.characteristics?.[selectedCharKey]?.total ?? 0);
    const delta = newTotal - oldTotal;
    if (delta !== 0) {
      baseSkill = baseSkillRaw + delta;
      breakdown.push({
        label: `Characteristic (${selectedCharKey.toUpperCase()})`,
        value: delta,
        source: "characteristicSelection"
      });
    }
  }

  breakdown.push({
    label: isCharacteristic ? (skill?.name ?? "Characteristic") : "Rank",
    value: baseSkill,
    source: isCharacteristic ? "characteristic" : "rank"
  });

  const normalizedName = normalizeKey(skill?.name);
  const resolved = aeSkillResolved ?? {};

  const allTestBonus = asNumber(resolved["system.modifiers.tests.all"] ?? 0);
  if (allTestBonus) breakdown.push({ label: "Effects: All Tests", value: allTestBonus, source: "aeTestsAll" });

  const allSkillBonus = asNumber(resolved["system.modifiers.skills._all"] ?? 0);
  if (allSkillBonus) breakdown.push({ label: "Effects: All Skills", value: allSkillBonus, source: "aeSkillAll" });

  const normalizedProfession = normalizeKey(skill?._professionKey);
  const specificBonus = normalizedName ? asNumber(resolved[`system.modifiers.skills.${normalizedName}`] ?? 0) : 0;
  if (specificBonus) {
    const labelName = String(skill?.name ?? "").trim();
    breakdown.push({
      label: labelName ? `Effects: ${labelName}` : "Effects: Skill",
      value: specificBonus,
      source: "aeSkillSpecific"
    });
  }

  const professionBonus = (normalizedProfession && normalizedProfession !== normalizedName)
    ? asNumber(resolved[`system.modifiers.skills.${normalizedProfession}`] ?? 0)
    : 0;
  if (professionBonus) {
    const labelName = String(skill?._professionKey ?? "").trim();
    breakdown.push({
      label: labelName ? `Effects: ${labelName}` : "Effects: Profession",
      value: professionBonus,
      source: "aeSkillProfession"
    });
  }

  const normalizedCharacteristic = normalizeKey(skill?._characteristicKey);
  if (normalizedCharacteristic) {
    const characteristicBonus = asNumber(resolved[`system.modifiers.characteristics.${normalizedCharacteristic}`] ?? 0);
    if (characteristicBonus) {
      const characteristicLabel = String(skill?.name ?? normalizedCharacteristic).trim();
      breakdown.push({
        label: `Effects: ${characteristicLabel}`,
        value: characteristicBonus,
        source: "aeCharacteristic"
      });
    }
  }

  const frenziedPenalty = asNumber(resolved["system.modifiers.skills.frenziedPenalty"] ?? 0);
  if (frenziedPenalty && !isPhysicalSkill(skill, { selectedCharacteristicKey: selectedCharKey })) {
    breakdown.push({ label: "Effects: Frenzied", value: frenziedPenalty, source: "aeFrenziedPenalty" });
  }

  const physicalExertion = asNumber(resolved["system.modifiers.skills.physicalExertion"] ?? 0);
  if (physicalExertion && isStrOrEndSkill(skill, { selectedCharacteristicKey: selectedCharKey }) && !isCombatStyle({ type: skill?.type, name: skill?.name })) {
    breakdown.push({ label: "Physical Exertion", value: physicalExertion, source: "staminaPhysicalExertion" });
  }

  if (isCombatStyle({ type: skill?.type, name: skill?.name })) {
    const entries = Array.isArray(combatTNBonuses) ? combatTNBonuses : null;
    if (entries && entries.length) {
      for (const entry of entries) {
        const value = asNumber(entry?.value);
        if (!value) continue;
        breakdown.push({
          label: String(entry?.label ?? "Effects"),
          value,
          source: "combatTN"
        });
      }
    } else {
      const value = asNumber(actorSystem?.modifiers?.combat?.attackTN);
      if (value) breakdown.push({ label: "Effects", value, source: "combatTN" });
    }
  }

  const derivedItemBonuses = Array.isArray(itemBonuses) ? itemBonuses : [];
  for (const bonus of derivedItemBonuses) {
    const value = asNumber(bonus?.value);
    if (!value) continue;
    const itemName = String(bonus?.itemName ?? "").trim();
    breakdown.push({
      label: itemName ? `Item Bonus: ${itemName}` : "Item Bonus",
      value,
      source: "itemBonus"
    });
  }

  const fatigue = needsRuntimeFatigueWound ? asNumber(actorSystem?.fatigue?.penalty) : 0;
  if (fatigue) breakdown.push({ label: "Fatigue", value: fatigue, source: "fatigue" });

  const encumbrance = asNumber(actorSystem?.carry_rating?.penalty);
  if (encumbrance) {
    let applyEncumbrance = false;
    if (skill?.type === "profession") {
      applyEncumbrance = true;
    } else if (isCharacteristic) {
      applyEncumbrance = encumbrancePhysicalKey(skill?._characteristicKey ?? "");
    } else {
      const effectiveCharacteristic = isKnownCharacteristicKey(selectedCharKey) ? selectedCharKey : currentBaseCharKey;
      if (encumbrancePhysicalKey(effectiveCharacteristic)) {
        applyEncumbrance = true;
      } else {
        const tags = Array.isArray(skill?.system?.tags) ? skill.system.tags : [];
        applyEncumbrance = tags.some((tag) => tag === "physical" || tag === "movement");
      }
    }
    if (applyEncumbrance) {
      breakdown.push({ label: "Encumbrance", value: encumbrance, source: "encumbrance" });
    }
  }

  const mobility = actorSystem?.mobility ?? {};
  const allTestPenalty = asNumber(mobility?.allTestPenalty);
  if (allTestPenalty) breakdown.push({ label: "Armor: Crippling", value: allTestPenalty, source: "armorAll" });

  const nameKey = String(skill?.name ?? "").trim().toLowerCase();
  const skillSpecificPenalty = asNumber(mobility?.skillTestPenalties?.[nameKey]);
  if (skillSpecificPenalty) breakdown.push({ label: "Armor: Penalty", value: skillSpecificPenalty, source: "armorSkill" });

  const mobilityAgilityPenalty = (isAgilityBasedSkill({ system: skill.system }, { selectedCharacteristicKey: selectedCharKey }) && !isCombatStyle({ type: skill.type, name: skill.name }))
    ? asNumber(mobility?.agilityTestPenalty)
    : 0;
  if (mobilityAgilityPenalty) breakdown.push({ label: "Armor: Penalty", value: mobilityAgilityPenalty, source: "armorAgility" });

  if (nameKey === "acrobatics") {
    const armoredAgilityBonus = getArmoredAgilityAcrobaticsBonus(actor, mobility);
    if (armoredAgilityBonus > 0) {
      breakdown.push({ label: "Talent: Armored Agility", value: armoredAgilityBonus, source: "talentArmoredAgility" });
    }
  }

  const woundedPenalty = needsRuntimeFatigueWound ? asNumber(actorSystem?.woundPenalty) : 0;
  if (woundedPenalty) breakdown.push({ label: "Wounded", value: woundedPenalty, source: "wounded" });

  const environmentalPenalty = asNumber(actorSystem?.environment?.skillPenalties?.[nameKey]);
  if (environmentalPenalty) breakdown.push({ label: "Environment", value: environmentalPenalty, source: "environment" });

  const difficulty = getDifficultyByKey(difficultyKey);
  if (difficulty?.mod) breakdown.push({ label: `Difficulty: ${difficulty.label}`, value: difficulty.mod, source: "difficulty" });

  const isEvade = nameKey === "evade";
  const specializationBonus = (useSpecialization && !isEvade) ? 10 : 0;
  if (specializationBonus) breakdown.push({ label: "Specialization", value: specializationBonus, source: "specialization" });

  if (Array.isArray(situationalMods)) {
    for (const modifier of situationalMods) {
      const value = asNumber(modifier?.value);
      if (!value) continue;
      const label = String(modifier?.label ?? modifier?.name ?? "Situational").trim() || "Situational";
      breakdown.push({ label, value, source: String(modifier?.source ?? "situational") });
    }
  }

  const manual = asNumber(manualMod);
  if (manual) breakdown.push({ label: "Manual Modifier", value: manual, source: "manual" });

  const finalTN = breakdown.reduce((sum, entry) => sum + asNumber(entry.value), 0);

  return {
    baseTN: baseSkill,
    finalTN,
    breakdown,
    difficulty,
    useSpecialization: Boolean(useSpecialization)
  };
}
