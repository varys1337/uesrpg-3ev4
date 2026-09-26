import { _renderCard } from './opposed/render.js';
/**
 * src/core/combat/opposed-workflow.js
 *
 * Canonical opposed/contested workflow for UESRPG 3ev4 (Foundry v14.368+).
 *
 * Design goals (per project decisions):
 *  - Clicking the combat style dice icon with a target selected ONLY creates a pending chat card.
 *  - Attacker rolls from the chat card. "Roll Attack" opens ONE dialog:
 *      - Attack variation selector (Normal / All Out / Precision / Coup de Grâce)
 *      - Manual TN modifier input
 *  - Defender rolls from the chat card via DefenseDialog (owns defense eligibility + TN calc).
 *  - Dice So Nice compatibility: each side's d100 roll is executed as a real Foundry Roll and
 *    sent as its own ChatMessage using Roll#toMessage (so DSN hooks always fire).
 *  - The opposed chat card is then updated with the numeric outcomes and final resolution.
 */


import { resolveOutcomeRAW as _resolveOutcomeRAWImpl, computeAdvantageRAW as _computeAdvantageRAWImpl } from "./opposed/outcome-resolution.js";


import { consumePendingAmmo as _consumePendingAmmoImpl } from "./opposed/damage/ammunition.js";
import { selfHealOpposedCardFromStoredRolls as _selfHealOpposedCardFromStoredRollsImpl } from "./opposed/cards/recovery.js";
import { hydrateSideResultFromRollMessageId as _hydrateSideResultFromRollMessageIdImpl, ensureResolvedForPostActions as _ensureResolvedForPostActionsImpl } from "./opposed/cards/hydration.js";
import { applyExternalRollMessage as _applyExternalRollMessageImpl } from "./opposed/banking/external-roll.js";

import { hasEquippedShieldType as _hasEquippedShieldTypeImpl } from "./opposed/helpers/utility.js";

import { registerAdvantageExpirationHooks, markPendingSneakAttack } from "./opposed/effects.js";

import { _cleanupAutoRollContext, _getDefenderEntries } from "./opposed/banking/state.js";

import { _isMultiDefender, _resolveDefenderIndex, _selectDefenderEntry, _getDefenderOutcome, _setDefenderOutcome, _setDefenderAdvantage } from "./opposed/schema.js";


import {
  updateCard as _updateCardViaUpdater,
  getChatMessageAuthorUser as _getChatMessageAuthorUser,
  applyDefenderCommitToData as _applyDefenderCommitToData,
  applyAttackerCommitToData as _applyAttackerCommitToData
} from "./opposed/cards/updater.js";


import {
  maybeAutoRollBanked as _maybeAutoRollBankedOrchestrator,
  maybeAutoRollBankedNoGM as _maybeAutoRollBankedNoGMOrchestrator,
  autoRollBanked as _autoRollBankedOrchestrator
} from "./opposed/banking/orchestrator.js";

import { applyCombatTalentDoSAdjustments } from "../traits/combat-talents.js";


import { applyHyperAwarenessToResult } from "../traits/awareness-talents.js";


import { createPending as _createPendingImpl } from "./opposed/createPending.js";

// Export internal wrapper function needed by action handlers
export { _ensureResolvedForPostActions };

import { weaponHasQuality as _weaponHasQuality, resolveDoc as _resolveDoc, getPreferredWeaponUuid as _getPreferredWeaponUuid, resolveActor as _resolveActor, resolveToken as _resolveToken, maybeSetAoEEvadeEscape as _maybeSetAoEEvadeEscape, applyAoEEvadeOutcome as _applyAoEEvadeOutcome, logDebug as _logDebug, userHasActorOwnership as _userHasActorOwnership } from "./opposed/helpers/workflow.js";


async function _updateCard(message, data) {
  return _updateCardViaUpdater(message, data, _renderCard);
}


// Phase 18.2: Card hydration helpers - extracted to card-hydration.js


async function _hydrateSideResultFromRollMessageId({ message, data, sideKey, expectedStage, expectedActor }) {
  return _hydrateSideResultFromRollMessageIdImpl(
    { message, data, sideKey, expectedStage, expectedActor },
    { getChatMessageAuthorUser: _getChatMessageAuthorUser, userHasActorOwnership: _userHasActorOwnership, applyDefenderCommitToData: _applyDefenderCommitToData }
  );
}

// Delegation wrapper - extracted to card-recovery.js (Phase 16)
async function _selfHealOpposedCardFromStoredRolls(message, data, options = {}) {
  return _selfHealOpposedCardFromStoredRollsImpl(message, data, options, {
    _resolveActor,
    _selectDefenderEntry,
    _getDefenderOutcome,
    _setDefenderOutcome,
    _setDefenderAdvantage,
    _getDefenderEntries,
    _resolveOutcomeRAW,
    _computeAdvantageRAW,
    _applyAoEEvadeOutcome,
    _hydrateSideResultFromRollMessageId,
    _cleanupAutoRollContext,
    _updateCard,
    _logDebug
  });
}
//
// Ensure the opposed card is in a resolved state before running post-resolution actions
// (e.g. Roll Damage). Some edge cases can display resolved HTML while the stored
// flags are still missing outcome/status due to out-of-order or partial updates.
// This helper is a safe, deterministic self-heal: if both roll results exist, it
// computes outcome + advantage and persists them to the card.
async function _ensureResolvedForPostActions(message, data, { defenderIndex = null, defenderTokenUuid = null, defenderActorUuid = null } = {}) {
  return _ensureResolvedForPostActionsImpl(
    message,
    data,
    { defenderIndex, defenderTokenUuid, defenderActorUuid },
    {
      selectDefenderEntry: _selectDefenderEntry,
      getDefenderOutcome: _getDefenderOutcome,
      selfHealOpposedCardFromStoredRolls: _selfHealOpposedCardFromStoredRolls,
      updateCard: _updateCard,
      logDebug: _logDebug
    }
  );
}


/**
 * Delegation wrapper for outcome resolution.
 * Preserves backward compatibility while extracting implementation to outcome-resolution.js.
 */
function _resolveOutcomeRAW(data, defender = null) {
  return _resolveOutcomeRAWImpl(data, defender);
}

/**
 * Delegation wrapper for advantage calculation.
 * Preserves backward compatibility while extracting implementation to outcome-resolution.js.
 */
function _computeAdvantageRAW(data, outcome, defender = null) {
  return _computeAdvantageRAWImpl(data, outcome, defender, { 
    hasEquippedShieldType: _hasEquippedShieldType, 
    resolveDoc: _resolveDoc 
  });
}


registerAdvantageExpirationHooks();

// --- Aim (Chapter 5 Action) helpers ----------------------------------------


async function _markPendingSneakAttack(actor, opts) {
  return markPendingSneakAttack(actor, opts);
}


// Phase 18.4: Shield helpers - extracted to utility-helpers.js


function _hasEquippedShieldType(actor, typeKey) {
  return _hasEquippedShieldTypeImpl(actor, typeKey);
}

// Block Rating resolver is centralized in module/combat/mitigation.js


/**
 * Prompt the defender to utilize their Advantage after a successful defense.
 *
 * RAW (Chapter 5, Attacking & Defending, Step 3):
 * "Defender wins: The defense is successful, the defender chooses how to utilize their advantage and resolves it."
 *
 * Pre–Active Effects scope: we provide a pipeline to select/record an advantage utilization choice,
 * and post a chat audit message. Most mechanical outcomes will be implemented later via Active Effects.
 */


// NOTE: Duplicate _promptDefenderAdvantage removed (boot-time SyntaxError fix)


// Delegation wrapper - extracted to ammunition-consumption.js (Phase 16)
async function _consumePendingAmmo(pendingAmmo) {
  return _consumePendingAmmoImpl(pendingAmmo);
}

// Delegation wrapper - extracted to damage-chat-cards.js (Phase 16)


// Phase 18.1: Weapon quality display helpers - extracted to weapon-quality-display.js


/**
 * Post a weapon damage chat card.
 *
 * This mirrors the standard "Roll Damage" output so that block-resolution flows
 * still provide a clear record of hit location and rolled damage.
 *
 * Non-invasive: chat-only; does not mutate documents.
 */
// Delegation wrapper - extracted to damage-chat-cards.js (Phase 16)


// Phase 18.4: Shared damage helpers - extracted to utility-helpers.js


// _bankedAutoRollLocalLocks imported from banking.js

export const OpposedWorkflow = {
  async consumePendingAmmo(pendingAmmo) {
    return _consumePendingAmmo(pendingAmmo);
  },

  /**
   * Bank an externally-created roll message (attacker-roll / defender-roll / defender-nodefense)
   * into the originating opposed chat card.
   *
   * Rationale: players can always create their own roll messages, but Foundry's ChatMessage
   * update permissions can prevent that player from updating the *parent* opposed card (which
   * is authored by another user). When an active GM is present, this method is intended to be
   * executed on the active GM client from a createChatMessage hook.
   *
   * @param {ChatMessage} rollMessage
   */
  async applyExternalRollMessage(rollMessage) {
    // Phase 18.3: Delegated to external-roll-banking.js
    return _applyExternalRollMessageImpl(rollMessage, {
      resolveDefenderIndex: _resolveDefenderIndex,
      getDefenderEntries: _getDefenderEntries,
      resolveActor: _resolveActor,
      userHasActorOwnership: _userHasActorOwnership,
      selectDefenderEntry: _selectDefenderEntry,
      getDefenderOutcome: _getDefenderOutcome,
      setDefenderOutcome: _setDefenderOutcome,
      setDefenderAdvantage: _setDefenderAdvantage,
      resolveOutcomeRAW: _resolveOutcomeRAW,
      computeAdvantageRAW: _computeAdvantageRAW,
      applyAoEEvadeOutcome: _applyAoEEvadeOutcome,
      isMultiDefender: _isMultiDefender,
      cleanupAutoRollContext: _cleanupAutoRollContext,
      applyDefenderCommitToData: _applyDefenderCommitToData,
      applyAttackerCommitToData: _applyAttackerCommitToData,
      updateCard: _updateCard,
      getPreferredWeaponUuid: _getPreferredWeaponUuid,
      weaponHasQuality: _weaponHasQuality,
      hasEquippedShieldType: _hasEquippedShieldType,
      applyCombatTalentDoSAdjustments,
      applyHyperAwarenessToResult,
      maybeSetAoEEvadeEscape: _maybeSetAoEEvadeEscape,
      markPendingSneakAttack: _markPendingSneakAttack,
      resolveToken: _resolveToken
    });
  },

  /**
   * Banked-choice auto roll hook helper.
   * Called from updateChatMessage (GM) to begin rolling once both sides have committed.
   */
  async maybeAutoRollBanked(message) {
    return _maybeAutoRollBankedOrchestrator(message, this, _updateCard);
  },

  /**
   * Banked-choice auto roll helper for non-GM scenarios.
   *
   * If no active GM is online, each participant auto-rolls their own committed lane once
   * both sides have committed. Parent-card updates are still applied by the message author
   * (via Authority Proxy), so the workflow completes deterministically without a manual
   * “Roll (GM)” confirmation.
   */
  async maybeAutoRollBankedNoGM(message) {
    return _maybeAutoRollBankedNoGMOrchestrator(message, this, _updateCard);
  },
  /**
   * Begin rolling a banked-choice opposed test once both sides have committed.
   * This will roll any unresolved lanes without prompting for additional choices.
   *
   * Safeguards:
   *  - Local lock prevents same-client re-entrancy (e.g. commit-path + update hook).
   *  - Claim-id prevents cross-caller duplication if two runners attempt to start simultaneously.
   */
  async _autoRollBanked(parentMessageId, { trigger = "auto" } = {}) {
    return _autoRollBankedOrchestrator(parentMessageId, { trigger }, this, _updateCard);
  },


  /**
   * Create a pending opposed test card.
   * Compatible with legacy callers.
   */
  async createPending(cfg = {}) {
    return await _createPendingImpl(cfg);
  },

  async handleAction(message, action, opts = {}) {
    // Delegate to the modular action dispatcher (Phase 1: Façade pattern)
    const { dispatchOpposedAction } = await import("./opposed/actions/dispatch.js");
    return await dispatchOpposedAction(message, action, opts, this);
  }
};
