/**
 * src/core/combat/opposed/actions/eligibility.js
 * Centralized rules gating for attack/defend eligibility
 * (Hidden, Restrained, Aim, Advantage lifecycle)
 */

import { hasCondition } from "../../../conditions/condition-engine.js";
import { _findEnabledEffectByUesrpgKey } from "../helpers/util.js";
import {
  consumeOneShotAdvantageEffects as _consumeOneShotAdvantageEffects,
  consumeOrBreakAimAfterAttack as _consumeOrBreakAimAfterAttack,
  consumeHiddenAfterAttack as _consumeHiddenAfterAttack
} from "../effects.js";

/**
 * Check if attacker can make an attack roll (gating rules).
 * @param {Actor} attacker 
 * @param {Object} context - Combat context
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canAttackerRoll(attacker, context = {}) {
  // Chapter 5 (Restrained): cannot attack
  if (hasCondition(attacker, "restrained")) {
    return { allowed: false, reason: "Restrained" };
  }

  // Chapter 5 (Defensive Stance): Attack limit reduced to 0 until next Turn
  if (_findEnabledEffectByUesrpgKey(attacker, "defensiveStance")) {
    return { allowed: false, reason: "Defensive Stance active" };
  }

  return { allowed: true };
}

/**
 * Check if defender can make a defense roll (gating rules).
 * @param {Actor} defender
 * @param {Object} context - Combat context
 * @returns {{ allowed: boolean, reason?: string, isHidden?: boolean }}
 */
export function canDefenderRoll(defender, context = {}) {
  // Chapter 5 (Hidden): enemies cannot defend against attacks made by hidden characters
  if (context?.attackFromHidden === true) {
    return { allowed: false, reason: "Hidden", isHidden: true };
  }

  // Chapter 5 (Restrained): can still defend (no explicit prohibition in RAW)
  // but may have penalties applied via active effects

  return { allowed: true };
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
