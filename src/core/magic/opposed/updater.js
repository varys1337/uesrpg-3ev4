/**
 * src/core/magic/opposed/updater.js
 *
 * Centralized card-update function for magic opposed workflows.
 * Mirrors the combat updater pattern (src/core/combat/opposed/cards/updater.js).
 *
 * This module is the SINGLE SOURCE OF TRUTH for magic opposed card persistence.
 * All card mutations must route through updateCard() to ensure:
 *  - Proper null-overwrite protection (defense-in-depth)
 *  - Per-message serialization (prevents lost-update races)
 *  - Consistent diagnostic metadata
 *
 * Target: Foundry VTT v13.351
 */

import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";

const _FLAG_NS = "uesrpg-3ev4";
const _FLAG_KEY = "magicOpposed";
const _CARD_VERSION = 2;

/* ────────────────────────────────────────────────────────────────────────
 * Per-message async mutex.
 *
 * Banking mode dispatches rolls sequentially, but outcome resolution
 * and card updates can still overlap if hooks fire mid-flight.
 * The mutex ensures that at most one updateCard call per messageId is
 * in-flight.  The second caller waits until the first completes, then
 * reads the freshly-updated flags and merges correctly.
 * ──────────────────────────────────────────────────────────────────────── */

/** @type {Map<string, Promise<void>>} */
const _cardUpdateQueues = new Map();

/**
 * Enqueue `fn` behind any pending updateCard call for the same message.
 * Returns the result of `fn()`.
 * @param {string} messageId
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
function _enqueueCardUpdate(messageId, fn) {
  const prev = _cardUpdateQueues.get(messageId) ?? Promise.resolve();
  // Chain: wait for previous write, then run ours.  Swallow errors from
  // earlier writes so they don't block subsequent ones.
  const next = prev.catch(() => {}).then(fn);
  _cardUpdateQueues.set(messageId, next);
  // Clean up once the full chain for this id settles (avoid memory leak).
  next.finally(() => {
    if (_cardUpdateQueues.get(messageId) === next) _cardUpdateQueues.delete(messageId);
  });
  return next;
}

/**
 * Update magic opposed card with new data.
 *
 * This is the primary card update function. It:
 * - Serializes concurrent writes to the same card via a per-message queue
 * - Applies null-overwrite protection (defense-in-depth)
 * - Touches diagnostic metadata (schemaVersion, updatedAt, updatedBy, updatedSeq)
 * - Renders the card content
 * - Persists to ChatMessage via permission-safe helper
 *
 * @param {ChatMessage} message - The chat message to update.
 * @param {Object} data - The magic opposed workflow data object.
 * @param {Function} _renderCard - Card rendering function (injected dependency).
 * @returns {Promise<void>}
 */
export async function updateCard(message, data, _renderCard) {
  const messageId = message?.id ?? message?._id ?? "";
  if (!messageId) {
    // Fallback: no id available, run unserialized (should never happen).
    return _updateCardCore(message, data, _renderCard);
  }
  return _enqueueCardUpdate(messageId, () => _updateCardCore(message, data, _renderCard));
}

/**
 * Internal card-update implementation (runs inside the per-message queue).
 * @private
 */
async function _updateCardCore(message, data, _renderCard) {
  // Re-read live state from the message to prevent concurrent overwrites.
  // Handlers clone state at dispatch time, mutate their fields, then call this function.
  // If another user committed in the meantime, the clone is stale.
  // By merging the handler's mutations onto the current live state, we preserve
  // fields that this handler didn't touch (e.g. the other side's commit).
  const liveRaw = message?.flags?.[_FLAG_NS]?.[_FLAG_KEY];
  const liveState = (liveRaw && typeof liveRaw === "object" && liveRaw.state) ? liveRaw.state : null;
  let merged;

  if (liveState && typeof liveState === "object") {
    const freshState = JSON.parse(JSON.stringify(liveState));

    // Defense-in-depth: prevent handler's stale clone from overwriting results
    // that another handler has already written to the live state.
    // When a handler clones flags early and doesn't touch `result`, its clone
    // still contains `result: null` which mergeObject would apply on top of the
    // live state's non-null result. Prune these stale nulls before merging.
    if (freshState.attacker?.result && data.attacker?.result === null) {
      delete data.attacker.result;
    }
    if (Array.isArray(freshState.defenders) && Array.isArray(data.defenders)) {
      for (let i = 0; i < data.defenders.length; i++) {
        if (freshState.defenders[i]?.result && data.defenders?.[i]?.result === null) {
          delete data.defenders[i].result;
        }
      }
    }
    if (freshState.defender?.result && data.defender?.result === null) {
      delete data.defender.result;
    }

    // Merge handler's mutations on top of live state (additive).
    merged = foundry.utils.mergeObject(freshState, data, { overwrite: true, insertKeys: true, insertValues: true });
  } else {
    merged = data;
  }

  // Touch context for diagnostics.
  merged.context = merged.context ?? {};
  merged.context.schemaVersion = merged.context.schemaVersion ?? _CARD_VERSION;
  merged.context.updatedAt = Date.now();
  merged.context.updatedBy = game.user.id;
  // Bump seq from the LIVE state's value to ensure unique ordering even with concurrent writes.
  const liveSeq = Number(liveState?.context?.updatedSeq ?? 0);
  const handlerSeq = Number(data?.context?.updatedSeq ?? 0);
  merged.context.updatedSeq = Math.max(liveSeq, handlerSeq) + 1;

  const payload = {
    content: _renderCard(merged, message.id),
    flags: { [_FLAG_NS]: { [_FLAG_KEY]: { version: _CARD_VERSION, state: merged } } }
  };

  // Permission-safe update: defenders (non-message-authors) cannot update ChatMessage directly.
  // If lacking permission, ask the active GM to apply the update via socket.
  await safeUpdateChatMessage(message, payload);
}
