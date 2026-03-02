/**
 * src/core/skills/opposed/card-updater.js
 *
 * Centralized card-update function for skill opposed workflows.
 * Mirrors the combat/magic updater pattern with:
 *  - Per-message async mutex queue (prevents lost-update races)
 *  - Merge with live state (preserves concurrent handler writes)
 *  - Null-overwrite protection (defense-in-depth)
 *  - Consistent diagnostic metadata
 *
 * Target: Foundry VTT v13.351
 */

import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import { cloneFlagState } from "../../../utils/clone.js";
import { FLAG_NS, FLAG_KEY, CARD_VERSION } from "./constants.js";
import { _renderCard } from "./render.js";
import { perfStart, perfEnd } from "../../../utils/debug.js";

/* ────────────────────────────────────────────────────────────────────────
 * Per-message async mutex.
 *
 * Ensures that at most one _updateCard call per messageId is in-flight.
 * The second caller waits until the first completes, then reads the
 * freshly-updated flags and merges correctly.
 * ──────────────────────────────────────────────────────────────────────── */

/** @type {Map<string, Promise<void>>} */
const _cardUpdateQueues = new Map();

/**
 * Enqueue `fn` behind any pending _updateCard call for the same message.
 * @param {string} messageId
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
function _enqueueCardUpdate(messageId, fn) {
  const prev = _cardUpdateQueues.get(messageId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  _cardUpdateQueues.set(messageId, next);
  next.finally(() => {
    if (_cardUpdateQueues.get(messageId) === next) _cardUpdateQueues.delete(messageId);
  });
  return next;
}

/**
 * Update skill opposed card with new data.
 *
 * @param {ChatMessage} message - The chat message to update.
 * @param {Object} data - The skill opposed workflow data object.
 * @returns {Promise<void>}
 */
export async function _updateCard(message, data) {
  const messageId = message?.id ?? message?._id ?? "";
  if (!messageId) {
    return _updateCardCore(message, data);
  }
  return _enqueueCardUpdate(messageId, () => _updateCardCore(message, data));
}

/**
 * Internal card-update implementation (runs inside the per-message queue).
 * @private
 */
async function _updateCardCore(message, data) {
  // Re-read live state from the message to prevent concurrent overwrites.
  const liveRaw = message?.flags?.[FLAG_NS]?.[FLAG_KEY];
  const liveState = (liveRaw && typeof liveRaw === "object" && liveRaw.state) ? liveRaw.state : null;
  let merged;

  if (liveState && typeof liveState === "object") {
    const freshState = cloneFlagState(liveState);

    // Defense-in-depth: prevent handler's stale clone from overwriting results
    // that another handler has already written to the live state.
    if (freshState.attacker?.result && data.attacker?.result === null) {
      delete data.attacker.result;
    }
    if (freshState.defender?.result && data.defender?.result === null) {
      delete data.defender.result;
    }

    merged = foundry.utils.mergeObject(freshState, data, { overwrite: true, insertKeys: true, insertValues: true });
  } else {
    merged = data;
  }

  // No-op short-circuit: skip render/persist when the semantic card state is unchanged.
  try {
    const diff = foundry.utils.diffObject(liveState ?? {}, merged ?? {});
    if (!diff || Object.keys(diff).length === 0) return;
  } catch (_e) {
    // If diffObject fails, continue with normal persistence.
  }

  merged.context = merged.context ?? {};
  merged.context.schemaVersion = merged.context.schemaVersion ?? CARD_VERSION;
  merged.context.updatedAt = Date.now();
  merged.context.updatedBy = game.user.id;
  const liveSeq = Number(liveState?.context?.updatedSeq ?? 0);
  const handlerSeq = Number(data?.context?.updatedSeq ?? 0);
  merged.context.updatedSeq = Math.max(liveSeq, handlerSeq) + 1;

  const msgId = message?.id ?? message?._id ?? "unknown";
  const renderLabel = `card.update.render:skills:${msgId}`;
  perfStart(renderLabel);
  const content = _renderCard(merged, message.id);
  perfEnd(renderLabel);

  const payload = {
    content,
    flags: { [FLAG_NS]: { [FLAG_KEY]: { version: CARD_VERSION, state: merged } } }
  };

  const persistLabel = `card.update.persist:skills:${msgId}`;
  perfStart(persistLabel);
  await safeUpdateChatMessage(message, payload);
  perfEnd(persistLabel);
}
