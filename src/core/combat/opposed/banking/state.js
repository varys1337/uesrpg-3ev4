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
 * 
 * @param {Object} ctx - Context object (data.context).
 */
export function _cleanupAutoRollContext(ctx) {
  ctx.autoRollRequested = false;
  ctx.autoRollRequestedAt = null;
  ctx.autoRollRequestedBy = null;
  ctx.autoRollStarted = false;
  ctx.autoRollStartedAt = null;
  ctx.autoRollStartedBy = null;
  ctx.autoRollStartedTrigger = null;
  ctx.autoRollClaimId = null;
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
