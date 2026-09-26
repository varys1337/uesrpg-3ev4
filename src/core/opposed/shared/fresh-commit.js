/**
 * src/core/opposed/shared/fresh-commit.js
 *
 * Shared helper for applying a partial lane mutation to the current live
 * chat message state before persisting through a workflow card updater.
 *
 * Invariant: all partial lane commits must apply to fresh message state,
 * never a stale snapshot captured before another client wrote to the message.
 *
 * Used by: combat/magic/skills opposed attacker and defender commit handlers.
 *
 * Target: Foundry VTT v14.368+
 */

/**
 * Re-read the current live message state, apply a lane mutation, and persist.
 *
 * @param {object}      opts
 * @param {ChatMessage} opts.message      - Original message (used for id lookup).
 * @param {Function}    opts.readState    - (freshMessage) => state | null.
 *   Reads and clones workflow-specific flag state from the live message.
 *   Must return a mutable clone (e.g. via cloneFlagState), or null if absent.
 * @param {Function}    opts.mutate       - (state) => void.
 *   Applies the current lane's mutations to the resolved state in place.
 *   The return value is ignored; mutations must be applied directly to `state`.
 * @param {Function}    opts.updateCard   - (message, mutator) => Promise.
 *   Queues the mutator inside the workflow's card updater and returns its result.
 * @param {object|null} [opts.fallbackData=null]
 *   Handler's stale data to use as base when no live state exists yet
 *   (e.g. first write to a brand-new card). Prevents empty-object writes.
 * @returns {Promise<{ freshMessage: ChatMessage, state: object }>}
 */
export async function commitLaneToFreshCardState({ message, readState, mutate, updateCard, fallbackData = null }) {
  let committed;
  const result = await updateCard(message, async (_liveState, freshMessage) => {
    const state = readState(freshMessage) ?? foundry.utils.deepClone(fallbackData ?? {});
    await mutate(state);
    committed = { freshMessage, state };
    return state;
  });
  if (result?.state) committed.state = result.state;
  return committed;
}
