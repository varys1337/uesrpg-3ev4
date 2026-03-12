/**
 * src/core/combat/opposed/actions/eligibility.js
 * Centralized rules gating for attack/defend eligibility
 * (Hidden, Restrained, Aim, Advantage lifecycle)
 */

import { hasCondition } from "../../../conditions/condition-engine.js";
import { _findEnabledEffectByUesrpgKey } from "../helpers/util.js";
import { resolveSurpriseState } from "../../surprise-state.js";
import { getFearActionRestrictions } from "../../../fear/index.js";
import {
  consumeOneShotAdvantageEffects as _consumeOneShotAdvantageEffects,
  consumeOrBreakAimAfterAttack as _consumeOrBreakAimAfterAttack,
  consumeHiddenAfterAttack as _consumeHiddenAfterAttack
} from "../effects.js";

/**
 * Canonical action-eligibility gate.
 *
 * @param {Actor} actor
 * @param {object} context
 * @param {string} [context.actionFamily] - "attack" | "defense" | "movement" | "utility"
 * @param {string} [context.actionType] - "primary" | "secondary" | "reaction" | "free"
 * @param {boolean} [context.attackFromHidden]
 * @returns {{allowed:boolean,reasons:string[],restrictions:string[]}}
 */
export function getActionEligibility(actor, context = {}) {
  const reasons = [];
  const restrictions = [];

  if (!actor) {
    return { allowed: false, reasons: ["Actor missing"], restrictions };
  }

  const actionFamily = String(context?.actionFamily ?? "").toLowerCase();
  const actionType = String(context?.actionType ?? "").toLowerCase() || "primary";
  const isReaction = actionType === "reaction";

  const surprise = resolveSurpriseState(actor, { combatContext: context?.combat ?? game.combat });
  if (surprise.onlyReactions && !isReaction && actionType !== "free") {
    reasons.push("Surprised");
    restrictions.push("only-reactions");
  }

  if (actionFamily === "attack" && _findEnabledEffectByUesrpgKey(actor, "defensiveStance")) {
    reasons.push("Defensive Stance active");
    restrictions.push("no-attacks");
  }

  if (actionFamily === "defense" && context?.attackFromHidden === true) {
    reasons.push("Hidden");
    restrictions.push("cannot-defend-hidden-attack");
  }

  if (actionFamily === "defense" && hasCondition(actor, "helpless")) {
    reasons.push("Helpless");
    restrictions.push("helpless");
  }

  if ((actionFamily === "attack" || actionFamily === "defense") && hasCondition(actor, "restrained")) {
    reasons.push("Restrained");
    restrictions.push("restrained");
  }

  const fear = getFearActionRestrictions(actor);
  if (!isReaction && fear?.blockActions === true) {
    reasons.push("Fear");
    restrictions.push("fear-block-actions");
  }
  if (isReaction && fear?.blockReactions === true) {
    reasons.push("Fear");
    restrictions.push("fear-block-reactions");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    restrictions
  };
}

/**
 * Check if attacker can make an attack roll (gating rules).
 * @param {Actor} attacker 
 * @param {Object} context - Combat context
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canAttackerRoll(attacker, context = {}) {
  const actionType = context?.isReactionAttack ? "reaction" : "primary";
  const gate = getActionEligibility(attacker, {
    ...context,
    actionFamily: "attack",
    actionType
  });
  return {
    allowed: gate.allowed,
    reason: gate.reasons[0],
    reasons: gate.reasons,
    restrictions: gate.restrictions
  };
}

/**
 * Check if defender can make a defense roll (gating rules).
 * @param {Actor} defender
 * @param {Object} context - Combat context
 * @returns {{ allowed: boolean, reason?: string, isHidden?: boolean }}
 */
export function canDefenderRoll(defender, context = {}) {
  const gate = getActionEligibility(defender, {
    ...context,
    actionFamily: "defense",
    actionType: "reaction"
  });
  return {
    allowed: gate.allowed,
    reason: gate.reasons[0],
    reasons: gate.reasons,
    restrictions: gate.restrictions,
    isHidden: gate.restrictions.includes("cannot-defend-hidden-attack")
  };
}

/**
 * Mark that this attack was made from hidden state (for defender gating).
 * Mutates context object.
 */
export function markAttackFromHidden(context, attacker) {
  if (hasCondition(attacker, "hidden")) {
    context.attackFromHidden = true;
  }
}

/**
 * Apply post-attack state changes (Aim consumption, Advantage cleanup, Hidden removal).
 * @param {Actor} attacker
 * @param {Object} context - Combat context
 * @param {Object} data - Opposed card data
 */
export async function applyPostAttackState(attacker, context, data) {
  // Consume one-shot Advantage-derived effects after they have been applied to this attack test.
  // RAW: Press Advantage / Overextend apply to the next attack test within 1 round.
  await _consumeOneShotAdvantageEffects(attacker, {
    action: "attack",
    testRoll: data.attacker.testRoll
  });

  // RAW: Aim bonus applies to the next ranged attack with the aimed weapon/spell.
  // Taking any other action breaks the chain; firing the aimed item consumes it.
  await _consumeOrBreakAimAfterAttack(attacker, {
    weaponUuid: context?.weaponUuid,
    attackMode: context?.attackMode
  });

  // Chapter 5 (Hidden): attacking reveals the hidden character
  if (context?.attackFromHidden === true) {
    await _consumeHiddenAfterAttack(attacker);
  }
}

/**
 * Mark defender as ineligible to defend due to hidden attack.
 * Mutates defenderData object.
 */
export function markDefenderIneligibleForHidden(defenderData) {
  if (!defenderData) return;

  defenderData.canDefend = false;
  defenderData.banked = defenderData.banked || {};
  defenderData.banked.committed = true;
  defenderData.banked.auto = true;
  defenderData.banked.reason = "hidden";
  defenderData.defenseType = "none";
  defenderData.label = "No Defense (Hidden)";
  defenderData.result = {
    total: 0,
    degrees: 0,
    breakdown: [{ key: "base", label: "No Defense (Hidden)", value: 0, source: "base" }]
  };
}

export function markDefenderNoDefense(defenderData, reason = "Unavailable") {
  if (!defenderData) return;

  const safeReason = String(reason ?? "Unavailable").trim() || "Unavailable";
  const plainNoDefense = safeReason.toLowerCase() === "no defense";
  const label = plainNoDefense ? "No Defense" : `No Defense (${safeReason})`;
  defenderData.noDefense = true;
  defenderData.defenseType = "none";
  defenderData.label = label;
  defenderData.testLabel = "No Defense";
  defenderData.defenseLabel = "No Defense";
  defenderData.target = 0;
  defenderData.tn = {
    finalTN: 0,
    baseTN: 0,
    totalMod: 0,
    breakdown: [{ key: "base", label, value: 0, source: "base" }]
  };
  defenderData.result = { rollTotal: 100, target: 0, isSuccess: false, degree: 1 };
}
