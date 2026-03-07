/**
 * src/core/skills/opposed-workflow/actions/dispatch.js
 *
 * Top-level action dispatcher for skill opposed tests.
 *
 * Reads state, resolves actors/tokens, validates them, then routes
 * to the appropriate handler (attacker, defender, or begin-banked-roll).
 *
 * The `workflow` parameter is the SkillOpposedWorkflow object; it is
 * forwarded to the banking orchestrator so auto-roll can call
 * workflow.handleAction() without creating a circular import.
 */

import { _getMessageState } from "../core/schema.js";
import { _resolveActor, _resolveToken } from "../core/docs.js";
import { autoRollBanked } from "../banking/orchestrator.js";
import { handleAttackerRoll } from "./attacker.js";
import { handleDefenderRoll } from "./defender.js";

/**
 * Dispatch a skill opposed action.
 *
 * @param {ChatMessage} message
 * @param {string}      action
 * @param {object}      opts         { event, batchedUpdate, dataOverride }
 * @param {object}      workflow     SkillOpposedWorkflow (needed by orchestrator)
 * @returns {Promise<object|undefined>}
 */
export async function dispatchAction(message, action, { event, batchedUpdate = false, dataOverride = null } = {}, workflow) {
  const data = (dataOverride && typeof dataOverride === "object")
    ? foundry.utils.deepClone(dataOverride)
    : _getMessageState(message);
  if (!data) return;

  const attacker = _resolveActor(data.attacker.actorUuid);
  const defender = _resolveActor(data.defender.actorUuid);
  const aToken = _resolveToken(data.attacker.tokenUuid);
  const dToken = _resolveToken(data.defender.tokenUuid);

  // Hard bind the roll to the original token identities (prevents "replacement target" responses).
  if (data.attacker.tokenUuid && !aToken) {
    ui.notifications.warn("Opposed Skill Test: attacker token is no longer present.");
    return;
  }
  if (data.defender.tokenUuid && !dToken) {
    ui.notifications.warn("Opposed Skill Test: target token is no longer present.");
    return;
  }
  if (aToken && attacker.uuid && aToken.actor?.uuid && aToken.actor.uuid !== attacker.uuid) {
    ui.notifications.warn("Opposed Skill Test: attacker token no longer matches the original actor.");
    return;
  }
  if (dToken && defender.uuid && dToken.actor?.uuid && dToken.actor.uuid !== defender.uuid) {
    ui.notifications.warn("Opposed Skill Test: target token no longer matches the original actor.");
    return;
  }

  if (!attacker || !defender) {
    ui.notifications.warn("Opposed Skill Test: could not resolve actors.");
    return;
  }

  // Manual begin: GM-only when a GM is active; otherwise the parent author may begin.
  if (action === "begin-banked-roll") {
    const activeGM = game.users.activeGM ?? null;
    if (activeGM) {
      if (!game.user.isGM) {
        ui.notifications.info("Requested GM to begin the opposed roll.");
        return;
      }
    } else {
      if (!message.isAuthor && !game.user.isGM) {
        ui.notifications.warn("Only the message author may begin the opposed roll (no GM active).");
        return;
      }
    }

    await autoRollBanked(message.id, workflow, { trigger: "manual" });
    return;
  }

  const ctx = { message, data, attacker, defender, aToken, dToken, event, batchedUpdate };

  if (action === "attacker-roll" || action === "attacker-roll-committed") {
    return handleAttackerRoll(ctx, action);
  }

  if (action === "defender-roll" || action === "defender-roll-committed") {
    return handleDefenderRoll(ctx, action);
  }
}

