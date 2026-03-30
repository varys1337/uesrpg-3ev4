import { computeDefenderTNOverride } from "../combat/tn.js";
import { hasTalent } from "../traits/talents-api.js";
import { applySenseLossPenaltyAdjustments } from "../traits/awareness-talents.js";
import { getArmoredAgilityAcrobaticsBonus } from "../traits/mobility-talents.js";
import { hasCondition } from "../conditions/condition-engine.js";
import { normalizeKey } from "./key-utils.js";
import {
  resolveEffectiveSkillCharacteristicKey,
  isAgilityCharacteristicKey,
  isPhysicalCharacteristicKey,
  isStrOrEndCharacteristicKey
} from "./skill-tn-characteristics.js";

const ENCUMBRANCE_PHYSICAL_KEYS = new Set(["str", "strength", "end", "endurance", "agi", "agility"]);

export function isAgilityBasedSkill(skillItem, { selectedCharacteristicKey = null } = {}) {
  return isAgilityCharacteristicKey(resolveEffectiveSkillCharacteristicKey(skillItem, selectedCharacteristicKey));
}

export function isPhysicalSkill(skill, { selectedCharacteristicKey = null } = {}) {
  return isPhysicalCharacteristicKey(resolveEffectiveSkillCharacteristicKey(skill, selectedCharacteristicKey));
}

export function isStrOrEndSkill(skill, { selectedCharacteristicKey = null } = {}) {
  return isStrOrEndCharacteristicKey(resolveEffectiveSkillCharacteristicKey(skill, selectedCharacteristicKey));
}

export function isCombatStyle(skillItem) {
  return (skillItem?.type === "combatStyle") || /combat style/i.test(String(skillItem?.name || ""));
}

export function encumbrancePhysicalKey(key) {
  return ENCUMBRANCE_PHYSICAL_KEYS.has(String(key ?? "").trim().toLowerCase());
}

function hasSenseLossMods(situationalMods) {
  if (!Array.isArray(situationalMods)) return false;
  return situationalMods.some((mod) => {
    const key = String(mod?.key ?? mod?.conditionKey ?? "").trim().toLowerCase();
    return key === "blinded" || key === "deafened";
  });
}

export function maybeAddObservantEvadeMod(actor, skillItem, situationalMods) {
  if (!actor || !skillItem || !Array.isArray(situationalMods)) return;
  if (normalizeKey(skillItem?.name) !== "evade") return;
  if (!hasTalent(actor, "observant")) return;

  const baseTN = Number(skillItem?.system?.value ?? 0) || 0;
  const override = computeDefenderTNOverride(actor, {
    skillName: "Evade",
    fallbackCharacteristic: "prc"
  });
  const altTN = Number(override?.tn ?? NaN);
  if (!Number.isFinite(altTN)) return;

  const delta = altTN - baseTN;
  if (delta > 0) {
    situationalMods.push({
      key: "talent:observant",
      label: "Observant (Evade as Perception)",
      value: delta,
      source: "talent"
    });
  }
}

export function maybeAddSenseLossAwarenessMods(actor, skillItem, situationalMods) {
  if (!actor || !skillItem || !Array.isArray(situationalMods)) return;

  const hasAll = hasTalent(actor, "onewithall");
  const hasHoned = !hasAll && hasTalent(actor, "honedsenses");
  if (!hasAll && !hasHoned) return;

  if (hasSenseLossMods(situationalMods)) {
    applySenseLossPenaltyAdjustments(situationalMods, actor);
    return;
  }

  const skillKey = normalizeKey(skillItem?.name);
  if (skillKey !== "observe") return;

  const hasBlind = hasCondition(actor, "blinded");
  const hasDeaf = hasCondition(actor, "deafened");
  if (!hasBlind && !hasDeaf) return;

  if (hasBlind) {
    situationalMods.push({
      key: "blinded",
      conditionKey: "blinded",
      label: "Blinded (sight)",
      value: -30,
      source: "sense-loss",
      applyMode: "offset"
    });
  }

  if (hasDeaf) {
    situationalMods.push({
      key: "deafened",
      conditionKey: "deafened",
      label: "Deafened (hearing)",
      value: -30,
      source: "sense-loss",
      applyMode: "offset"
    });
  }

  applySenseLossPenaltyAdjustments(situationalMods, actor);
}

export { getArmoredAgilityAcrobaticsBonus };
