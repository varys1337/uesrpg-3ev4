/**
 * src/core/combat/opposed/actions/dispatch.js
 * Central dispatcher for opposed workflow actions
 */

import { _resolveActor, _resolveActorViaToken, _resolveToken } from "../helpers/docs.js";
import { _selectDefenderEntry, _getDefenderEntries, _isBankChoicesEnabledForData as _isBankChoicesEnabled, _getDefenderOutcome, _getDefenderAdvantage, _getDefenderResolutionState, _allDefendersCommitted, _isMultiDefender } from "../schema.js";
import { getContextAttackMode } from "../helpers/workflow.js";
import { _isBankChoicesEnabledForData, _ensureBankedScaffold, _getBankCommitState } from "../banking/state.js";
import { updateCard as _updateCardViaUpdater } from "../cards/updater.js";
import { _anyActiveGMOnline, _safeGetSetting } from "../helpers/util.js";
import { renderMultiDefenderCard, renderSingleDefenderCard } from "../cards/renderers.js";

// Import action handlers
import { handleAttackerAction } from "./attacker.js";
import { handleDefenderCommitNoDefense } from "./defender-commit.js";
import { handleDefenderCommit, handleDefenderRollCommitted } from "./defender-commit.js";
import { handleDefenderNoDefense, handleDefenderRoll } from "./defender-roll.js";
import { handleDamageRoll, handleCounterDamageRoll } from "./damage.js";
import { handleDefenderAdvantage, handleBlockResolve, handleWardResolve } from "./resolve.js";
import { handleBankedRoll } from "./banked-roll.js";
import { handleFollowUpStrike } from "./talents.js";

/**
 * Internal card rendering function.
 * Delegates to the appropriate renderer based on defender count.
 * @param {Object} data - Opposed workflow data
 * @param {string} messageId - Chat message ID
 * @returns {string} - Rendered HTML
 */
function _renderCard(data, messageId) {
  const isMulti = Array.isArray(data?.defenders) && data.defenders.length > 1;
  
  const helpers = {
    _getDefenderEntries,
    _isBankChoicesEnabledForData: _isBankChoicesEnabled,
    _anyActiveGMOnline,
    _getBankCommitState,
    _getDefenderOutcome,
    _getDefenderAdvantage,
    _getDefenderResolutionState,
    _allDefendersCommitted,
    _isMultiDefender,
    _safeGetSetting
  };

  return isMulti
    ? renderMultiDefenderCard(data, messageId, helpers)
    : renderSingleDefenderCard(data, messageId, helpers);
}

/**
 * Wrapper for updateCard that injects _renderCard dependency.
 * @param {ChatMessage} message - The chat message
 * @param {Object} data - Opposed workflow data
 */
async function _updateCard(message, data) {
  await _updateCardViaUpdater(message, data, _renderCard);
}

/**
 * Main action dispatcher for opposed workflow.
 * @param {ChatMessage} message - The opposed card chat message
 * @param {string} action - Action string (e.g., "attacker-roll", "defender-commit")
 * @param {Object} opts - Options (defenderIndex, etc.)
 * @param {Object} workflow - Reference to OpposedWorkflow object (for createPending, _autoRollBanked)
 */
export async function dispatchOpposedAction(message, action, opts = {}, workflow = null) {
  const messageId = message?.id ?? message?._id ?? null;
  const liveMessage = messageId ? (game.messages.get(messageId) ?? message) : message;
  const raw = liveMessage?.flags?.["uesrpg-3ev4"]?.opposed;
  if (!raw) return;

  // Clone so we never mutate ChatMessage flags directly (prevents stale-snapshot regressions).
  const data = foundry.utils.deepClone(raw);

  // From here on, operate on the live ChatMessage document.
  message = liveMessage;

  // Normalize combat context once per interaction to avoid legacy field regressions.
  data.context = data.context ?? {};
  if (!data.context.attackMode) data.context.attackMode = getContextAttackMode(data.context);

  const { defender: defenderData, defenderIndex, defenders, isMulti } = _selectDefenderEntry(data, opts);
  const aToken = _resolveToken(data.attacker.tokenUuid);
  let dToken = defenderData ? _resolveToken(defenderData.tokenUuid) : null;
  const attacker = aToken?.actor ?? _resolveActorViaToken(data.attacker.actorUuid, data.attacker.tokenUuid);
  let defender = defenderData ? (dToken?.actor ?? _resolveActorViaToken(defenderData.actorUuid, defenderData.tokenUuid)) : null;

  if (!attacker || !defender) {
    ui.notifications.warn("Opposed Test: could not resolve attacker/defender.");
    return;
  }

  // Banked choice mode (meta-limiting): snapshot and state scaffold
  const bankMode = _isBankChoicesEnabledForData(data);
  _ensureBankedScaffold(data);
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);

  // Back-compat: treat legacy actions as banked commits when bankMode is enabled.
  if (bankMode) {
    if (action === "attacker-roll") action = "attacker-commit";
    if (action === "defender-roll") action = "defender-commit";
    if (action === "defender-nodefense") action = "defender-commit-nodefense";
  }

  // Build shared context object for handlers
  const ctx = {
    message,
    data,
    attacker,
    defender,
    defenderData,
    defenderIndex,
    defenders,
    isMulti,
    aToken,
    dToken,
    bankMode,
    isAoE,
    opts,
    workflow,    // Workflow reference for _autoRollBanked and createPending
    _updateCard  // Inject card updater with renderCard dependency
  };

  // Route to appropriate handler
  switch (action) {
    case "banked-roll":
      return await handleBankedRoll(ctx);

    case "followup-strike":
      return await handleFollowUpStrike(ctx);

    case "attacker-roll":
    case "attacker-commit":
    case "attacker-roll-committed":
      return await handleAttackerAction(action, ctx);

    case "defender-commit-nodefense":
      return await handleDefenderCommitNoDefense(ctx);

    case "defender-commit":
    case "defender-roll-committed":
      if (action === "defender-commit") {
        return await handleDefenderCommit(ctx);
      } else {
        return await handleDefenderRollCommitted(ctx);
      }

    case "defender-nodefense":
      return await handleDefenderNoDefense(ctx);

    case "defender-roll":
      return await handleDefenderRoll(ctx);

    case "damage-roll":
      return await handleDamageRoll(ctx);

    case "counter-damage-roll":
      return await handleCounterDamageRoll(ctx);

    case "defender-advantage":
      return await handleDefenderAdvantage(ctx);

    case "block-resolve":
      return await handleBlockResolve(ctx);

    case "ward-resolve":
      return await handleWardResolve(ctx);

    default:
      console.warn(`UESRPG | Unknown opposed action: ${action}`);
      return;
  }
}
