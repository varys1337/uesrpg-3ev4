/**
 * src/core/combat/opposed-workflow.js
 *
 * Canonical opposed/contested workflow for UESRPG 3ev4 (Foundry v13 runtime).
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

import { doTestRoll, computeResultFromRollTotal } from "../../utils/degree-roll-helper.js";
import { UESRPG } from "../constants.js";
import { hasCondition } from "../conditions/condition-engine.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { DefenseDialog } from "./defense-dialog.js";
import { computeTN, listCombatStyles, hasEquippedShield, variantMod as computeVariantMod } from "./tn.js";
import { computeDefenseAvailability, normalizeDefenseType } from "./defense-options.js";
import { getAttackModeFromWeapon, getDamageTypeFromWeapon, getHitLocationFromRoll, resolveHitLocationForTarget, getTokenDashContext, clearTokenDashContext, getEffectiveWeaponHands } from "./combat-utils.js";
import { getBlockValue, normalizeHitLocation } from "./mitigation.js";
import { DAMAGE_TYPES } from "./damage-automation.js";
import { ActionEconomy } from "./action-economy.js";
import { AttackTracker } from "./attack-tracker.js";
import { safeUpdateChatMessage } from "../../utils/chat-message-socket.js";
import { requestCreateActiveEffect } from "../../utils/authority-proxy.js";
import { buildSpecialActionsForActor, isSpecialActionUsableNow, SPECIAL_ACTIONS, getSpecialActionById } from "./combat-style-utils.js";
import { getActiveStaminaEffect, consumeStaminaEffect, STAMINA_EFFECT_KEYS } from "../stamina/stamina-effects.js";
import { isActorSkeletal, isActorUndead } from "../traits/trait-registry.js";
import { canTokenEscapeTemplate } from "../../utils/aoe-utils.js";
import { TimeService, buildEffectDuration } from "../time/index.js";
import { MagicTimekeeping } from "../magic/timekeeping-helper.js";
import { isEffectExpiredByCombat, isEffectExpiredByWorldTime } from "../magic/effects/spell-effect-expiration.js";
import {
  _maybeEnableFollowUpStrike,
  _maybeApplyMightyCleave,
  _getGladiatorContext,
  _markGladiatorFreeReactionUsed,
  _getFreeDefenseReactionContext,
  _getUnstoppableMightWeaponEligibility,
  _hasUnstoppableMightEligibleWeapons,
  _promptUnstoppableMightUsage
} from "./opposed/helpers/talents.js";
import { promptDefenderAdvantage as _promptDefenderAdvantageImpl } from "./opposed/dialogs/defender.js";
import { resolveOutcomeRAW as _resolveOutcomeRAWImpl, computeAdvantageRAW as _computeAdvantageRAWImpl } from "./opposed/outcome-resolution.js";
import { rollWeaponDamage as _rollWeaponDamageImpl, rollManualDamage as _rollManualDamageImpl } from "./opposed/damage/roller.js";
import { executeAdvantageSpecialActions as _executeAdvantageSpecialActions } from "./opposed/special-actions-automation.js";
import { postWeaponDamageChatCard as _postWeaponDamageChatCardImpl, postManualEffectChatCard as _postManualEffectChatCardImpl } from "./opposed/damage/chat-cards.js";
import { consumePendingAmmo as _consumePendingAmmoImpl } from "./opposed/damage/ammunition.js";
import { selfHealOpposedCardFromStoredRolls as _selfHealOpposedCardFromStoredRollsImpl } from "./opposed/cards/recovery.js";
import {
  isValidOpposedRollMessageForHeal as _isValidOpposedRollMessageForHealImpl,
  extractFirstRollTotal as _extractFirstRollTotalImpl,
  hydrateSideResultFromRollMessageId as _hydrateSideResultFromRollMessageIdImpl,
  ensureResolvedForPostActions as _ensureResolvedForPostActionsImpl
} from "./opposed/cards/hydration.js";
import { applyExternalRollMessage as _applyExternalRollMessageImpl } from "./opposed/banking/external-roll.js";
import {
  listEquippedShields as _listEquippedShieldsImpl,
  hasEquippedShieldType as _hasEquippedShieldTypeImpl,
  buildSharedDamagePayload as _buildSharedDamagePayloadImpl,
  inflateSharedDamage as _inflateSharedDamageImpl
} from "./opposed/helpers/utility.js";
import {
  getQualityLabelIndex as _getQualityLabelIndexImpl,
  buildInlineQualityTags as _buildInlineQualityTagsImpl,
  collectWeaponInlineQualities as _collectWeaponInlineQualitiesImpl,
  collectActivationDamageQualities as _collectActivationDamageQualitiesImpl,
  buildWeaponPillsInline as _buildWeaponPillsInlineImpl
} from "./opposed/helpers/weapon-quality-display.js";
import {
  createTemporaryEffect,
  advantageDurationData,
  isAdvantageEffect,
  isAdvantageEffectExpired,
  expireAdvantageEffects,
  registerAdvantageExpirationHooks,
  deleteActorEffectSafe,
  getAimStateFromEffect,
  breakAimChainIfPresent,
  consumeOrBreakAimAfterAttack,
  applyPressAdvantageEffect,
  applyOverextendEffect,
  applyOverwhelmEffect,
  consumeOneShotAdvantageEffects,
  consumeHiddenAfterAttack,
  markPendingSneakAttack
} from "./opposed/effects.js";
import {
  getWeaponRangeBands as _getWeaponRangeBands,
  computeRangedRangeContext as _computeRangedRangeContext,
  getWeaponReachBounds as _getWeaponReachBounds,
  computeMeleeReachContext as _computeMeleeReachContext,
  parseRangeBandsFromWeapon as _parseRangeBandsFromWeapon
} from "./opposed/helpers/combat.js";
import {
  _bankedAutoRollLocalLocks,
  _cleanupAutoRollContext,
  _isBankChoicesEnabledForData,
  _ensureBankedScaffold,
  _getDefenderEntries,
  _allDefendersCommitted,
  _getBankCommitState,
  _anyActiveGMOnline
} from "./opposed/banking/state.js";

import {
  _isMultiDefender,
  _resolveDefenderIndex,
  _selectDefenderEntry,
  _getDefenderOutcome,
  _setDefenderOutcome,
  _getDefenderAdvantage,
  _setDefenderAdvantage,
  _getDefenderResolutionState
} from "./opposed/schema.js";

import {
  _btn,
  _fmtDegree,
  _renderBreakdown,
  _renderRollLine
} from "./opposed/cards/template-helpers.js";

import {
  updateCard as _updateCardViaUpdater,
  getChatMessageAuthorUser as _getChatMessageAuthorUser,
  applyDefenderCommitToData as _applyDefenderCommitToData,
  applyAttackerCommitToData as _applyAttackerCommitToData
} from "./opposed/cards/updater.js";

import {
  renderMultiDefenderCard,
  renderSingleDefenderCard
} from "./opposed/cards/renderers.js";

import {
  maybeAutoRollBanked as _maybeAutoRollBankedOrchestrator,
  maybeAutoRollBankedNoGM as _maybeAutoRollBankedNoGMOrchestrator,
  autoRollBanked as _autoRollBankedOrchestrator
} from "./opposed/banking/orchestrator.js";

import {
  applyAttackerTalentPreTN,
  applyCombatTalentDoSAdjustments,
  getDefenseTalentOverrides,
  getEvadeOverrideContext,
  applyDefenderTalentTNMods
} from "../traits/combat-talents.js";

import { hasTalent } from "../traits/talents-api.js";
import { anyOtherTokensInMeleeOfEither, countOpponentsInMeleeRange, getMeleeReachMeters } from "../traits/combat-proximity.js";
import { applySenseLossPenaltyAdjustments, applyHyperAwarenessToResult } from "../traits/awareness-talents.js";

import {
  attackerDeclareDialog,
  promptWeaponAndAdvantages
} from "./opposed/dialogs/attacker.js";
import { _resolveItemViaActor } from "./opposed/helpers/docs.js";
import { createPending as _createPendingImpl } from "./opposed/createPending.js";

// Export internal wrapper function needed by action handlers
export { _ensureResolvedForPostActions };

// Phase 10: Import workflow helper functions from dedicated module
import {
  collectSensorySituationalMods as _collectSensorySituationalMods,
  collectDefenseSensorySituationalMods as _collectDefenseSensorySituationalMods,
  asNumber as _asNumber,
  normalizeKey as _normalizeKey,
  getSystemId as _getSystemId,
  weaponHasQuality as _weaponHasQuality,
  parseRangeTriplet as _parseRangeTriplet,
  measurePointDistance as _measurePointDistance,
  promptYesNo as _promptYesNo,
  promptSelectToken as _promptSelectToken,
  getEquippedOneHandMeleeWeapons as _getEquippedOneHandMeleeWeapons,
  getOtherDualWieldWeaponUuid as _getOtherDualWieldWeaponUuid,
  spendStaminaPoints as _spendStaminaPoints,
  resolveDoc as _resolveDoc,
  getPreferredWeaponUuid as _getPreferredWeaponUuid,
  preConsumeAttackAmmo as _preConsumeAttackAmmo,
  markWeaponNeedsReload as _markWeaponNeedsReload,
  resolveActor as _resolveActor,
  resolveToken as _resolveToken,
  isIsolatedDuelByTokens as _isIsolatedDuelByTokens,
  canUseExploitAdvantage as _canUseExploitAdvantage,
  canControlActor as _canControlActor,
  promptAoEEvadeEscape as _promptAoEEvadeEscape,
  maybeSetAoEEvadeEscape as _maybeSetAoEEvadeEscape,
  applyAoEEvadeOutcome as _applyAoEEvadeOutcome,
  variantLabel as _variantLabel,
  circumstanceLabel as _circumstanceLabel,
  getDefenseGatingContext as _getDefenseGatingContext,
  getTokenMovementAction as _getTokenMovementAction,
  getWeaponReachMeters as _getWeaponReachMeters,
  getThunderChargeEligibility as _getThunderChargeEligibility,
  inferAttackModeFromPreferredWeapon as _inferAttackModeFromPreferredWeapon,
  debugEnabled as _debugEnabled,
  logDebug as _logDebug,
  userHasActorOwnership as _userHasActorOwnership,
  safeGetSetting as _safeGetSetting,
  opposedFlags as _opposedFlags,
  getContextAttackMode
} from "./opposed/helpers/workflow.js";


// _renderBreakdown, _renderRollLine imported from card-template-helpers.js

function _renderCard(data, messageId) {
  const isMulti = Array.isArray(data?.defenders) && data.defenders.length > 1;
  
  const helpers = {
    _getDefenderEntries,
    _isBankChoicesEnabledForData,
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

async function _updateCard(message, data) {
  await _updateCardViaUpdater(message, data, _renderCard);
}



// Phase 18.2: Card hydration helpers - extracted to card-hydration.js
function _isValidOpposedRollMessageForHeal({ rollMessage, parentMessageId, expectedStage, expectedActor }) {
  return _isValidOpposedRollMessageForHealImpl(
    { rollMessage, parentMessageId, expectedStage, expectedActor },
    { getChatMessageAuthorUser: _getChatMessageAuthorUser, userHasActorOwnership: _userHasActorOwnership }
  );
}

function _extractFirstRollTotal(rollMessage) {
  return _extractFirstRollTotalImpl(rollMessage);
}

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

async function _attackerDeclareDialog(attackerActor, attackerLabel, opts = {}) {
  return attackerDeclareDialog(attackerActor, attackerLabel, opts);
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

function _combatClock() {
  const c = game.combat;
  if (c && Number.isFinite(c.round) && Number.isFinite(c.turn)) {
    return { inCombat: true, round: c.round, turn: c.turn };
  }
  return { inCombat: false, round: null, turn: null };
}

async function _createTemporaryEffect(actor, effectData) {
  return createTemporaryEffect(actor, effectData);
}

function _advantageDurationData(actor, rounds = 1) {
  return advantageDurationData(actor, rounds);
}

function _isAdvantageEffect(effect) {
  return isAdvantageEffect(effect);
}

function _isAdvantageEffectExpired(effect, opts) {
  return isAdvantageEffectExpired(effect, opts);
}

async function _expireAdvantageEffects(opts) {
  return expireAdvantageEffects(opts);
}

registerAdvantageExpirationHooks();

// --- Aim (Chapter 5 Action) helpers ----------------------------------------

function _findEnabledEffectByUesrpgKey(actor, key) {
  if (!actor || !key) return null;
  return actor.effects?.find?.((e) => !e.disabled && getFlagValueWithFallback(e, "key") === key) ?? null;
}

async function _deleteActorEffectSafe(actor, effect) {
  return deleteActorEffectSafe(actor, effect);
}

function _getAimStateFromEffect(effect) {
  return getAimStateFromEffect(effect);
}

async function _breakAimChainIfPresent(actor) {
  return breakAimChainIfPresent(actor);
}

async function _consumeOrBreakAimAfterAttack(actor, opts) {
  return consumeOrBreakAimAfterAttack(actor, opts);
}


async function _applyPressAdvantageEffect(attacker, defender, opts) {
  return applyPressAdvantageEffect(attacker, defender, opts);
}

async function _applyOverextendEffect(opponent, { defenderUuid = null, defenderTokenUuid = null, opponentTokenUuid = null, doubleEffect = false } = {}) {
  if (!opponent) return null;
  const duration = _advantageDurationData(opponent, 1);

  const defenderActor = defenderUuid ? _resolveDoc(defenderUuid) : null;
  const canDouble = Boolean(doubleEffect && defenderActor && _canUseExploitAdvantage(defenderActor, { actorTokenUuid: defenderTokenUuid, opponentTokenUuid }));
  const tnDelta = canDouble ? -20 : -10;

  const effectData = {
    name: "Overextended",
    img: "icons/svg/downgrade.svg",
    origin: opponent.uuid,
    disabled: false,
    duration,
    changes: [
      {
        key: "system.modifiers.combat.opposed.attackTN",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: tnDelta,
        priority: 20
      }
    ],
    flags: {
  uesrpg: {
    category: "advantage",
    key: "overextend",
    source: {
      actorUuid: defenderUuid ?? null,
      tokenUuid: defenderTokenUuid ?? null
    },
    target: {
      actorUuid: opponent?.uuid ?? null,
      tokenUuid: opponentTokenUuid ?? null
    },
    // Opponent-scoped: affects the target's next attack test (any attack type) against this defender.
    // RAW: "The opponent’s next attack test within 1 round is made at a -10 penalty."
    conditions: {
      ...(defenderUuid ? { opponentUuid: defenderUuid } : {}),
      ...(canDouble ? { requireIsolatedDuel: true } : {})
    }
  }
}};

  return await _createTemporaryEffect(opponent, effectData);
}

async function _applyOverwhelmEffect(opponent, opts) {
  return applyOverwhelmEffect(opponent, opts);
}

async function _consumeOneShotAdvantageEffects(actor, opts) {
  return consumeOneShotAdvantageEffects(actor, opts);
}


async function _consumeHiddenAfterAttack(actor) {
  return consumeHiddenAfterAttack(actor);
}

async function _markPendingSneakAttack(actor, opts) {
  return markPendingSneakAttack(actor, opts);
}

/**
 * Delegation wrapper for defender advantage dialog.
 * Preserves backward compatibility while extracting implementation to defender-dialogs.js.
 */
async function _promptDefenderAdvantage(opts) {
  return _promptDefenderAdvantageImpl(opts);
}
async function _maybeResolveDefenderAdvantage(message, data) {
  try {
    const adv = Number(data?.advantage?.defender ?? 0);
    if (!Number.isFinite(adv) || adv <= 0) return;

    data.advantageSpent = data.advantageSpent ?? {};
    if (data.advantageSpent.defender === true) return;

    // RAW focus: defender advantage options are melee-centric.
    const attackMode = getContextAttackMode(data?.context);
    if (attackMode !== "melee") return;

    const defender = _resolveActorViaToken(data?.defender?.actorUuid, data?.defender?.tokenUuid);
    const attacker = _resolveActorViaToken(data?.attacker?.actorUuid, data?.attacker?.tokenUuid);
    if (!defender || !attacker) return;

    if (!_canControlActor(defender) && !game.user.isGM) return;

    const choice = await _promptDefenderAdvantage({
      defenderActor: defender,
      attackerActor: attacker,
      advantageCount: adv,
      defenderTokenUuid: data.defender?.tokenUuid ?? null,
      opponentTokenUuid: data.attacker?.tokenUuid ?? null,
      styleUuidForKnown: data.defender?.styleUuid ?? null
    });

    data.advantageSpent.defender = true;
    data.advantageResolution = data.advantageResolution ?? {};
    data.advantageResolution.defender = choice ?? { overextend: false, overwhelm: false };

    await _updateCard(message, data);

    if (!choice) return;

    if (choice.overextend) {
      await _applyOverextendEffect(attacker, {
        defenderUuid: defender.uuid,
        defenderTokenUuid: data.defender?.tokenUuid ?? null,
        opponentTokenUuid: data.attacker?.tokenUuid ?? null,
        doubleEffect: Boolean(choice.overextendDouble)
      });
    }
    if (choice.overwhelm) await _applyOverwhelmEffect(attacker, { defenderUuid: defender.uuid });
  } catch (err) {
    console.error("UESRPG | Defender Advantage resolution failed.", { messageId: message?.id, err });
  }
}

// Phase 18.4: Shield helpers - extracted to utility-helpers.js
function _listEquippedShields(actor) {
  return _listEquippedShieldsImpl(actor);
}

function _hasEquippedShieldType(actor, typeKey) {
  return _hasEquippedShieldTypeImpl(actor, typeKey);
}

// Block Rating resolver is centralized in module/combat/mitigation.js

async function _promptWeaponAndAdvantages(opts = {}) {
  return promptWeaponAndAdvantages(opts);
}
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



/**
 * Delegation wrapper for weapon damage rolling.
 * Preserves backward compatibility while extracting implementation to weapon-damage-roller.js.
 */
async function _rollWeaponDamage(opts) {
  return _rollWeaponDamageImpl(opts);
}

/**
 * Delegation wrapper for manual damage rolling.
 * Preserves backward compatibility while extracting implementation to weapon-damage-roller.js.
 */
async function _rollManualDamage(opts) {
  return _rollManualDamageImpl(opts);
}
// Delegation wrapper - extracted to ammunition-consumption.js (Phase 16)
async function _consumePendingAmmo(pendingAmmo) {
  return _consumePendingAmmoImpl(pendingAmmo);
}

// Delegation wrapper - extracted to damage-chat-cards.js (Phase 16)
async function _postManualEffectChatCard(params) {
  return _postManualEffectChatCardImpl({ ...params, _opposedFlags });
}

// Phase 18.1: Weapon quality display helpers - extracted to weapon-quality-display.js
function _getQualityLabelIndex() {
  return _getQualityLabelIndexImpl();
}

function _buildInlineQualityTags({ structured = [], traits = [] } = {}) {
  return _buildInlineQualityTagsImpl({ structured, traits });
}

function _collectWeaponInlineQualities(weapon) {
  return _collectWeaponInlineQualitiesImpl(weapon);
}

function _collectActivationDamageQualities(activationDamage) {
  return _collectActivationDamageQualitiesImpl(activationDamage);
}

function _buildWeaponPillsInline(weapon) {
  return _buildWeaponPillsInlineImpl(weapon);
}

/**
 * Post a weapon damage chat card.
 *
 * This mirrors the standard "Roll Damage" output so that block-resolution flows
 * still provide a clear record of hit location and rolled damage.
 *
 * Non-invasive: chat-only; does not mutate documents.
 */
// Delegation wrapper - extracted to damage-chat-cards.js (Phase 16)
async function _postWeaponDamageChatCard(params) {
  return _postWeaponDamageChatCardImpl({ ...params, _buildWeaponPillsInline, _opposedFlags });
}

// Phase 18.4: Shared damage helpers - extracted to utility-helpers.js
function _buildSharedDamagePayload({ mode, dmg, weaponUuid = null, damageType = null } = {}) {
  return _buildSharedDamagePayloadImpl({ mode, dmg, weaponUuid, damageType });
}

function _inflateSharedDamage(shared) {
  return _inflateSharedDamageImpl(shared);
}

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
    try {
      if (!message) return;

      const opposed = message?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
      if (!opposed) return;
      if (!_isBankChoicesEnabledForData(opposed)) return;

      const data = foundry.utils.deepClone(opposed);
      _ensureBankedScaffold(data);

      // Only proceed when a roll has been requested and has not started.
      if (!data?.context?.autoRollRequested) return;
      if (data?.context?.autoRollStarted) return;

      const defenders = _getDefenderEntries(data);
      // For banking: require ALL defenders to be committed before rolling
      const allCommitted = _allDefendersCommitted(data);
      if (!allCommitted) return;

      // Only the active GM should run the auto-roll.
      if (!_anyActiveGMOnline()) return;
      const activeGM = game.users.activeGM ?? null;
      if (activeGM && game.user.id !== activeGM.id) return;
      if (!game.user.isGM) return;

      await this._autoRollBanked(message.id, { trigger: "hook" });
    } catch (err) {
      console.error("UESRPG | maybeAutoRollBanked failed", err);
    }
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
