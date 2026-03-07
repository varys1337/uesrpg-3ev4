/**
 * src/core/opposed/shared/auto-roll-claim.js
 *
 * Shared claim-ID helpers for banked auto-roll orchestration.
 *
 * All three opposed workflow families (combat, magic, skills) use an identical
 * claim-ID protocol to prevent duplicate auto-roll runs across concurrent clients:
 *
 *   1. Runner writes `autoRollStarted + autoRollClaimId` to the card.
 *   2. Runner re-reads fresh state and verifies it still owns the claim.
 *   3. If another runner claimed first, abort.
 *   4. On completion (or abort), optionally cleanup autoRoll* context fields.
 */

/**
 * Verify that this runner still owns the auto-roll claim after persisting it.
 *
 * Returns `true` (proceed) when:
 *   - No claimId was persisted (write may not have reached the server yet — still proceed).
 *   - The persisted claimId matches ours.
 * Returns `false` (abort) when another runner wrote a different claimId after us.
 *
 * @param {object|null|undefined} context - The `data.context` object from fresh card state.
 * @param {string} claimId - The claimId this runner wrote.
 * @returns {boolean}
 */
export function verifyAutoRollClaim(context, claimId) {
  const persisted = context?.autoRollClaimId ?? null;
  return !persisted || persisted === claimId;
}

/**
 * Clear all auto-roll tracking fields from a context object.
 * Called after the banked roll completes or is aborted.
 *
 * @param {object|null|undefined} context - The `data.context` object to clean up.
 */
export function cleanupAutoRollContext(context) {
  if (!context) return;
  context.autoRollRequested = false;
  context.autoRollRequestedAt = null;
  context.autoRollRequestedBy = null;
  context.autoRollStarted = false;
  context.autoRollStartedAt = null;
  context.autoRollStartedBy = null;
  context.autoRollStartedTrigger = null;
  context.autoRollClaimId = null;
}
