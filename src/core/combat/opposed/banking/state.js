/**
 * @file src/core/combat/opposed/banking/state.js
 * Pure state management functions for banked-choice opposed tests.
 * 
 * This module contains ONLY pure/side-effect-free functions for managing
 * banking state. Auto-roll orchestration remains in opposed-workflow.js
 * to avoid circular dependencies with _updateCard and handleAction.
 * 
 * Separation rationale:
 * - Pure state queries/mutations are extracted (testable, reusable)
 * - Side-effectful orchestration stays in monolith (stable, proven)
 * - Enables future extraction once card rendering is modularized
 */

import { _anyActiveGMOnline } from "../helpers/util.js";
import { cleanupAutoRollContext as _cleanupAutoRollContextImpl } from "../../../opposed/shared/auto-roll-claim.js";

/**
 * Local lock set: prevents same-client re-entrancy during banked auto-roll.
 * Key: parent message ID.
 * 
 * Re-entrancy can occur when:
 * - Commit handler updates card -> triggers updateChatMessage hook -> maybeAutoRollBanked -> attempts _autoRollBanked
 * - Same commit path already running _autoRollBanked
 */
export const _bankedAutoRollLocalLocks = new Set();

/**
 * Cleanup auto-roll context flags after roll completion or cancellation.
 * Delegates to shared implementation in opposed/shared/auto-roll-claim.js.
 *
 * @param {Object} ctx - Context object (data.context).
 */
export function _cleanupAutoRollContext(ctx) {
  _cleanupAutoRollContextImpl(ctx);
}

/**
 * Check if banking mode is enabled for this opposed test.
 * 
 * @param {Object} data - Opposed test data object.
 * @returns {boolean} - True if banking is enabled.
 */
export function _isBankChoicesEnabledForData(data) {
  // Banking choices before rolling is core system behavior.
  // Retain the function signature for minimal-change compatibility with older chat cards.
  return true;
}

/**
 * Check if banked auto-roll has been requested or started.
 * While true, chat cards should suppress manual action buttons to avoid
 * transient flicker during the auto-resolution handoff window.
 *
 * @param {Object} data - Opposed test data object.
 * @returns {boolean} - True if bank auto-roll is in progress.
 */
export function _isBankAutoRollInProgress(data) {
  if (!_isBankChoicesEnabledForData(data)) return false;
  const ctx = data?.context ?? {};
  return ctx.autoRollRequested === true || ctx.autoRollStarted === true;
}

/**
 * Ensure banking scaffold exists on data object.
 * 
 * @param {Object} data - Opposed test data object (mutated).
 */
export function _ensureBankedScaffold(data) {
  data.context = data.context ?? {};
  data.attacker = data.attacker ?? {};
  data.attacker.banked = data.attacker.banked ?? {};
  if (!("committed" in data.attacker.banked)) data.attacker.banked.committed = false;
  if (!("committedAt" in data.attacker.banked)) data.attacker.banked.committedAt = null;
  if (!("committedBy" in data.attacker.banked)) data.attacker.banked.committedBy = null;

  const defenders = data.defenders ?? [];
  for (const def of defenders) {
    def.banked = def.banked ?? {};
    if (!("committed" in def.banked)) def.banked.committed = false;
    if (!("committedAt" in def.banked)) def.banked.committedAt = null;
    if (!("committedBy" in def.banked)) def.banked.committedBy = null;
  }
}

/**
 * Extract defender entries array from opposed test data.
 * 
 * @param {Object} data - Opposed test data object.
 * @returns {Array} - Defender entries array.
 */
export function _getDefenderEntries(data) {
  return data.defenders ?? [];
}

/**
 * Check if all defenders have committed their choices.
 * 
 * For single-defender tests: attacker + defender both committed.
 * For multi-defender tests: attacker + all defenders committed.
 * 
 * @param {Object} data - Opposed test data object.
 * @returns {boolean} - True if all sides committed.
 */
export function _allDefendersCommitted(data) {
  if (!data?.attacker?.banked?.committed) return false;
  const defenders = _getDefenderEntries(data);
  if (defenders.length === 0) return false;
  return defenders.every(def => {
    if (def.noDefense === true) return true;
    return Boolean(def?.banked?.committed);
  });
}

function _hasUnresolvedBankedLanes(data) {
  if (!data?.attacker?.result) return true;
  const defenders = _getDefenderEntries(data);
  return defenders.some(def => Boolean(def) && !def.result && def.noDefense !== true);
}

/**
 * Reconcile banked auto-roll request state from the current live card state.
 *
 * This helper is intentionally idempotent. It only sets a missing request flag
 * once every participant has committed and there is still work to roll. It never
 * clears request/start/claim metadata.
 *
 * @param {Object} data - Opposed test data object (mutated only at data.context).
 * @param {Object} [options]
 * @param {number} [options.now]
 * @param {string} [options.userId]
 * @returns {{eligible:boolean, requested:boolean, alreadyRequested:boolean, reason:string}}
 */
export function reconcileBankedAutoRollRequest(data, options = {}) {
  if (!data || typeof data !== "object") {
    return { eligible: false, requested: false, alreadyRequested: false, reason: "missing-data" };
  }
  if (!_isBankChoicesEnabledForData(data)) {
    return { eligible: false, requested: false, alreadyRequested: false, reason: "banking-disabled" };
  }

  data.context = data.context ?? {};
  const ctx = data.context;

  if (data.status === "resolved" || ctx.phase === "resolved") {
    return { eligible: false, requested: false, alreadyRequested: ctx.autoRollRequested === true, reason: "resolved" };
  }
  if (ctx.autoRollStarted === true) {
    return { eligible: false, requested: false, alreadyRequested: ctx.autoRollRequested === true, reason: "started" };
  }
  if (ctx.autoRollClaimId) {
    return { eligible: false, requested: false, alreadyRequested: ctx.autoRollRequested === true, reason: "claimed" };
  }

  if (!_allDefendersCommitted(data)) {
    return { eligible: false, requested: false, alreadyRequested: ctx.autoRollRequested === true, reason: "not-committed" };
  }
  if (!_hasUnresolvedBankedLanes(data)) {
    return { eligible: false, requested: false, alreadyRequested: ctx.autoRollRequested === true, reason: "fully-rolled" };
  }
  if (ctx.autoRollRequested === true) {
    return { eligible: true, requested: false, alreadyRequested: true, reason: "already-requested" };
  }

  ctx.autoRollRequested = true;
  ctx.autoRollRequestedAt = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  ctx.autoRollRequestedBy = String(options.userId ?? globalThis.game?.user?.id ?? "system");
  return { eligible: true, requested: true, alreadyRequested: false, reason: "requested" };
}

/**
 * Get commit state for a specific defender.
 * 
 * @param {Object} data - Opposed test data object.
 * @param {Object} def - Defender entry object.
 * @returns {Object} - { aCommitted, dCommitted, bothCommitted }.
 */
export function _getBankCommitState(data, def = null) {
  const aCommitted = Boolean(data?.attacker?.banked?.committed);
  if (!def) {
    // Legacy single-defender lane: use data.defender (first entry).
    const defenders = _getDefenderEntries(data);
    def = defenders[0] ?? null;
  }
  if (!def) return { aCommitted, dCommitted: false, bothCommitted: false };

  const dCommitted = def.noDefense === true || Boolean(def?.banked?.committed);
  return { aCommitted, dCommitted, bothCommitted: aCommitted && dCommitted };
}

// Re-export _anyActiveGMOnline from util.js for backward compatibility
export { _anyActiveGMOnline };
