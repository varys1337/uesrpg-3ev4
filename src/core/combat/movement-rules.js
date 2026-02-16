/**
 * src/core/combat/movement-rules.js
 *
 * Chapter 5 movement legality helpers.
 */

import { hasCondition } from "../conditions/condition-engine.js";

/**
 * Resolve whether a movement action is legal right now.
 *
 * @param {Actor} actor
 * @param {object} opts
 * @param {string} [opts.actionId]
 * @returns {{allowed:boolean,reasons:string[],restrictions:string[]}}
 */
export function getMovementActionLegality(actor, { actionId = "move" } = {}) {
  const reasons = [];
  const restrictions = [];
  const action = String(actionId ?? "move").toLowerCase();

  if (!actor) return { allowed: false, reasons: ["Actor missing"], restrictions };

  if (hasCondition(actor, "unconscious")) {
    reasons.push("Unconscious");
    restrictions.push("cannot-move");
  }

  if (hasCondition(actor, "paralyzed")) {
    reasons.push("Paralyzed");
    restrictions.push("cannot-move");
  }

  if (hasCondition(actor, "immobilized")) {
    reasons.push("Immobilized");
    restrictions.push("cannot-move");
  }

  if (hasCondition(actor, "restrained")) {
    reasons.push("Restrained");
    restrictions.push("cannot-move");
  }

  if (action === "dash" && hasCondition(actor, "hidden")) {
    reasons.push("Hidden");
    restrictions.push("hidden-cannot-dash");
  }

  return { allowed: reasons.length === 0, reasons, restrictions };
}

