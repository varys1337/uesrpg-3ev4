/**
 * src/core/combat/opposed/banking/orchestrator.js
 * Banking workflow orchestration for opposed combat.
 * Extracted from opposed-workflow.js for maintainability.
 * 
 * This module handles auto-roll triggers when both sides commit in banking mode.
 * It was previously extracted in Phase 7 but had to be rolled back due to circular
 * dependencies with _updateCard. Now that card-updater.js exists (Phase 8), we can
 * safely extract this orchestration layer.
 */

import {
  _bankedAutoRollLocalLocks,
  _isBankChoicesEnabledForData,
  _ensureBankedScaffold,
  _getDefenderEntries,
  _allDefendersCommitted,
  _getBankCommitState,
  _cleanupAutoRollContext,
  _anyActiveGMOnline
} from "./state.js";
import { verifyAutoRollClaim } from "../../../opposed/shared/auto-roll-claim.js";
import { perfStart, perfEnd } from "../../../../utils/debug.js";

import { _getDefenderOutcome, _setDefenderOutcome, _setDefenderAdvantage } from "../schema.js";
import { resolveOutcomeRAW, computeAdvantageRAW } from "../outcome-resolution.js";
import { applyAoEEvadeOutcome } from "../helpers/workflow.js";
import { markPendingSneakAttack } from "../effects.js";
import { resolveActorFromUuidSync } from "../../../../utils/uuid-cache.js";

/**
 * Auto-roll banking workflow when both sides commit (GM orchestration).
 * 
 * This is called via updateOpposedMessage hook when a card is updated.
 * Only runs if:
 * - Banking mode enabled
 * - Auto-roll requested but not started
 * - All defenders committed
 * - Active GM is online and is the current user
 * 
 * @param {ChatMessage} message - The opposed test chat message.
 * @param {Object} workflow - The workflow instance (for calling _autoRollBanked).
 * @returns {Promise<void>}
 */
export async function maybeAutoRollBanked(message, workflow) {
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

    await autoRollBanked(message.id, { trigger: "hook" }, workflow);
  } catch (err) {
    console.error("UESRPG | maybeAutoRollBanked failed", err);
  }
}

/**
 * Banked-choice auto roll helper for non-GM scenarios.
 *
 * If no active GM is online, each participant auto-rolls their own committed lane once
 * both sides have committed. Parent-card updates are still applied by the message author
 * (via Authority Proxy), so the workflow completes deterministically without a manual
 * "Roll (GM)" confirmation.
 * 
 * @param {ChatMessage} message - The opposed test chat message.
 * @param {Object} workflow - The workflow instance (for calling handleAction).
 * @param {Function} _updateCard - Card update function (injected dependency).
 * @returns {Promise<void>}
 */
export async function maybeAutoRollBankedNoGM(message, workflow, _updateCard) {
  try {
    if (!message) return;

    const opposed = message?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
    if (!opposed) return;
    if (!_isBankChoicesEnabledForData(opposed)) return;

    // If any active GM is online, the GM is the canonical runner.
    if (_anyActiveGMOnline()) return;

    const data = foundry.utils.deepClone(opposed);
    _ensureBankedScaffold(data);

    const defenders = _getDefenderEntries(data);
    // For banking: require ALL defenders to be committed before rolling
    const allCommitted = _allDefendersCommitted(data);
    if (!allCommitted) return;

    data.context = data.context ?? {};
    if (!data.context.autoRollRequested) {
      // Compatibility: older cards may not set this in commit handlers.
      data.context.autoRollRequested = true;
      data.context.autoRollRequestedAt = Date.now();
      data.context.autoRollRequestedBy = game.user.id;
      await _updateCard(message, data);
    }

    const userId = game.user?.id ?? null;
    if (!userId) return;

    // Roll lanes SEQUENTIALLY — parallel dispatch is unsafe (see autoRollBanked).

    // Attacker lane: only the committing user should auto-roll.
    if (!data.attacker?.result && data.attacker?.banked?.committed === true && data.attacker?.banked?.committedBy === userId) {
      const t = Number(data.attacker?.target ?? data.attacker?.tn?.finalTN ?? NaN);
      if (Number.isFinite(t)) {
        const committedIdx = defenders.findIndex(def => _getBankCommitState(data, def).bothCommitted);
        const idx = committedIdx >= 0 ? committedIdx : 0;
        await workflow.handleAction(message, "attacker-roll-committed", { defenderIndex: idx });
      }
    }

    // Defender lanes: only the committing user should auto-roll, and only if this is not No Defense.
    for (let idx = 0; idx < defenders.length; idx += 1) {
      const def = defenders[idx];
      if (!def || def.result || def.noDefense === true) continue;
      if (def?.banked?.committed !== true || def?.banked?.committedBy !== userId) continue;
      const dt = String(def?.defenseType ?? "");
      if (!dt || dt === "none") continue;
      const t = Number(def?.target ?? def?.tn?.finalTN ?? NaN);
      if (Number.isFinite(t)) {
        await workflow.handleAction(message, "defender-roll-committed", { defenderIndex: idx });
      }
    }

    // After all rolls complete, resolve outcomes on the fresh card state.
    await _resolveOutcomesAfterRolls(message, _updateCard);
  } catch (err) {
    console.error("UESRPG | maybeAutoRollBankedNoGM failed", err);
  }
}

/**
 * Begin rolling a banked-choice opposed test once both sides have committed.
 * This will roll any unresolved lanes without prompting for additional choices.
 *
 * Safeguards:
 *  - Local lock prevents same-client re-entrancy (e.g. commit-path + update hook).
 *  - Claim-id prevents cross-caller duplication if two runners attempt to start simultaneously.
 * 
 * @param {string} parentMessageId - The chat message ID.
 * @param {Object} options - Options object.
 * @param {string} options.trigger - Trigger source ("auto", "hook", etc.).
 * @param {Object} workflow - The workflow instance (for calling handleAction).
 * @param {Function} _updateCard - Card update function (injected dependency).
 * @returns {Promise<void>}
 */
export async function autoRollBanked(parentMessageId, { trigger = "auto" } = {}, workflow, _updateCard) {
  const message = game.messages.get(parentMessageId) ?? null;
  if (!message) return;

  // Same-client re-entrancy guard.
  if (_bankedAutoRollLocalLocks.has(parentMessageId)) return;
  _bankedAutoRollLocalLocks.add(parentMessageId);

  try {
    const opposed = message?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
    if (!opposed) return;
    if (!_isBankChoicesEnabledForData(opposed)) return;

    const data = foundry.utils.deepClone(opposed);
    _ensureBankedScaffold(data);

    const defenders = _getDefenderEntries(data);
    // For banking: require ALL defenders to be committed before rolling
    const allCommitted = _allDefendersCommitted(data);
    if (!allCommitted) return;

    data.context = data.context ?? {};
    if (data.context.autoRollStarted) return;

    // Claim this auto-roll run. If another caller claims after us, we will abort.
    const claimId = foundry.utils.randomID();
    data.context.autoRollClaimId = claimId;
    data.context.autoRollStarted = true;
    data.context.autoRollStartedAt = Date.now();
    data.context.autoRollStartedBy = game.user.id;
    data.context.autoRollStartedTrigger = String(trigger ?? "auto");

    if (!data.context.autoRollRequested) {
      data.context.autoRollRequested = true;
      data.context.autoRollRequestedAt = Date.now();
      data.context.autoRollRequestedBy = game.user.id;
    }

    const claimLabel = `banked.claim.write:combat:${parentMessageId}`;
    perfStart(claimLabel);
    await _updateCard(message, data);
    perfEnd(claimLabel);

    // Verify we still own the claim after the persisted update.
    // (If another runner wrote a different claimId, they are the canonical runner.)
    const fresh = game.messages.get(parentMessageId) ?? message;
    const freshOpposed = fresh?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
    if (!verifyAutoRollClaim(freshOpposed?.context, claimId)) return;

    // Roll lanes SEQUENTIALLY — parallel dispatch is unsafe because each
    // handler clones the full card state; mergeObject then overwrites ALL
    // fields from the stale clone (status, banked, etc.), not just result.
    // The null-overwrite guard only covers `result`; sequential dispatch is
    // the only reliable way to prevent cross-lane clobbering.
    const freshDefenders = _getDefenderEntries(freshOpposed);
    let workingData = foundry.utils.deepClone(freshOpposed);

    // Attacker lane first.
    const committedIdx = freshDefenders.findIndex(def => _getBankCommitState(freshOpposed, def).bothCommitted);
    if (!freshOpposed?.attacker?.result && committedIdx >= 0) {
      const attackerLabel = `banked.attacker.roll:combat:${parentMessageId}`;
      perfStart(attackerLabel);
      const next = await workflow.handleAction(fresh, "attacker-roll-committed", {
        defenderIndex: committedIdx,
        batchedUpdate: true,
        dataOverride: workingData
      });
      if (next && typeof next === "object") workingData = next;
      perfEnd(attackerLabel);
    }

    // Defender lanes in order.
    for (let idx = 0; idx < freshDefenders.length; idx += 1) {
      const def = freshDefenders[idx];
      if (!def || def.result || def.noDefense === true) continue;
      const bankState = _getBankCommitState(freshOpposed, def);
      if (!bankState.bothCommitted) continue;
      const defenderLabel = `banked.defender.roll:combat:${parentMessageId}:${idx}`;
      perfStart(defenderLabel);
      const next = await workflow.handleAction(fresh, "defender-roll-committed", {
        defenderIndex: idx,
        batchedUpdate: true,
        dataOverride: workingData
      });
      if (next && typeof next === "object") workingData = next;
      perfEnd(defenderLabel);
    }

    // After all rolls complete, resolve outcomes in-memory and persist once.
    const resolveLabel = `banked.resolve:combat:${parentMessageId}`;
    perfStart(resolveLabel);
    const resolved = await _resolveOutcomesAfterRolls(fresh, _updateCard, workingData, { persist: false });
    if (resolved && typeof resolved === "object") workingData = resolved;
    perfEnd(resolveLabel);

    const finalLabel = `banked.final.write:combat:${parentMessageId}`;
    perfStart(finalLabel);
    await _updateCard(fresh, workingData);
    perfEnd(finalLabel);
  } finally {
    _bankedAutoRollLocalLocks.delete(parentMessageId);
  }
}

/**
 * Read fresh card state and resolve outcomes for any defender lanes that have
 * both attacker and defender results but no outcome yet.
 * 
 * This is the single source of truth for post-roll outcome resolution in
 * the banking workflow. Runs after all roll handlers have written their
 * results to the card via _updateCard.
 *
 * @param {ChatMessage} message - The opposed card chat message.
 * @param {Function} _updateCard - Card update function (injected dependency).
 * @returns {Promise<void>}
 * @private
 */
async function _resolveOutcomesAfterRolls(message, _updateCard, dataOverride = null, { persist = true } = {}) {
  try {
    const messageId = message?.id ?? message?._id ?? null;
    const live = messageId ? (game.messages.get(messageId) ?? message) : message;
    const opposed = (dataOverride && typeof dataOverride === "object")
      ? dataOverride
      : (live?.flags?.["uesrpg-3ev4"]?.opposed ?? null);
    if (!opposed) return;

    const data = foundry.utils.deepClone(opposed);
    if (!data.attacker?.result) return;

    const defenders = _getDefenderEntries(data);
    if (!defenders.length) return;

    let dirty = false;

    for (const def of defenders) {
      if (!def) continue;
      if (!(def.result || def.noDefense)) continue;
      if (_getDefenderOutcome(data, def)) continue;

      // Temporarily set data.defender to the current entry for resolveOutcomeRAW
      const savedDefender = data.defender;
      data.defender = def;

      const baseOutcome = resolveOutcomeRAW(data, def) ?? { winner: "tie", text: "" };
      const outcome = applyAoEEvadeOutcome(data, baseOutcome, def);
      _setDefenderOutcome(data, def, outcome);
      _setDefenderAdvantage(data, def, computeAdvantageRAW(data, outcome, def));

      // Sneak attack marking (Hidden → attacker wins)
      if (data.context?.attackFromHidden === true && outcome?.winner === "attacker") {
        try {
          const actor = resolveActorFromUuidSync(def.actorUuid);
          if (actor) {
            await markPendingSneakAttack(actor, {
              weaponUuid: data.context?.weaponUuid ?? null,
              attackMode: data.context?.attackMode ?? null
            });
          }
        } catch (err) {
          console.warn("UESRPG | Post-roll sneak attack marking failed", err);
        }
      }

      data.defender = savedDefender;
      dirty = true;
    }

    if (!dirty) return data;

    // Check if all defenders are resolved.
    const allResolved = defenders.every(def => Boolean(_getDefenderOutcome(data, def)));
    if (allResolved) {
      data.status = "resolved";
      data.context = data.context ?? {};
      data.context.phase = "resolved";
      if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
      _cleanupAutoRollContext(data.context);
    }

    if (persist) await _updateCard(live, data);
    return data;
  } catch (err) {
    console.error("UESRPG | _resolveOutcomesAfterRolls failed", err);
  }
}
