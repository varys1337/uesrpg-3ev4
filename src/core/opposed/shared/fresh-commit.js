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
 * Target: Foundry VTT v13.351
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
 * @param {Function}    opts.updateCard   - (freshMessage, state) => Promise.
 *   Persists the mutated state via the workflow's card updater.
 * @param {object|null} [opts.fallbackData=null]
 *   Handler's stale data to use as base when no live state exists yet
 *   (e.g. first write to a brand-new card). Prevents empty-object writes.
 * @returns {Promise<{ freshMessage: ChatMessage, state: object }>}
 */
export async function commitLaneToFreshCardState({ message, readState, mutate, updateCard, fallbackData = null }) {
  const freshMessage = game.messages.get(message?.id ?? message?._id) ?? message;
  const liveState = readState(freshMessage);
  const state = liveState ?? fallbackData ?? {};
  mutate(state);
  await updateCard(freshMessage, state);
  return { freshMessage, state };
}
