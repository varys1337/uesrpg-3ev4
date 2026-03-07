/**
 * src/core/magic/opposed/actions/dispatch.js
 *
 * Top-level action dispatcher for magic opposed tests.
 *
 * Reads state, resolves actors, validates permissions, builds a context
 * object, and routes to the appropriate handler.
 */

import {
  getMessageState,
  selectDefenderEntry,
  isBankChoicesEnabledForData,
  allDefendersCommitted,
  resolveActor,
  requireUserCanRollActor
} from "../schema.js";
import { updateCard } from "../updater.js";
import { createUuidResolver } from "../../../../utils/uuid-cache.js";
import { handleAttackerCommit, handleAttackerRoll } from "./attacker.js";
import { autoRollBanked } from "./banked-roll.js";
import { handleDefenderCommit } from "./defender-commit.js";
import { handleDefenderRoll, handleDefenderNoDefense, handleDefenderCharacteristicTest } from "./defender-roll.js";
import { handleBlockResolve, handleWardResolve } from "./resolve.js";

/**
 * Dispatch action to appropriate handler.
 * @param {ChatMessage} message
 * @param {string} action
 * @param {object} opts
 * @param {object} workflow - Reference to MagicOpposedWorkflow
 * @param {Function} renderCard - Card rendering function
 * @returns {Promise<void>}
 */
export async function dispatchAction(message, action, opts, workflow, renderCard) {
  const overrideData = (opts?.dataOverride && typeof opts.dataOverride === "object")
    ? foundry.utils.deepClone(opts.dataOverride)
    : null;
  const data = overrideData ?? getMessageState(message);
  if (!data) return;

  const attacker = resolveActor(data.attacker.actorUuid);
  const { defender, defenderIndex, defenders } = selectDefenderEntry(data, opts);
  const defenderActor = resolveActor(defender?.actorUuid);

  if (!attacker || !defenderActor) {
    ui.notifications.warn("Could not resolve actors.");
    return;
  }

  const bankMode = isBankChoicesEnabledForData(data);

  // Build context object for handlers
  const ctx = {
    message,
    data,
    attacker,
    defender,
    defenderActor,
    defenderIndex,
    defenders,
    isMulti: defenders.length > 1,
    bankMode,
    batchedUpdate: Boolean(opts?.batchedUpdate),
    opts,
    workflow,
    spell: null, // Will be resolved as needed by handlers
    // Per-workflow UUID resolution cache (ephemeral — GC'd with this closure)
    _uuidResolver: createUuidResolver(),
    // Helper functions
    resolveActor,
    _updateCard: (msg, d) => updateCard(msg, d, renderCard),
    _markResolutionPhase: (d, phase) => { d.context = d.context ?? {}; d.context.phase = phase; },
    _allDefendersCommitted: allDefendersCommitted
  };

  // Resolve spell if needed
  if (data.attacker?.spellUuid) {
    ctx.spell = await ctx._uuidResolver.resolve(data.attacker.spellUuid);
    if (!ctx.spell && (action === "attacker-roll" || action === "block-resolve" || action === "ward-resolve" || action === "defender-characteristic-test")) {
      ui.notifications.error("Could not resolve spell.");
      return;
    }
  }

  // Permission checks
  const isAttackerAction = action === "attacker-commit" || action === "attacker-roll";
  const isDefenderAction = action.startsWith("defender-");

  if (isAttackerAction && !requireUserCanRollActor(game.user, attacker)) return;
  if (isDefenderAction && !requireUserCanRollActor(game.user, defenderActor)) return;
  if ((action === "block-resolve" || action === "ward-resolve") && !requireUserCanRollActor(game.user, defenderActor)) return;

  // Dispatch to appropriate handler
  switch (action) {
    case "begin-banked-roll": {
      const activeGM = game.users.activeGM ?? null;
      if (activeGM) {
        if (!game.user?.isGM || game.user.id !== activeGM.id) {
          ui.notifications.info("Requested GM to begin the opposed roll.");
          return;
        }
      } else if (!message.isAuthor && !game.user?.isGM) {
        ui.notifications.warn("Only the message author may begin the opposed roll (no GM active).");
        return;
      }
      return await autoRollBanked(message, workflow, ctx._updateCard, { reason: "manual" });
    }

    case "attacker-commit":
      return await handleAttackerCommit(ctx);

    case "attacker-roll":
      return await handleAttackerRoll(ctx);

    case "defender-commit-block":
    case "defender-commit-evade":
    case "defender-commit":
    case "defender-commit-characteristic":
    case "defender-commit-nodefense":
      return await handleDefenderCommit(ctx, action);

    case "defender-roll-block":
    case "defender-roll-evade":
    case "defender-roll-ward":
      return await handleDefenderRoll(ctx, action);

    case "defender-characteristic-test":
      return await handleDefenderCharacteristicTest(ctx);

    case "defender-no-defense":
      return await handleDefenderNoDefense(ctx);

    case "block-resolve":
      return await handleBlockResolve(ctx);

    case "ward-resolve":
      return await handleWardResolve(ctx);

    default:
      console.warn(`UESRPG | Unknown magic opposed action: ${action}`);
      return;
  }
}
