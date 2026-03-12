/**
 * src/core/combat/unusual-combat.js
 *
 * Chapter 5 unusual combat scenario helpers.
 */

import { hasTalent } from "../traits/talents-api.js";
import { swashbucklerIgnoresCombatSkillRankLimits } from "../traits/mobility-talents.js";
import { computeSkillTN } from "../skills/skill-tn.js";
import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { applyCondition, hasCondition } from "../conditions/condition-engine.js";

const UNUSUAL_MOVEMENT_RULES = Object.freeze({
  climb: { key: "climb", label: "Climbing", limitingSkill: "Athletics", followUp: null },
  crawl: { key: "crawl", label: "Slippery Surface", limitingSkill: "Acrobatics", followUp: "acrobatics-prone" },
  swim: { key: "swim", label: "Swimming", limitingSkill: "Athletics", followUp: null },
  jump: { key: "jump", label: "Jumping", limitingSkill: "Acrobatics", followUp: "acrobatics-prone-fall" },
});

const NPC_PROFESSION_FALLBACKS = Object.freeze({
  athletics: ["athletics", "physical"],
  acrobatics: ["acrobatics", "physical"],
  ride: ["ride", "physical"],
});

function _normalize(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

function _num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function _findSkillItem(actor, skillName) {
  const key = _normalize(skillName);
  for (const item of (actor?.items ?? [])) {
    if (!item || item.type !== "skill") continue;
    if (_normalize(item.name) === key) return item;
  }
  return null;
}

function _resolveNpcProfessionValue(actor, skillName) {
  const keys = NPC_PROFESSION_FALLBACKS[_normalize(skillName)] ?? [];
  const professions = actor?.system?.professions ?? {};
  for (const key of keys) {
    const value = _num(professions?.[key]);
    if (value > 0) return value;
  }
  return 0;
}

export function normalizeUnusualCombatMovementAction(raw) {
  const key = _normalize(raw);
  return UNUSUAL_MOVEMENT_RULES[key] ? key : null;
}

export function getUnusualCombatRule(movementAction) {
  const key = normalizeUnusualCombatMovementAction(movementAction);
  return key ? UNUSUAL_MOVEMENT_RULES[key] : null;
}

export function resolveUnusualCombatSkillLimit(actor, skillName) {
  if (!actor || !skillName) return { skillItem: null, tn: 0, source: null };

  const skillItem = _findSkillItem(actor, skillName);
  if (skillItem) {
    const tn = _num(computeSkillTN({
      actor,
      skillItem,
      difficultyKey: "average",
      manualMod: 0,
      useSpecialization: false,
      situationalMods: [],
    })?.finalTN);
    return { skillItem, tn, source: "skill" };
  }

  const npcTn = _resolveNpcProfessionValue(actor, skillName);
  if (npcTn > 0) return { skillItem: null, tn: npcTn, source: "npcProfession" };

  return { skillItem: null, tn: 0, source: null };
}

export function isMountedCombatant(actor) {
  return Boolean(actor) && hasCondition(actor, "mounted");
}

export function resolveMountedRideSkillLimit(actor) {
  return resolveUnusualCombatSkillLimit(actor, "Ride");
}

export function getMountedCombatCapAdjustment({
  actor,
  role,
  baseTN = 0,
  attackMode = null,
} = {}) {
  if (!actor || _normalize(role) !== "attacker") return null;
  if (!isMountedCombatant(actor)) return null;
  if (_normalize(attackMode) !== "ranged") return null;

  const limit = resolveMountedRideSkillLimit(actor);
  const limitTN = _num(limit?.tn);
  const currentBase = _num(baseTN);
  if (!(limitTN > 0) || limitTN >= currentBase) return null;

  return {
    limitTN,
    delta: limitTN - currentBase,
    breakdown: {
      key: "mounted-combat:ride",
      label: "Mounted (Ride limit)",
      value: limitTN - currentBase,
      source: "mounted-combat",
    },
  };
}

export function getMountedEvadeRestriction({
  defender = null,
  attacker = null,
  attackMode = null,
} = {}) {
  if (!defender || !isMountedCombatant(defender)) return null;
  if (_normalize(attackMode) !== "melee") return null;
  if (isMountedCombatant(attacker)) return null;

  return {
    restriction: "mounted-melee-evade",
    reason: "Mounted defenders cannot Evade melee attacks from unmounted attackers."
  };
}

function _isWardBlock(defenseType, context = {}) {
  const dt = _normalize(defenseType);
  if (dt === "ward") return true;
  if (dt !== "block") return false;
  return _normalize(context?.blockSource) === "ward";
}

export function getUnusualCombatCapAdjustment({
  actor,
  role,
  defenseType = null,
  baseTN = 0,
  movementAction = null,
  context = {},
} = {}) {
  const rule = getUnusualCombatRule(movementAction);
  if (!rule || !actor) return null;

  const normalizedRole = _normalize(role);
  const normalizedDefense = _normalize(defenseType);
  if (normalizedRole === "defender") {
    if (!["parry", "block", "counter"].includes(normalizedDefense)) return null;
    if (_isWardBlock(normalizedDefense, context)) return null;
  } else if (normalizedRole !== "attacker") {
    return null;
  }

  if (swashbucklerIgnoresCombatSkillRankLimits(actor, rule.limitingSkill, {
    ignoreUnderwaterException: false,
    context: { movementAction: rule.key },
  })) {
    return null;
  }

  const limit = resolveUnusualCombatSkillLimit(actor, rule.limitingSkill);
  const limitTN = _num(limit?.tn);
  const currentBase = _num(baseTN);
  if (!(limitTN > 0) || limitTN >= currentBase) return null;

  return {
    rule,
    limitTN,
    delta: limitTN - currentBase,
    breakdown: {
      key: `unusual-combat:${rule.key}`,
      label: `${rule.label} (${rule.limitingSkill} limit)`,
      value: limitTN - currentBase,
      source: "unusual-combat",
    },
  };
}

function _isSwimmingDamageExempt(actor) {
  if (!actor) return false;
  return hasTalent(actor, "histskin");
}

export function getUnusualCombatDamageAdjustment({ attacker, movementAction = null } = {}) {
  const rule = getUnusualCombatRule(movementAction);
  if (!rule || rule.key !== "swim" || !attacker) return null;
  if (_isSwimmingDamageExempt(attacker)) return null;

  return {
    label: `${rule.label} (half damage)`,
    apply(amount) {
      const value = Math.max(0, _num(amount));
      return value > 0 ? Math.ceil(value / 2) : 0;
    },
  };
}

export async function maybeHandleUnusualCombatAttackFailure({
  attacker,
  attackerToken = null,
  movementAction = null,
} = {}) {
  const rule = getUnusualCombatRule(movementAction);
  if (!rule || !attacker || !rule.followUp) return { handled: false };

  const acrobatics = _findSkillItem(attacker, "Acrobatics");
  if (!acrobatics) {
    const manual = rule.followUp === "acrobatics-prone-fall"
      ? `${attacker.name} must test Acrobatics or fall prone and suffer appropriate fall damage.`
      : `${attacker.name} must test Acrobatics or fall prone.`;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker, token: attackerToken?.document ?? null }),
      content: `<div class="uesrpg-special-action-outcome"><b>${rule.label} Follow-Up:</b><p>${manual}</p></div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
    return { handled: true, mode: rule.key, outcome: "manual-no-skill" };
  }

  const tn = computeSkillTN({
    actor: attacker,
    skillItem: acrobatics,
    difficultyKey: "average",
    manualMod: 0,
    useSpecialization: false,
    situationalMods: [],
  });

  const result = await doTestRoll(attacker, {
    rollFormula: "1d100",
    target: _num(tn?.finalTN),
    allowLucky: true,
    allowUnlucky: true,
  });

  await result.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: attacker, token: attackerToken?.document ?? null }),
    flavor: `Acrobatics - ${rule.label} Follow-Up`,
    rollMode: game.settings.get("core", "rollMode"),
  });

  let summary = `${attacker.name} keeps their footing.`;
  let outcome = "success";
  if (!result.isSuccess) {
    await applyCondition(attacker, "prone", { source: `unusual-combat-${rule.key}` });
    outcome = "prone";
    summary = (rule.followUp === "acrobatics-prone-fall")
      ? `${attacker.name} fails the Acrobatics follow-up, falls prone, and should suffer appropriate fall damage.`
      : `${attacker.name} fails the Acrobatics follow-up and falls prone.`;
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker, token: attackerToken?.document ?? null }),
    content: `<div class="uesrpg-special-action-outcome"><b>${rule.label} Follow-Up:</b><p>${summary}</p></div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });

  return { handled: true, mode: rule.key, outcome };
}
