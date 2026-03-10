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
import { cloneFlagState } from "../../../utils/clone.js";
import { perfStart, perfEnd } from "../../../utils/debug.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { createMessageQueue } from "../../opposed/shared/message-queue.js";

const _FLAG_NS = FLAG_SCOPE;
const _FLAG_KEY = "magicOpposed";
const _CARD_VERSION = 2;

const _enqueueCardUpdate = createMessageQueue();

/**
 * Prune stale null/false values from a handler's lane data that would incorrectly
 * overwrite already-committed state in the current live state.
 *
 * Stale-write hazard: a handler clones flags at dispatch time (before an async
 * dialog/roll). Another lane commits during that window. The handler's stale clone
 * still carries null/false for fields the live state has since committed.
 * mergeObject(freshState, staleData, {overwrite:true}) would clobber them.
 * This guard covers declaration, banked commit markers, TN, identity, and result
 * fields — not just result (the previous narrow protection).
 *
 * Strategy: for each protected field, if freshLane has a meaningful value and
 * dataLane has an explicit null sentinel (carried from initial clone), delete the
 * field from dataLane before the merge so mergeObject skips the overwrite.
 *
 * @param {Object} freshLane - Live lane state (attacker or a defender entry).
 * @param {Object} dataLane  - Handler's stale lane data (mutated in place).
 */
function _pruneStaleOverwritesForLane(freshLane, dataLane) {
  if (!freshLane || !dataLane) return;

  // Object fields: live non-null → data null → prune.
  for (const f of ["result", "tn", "declaration", "banked", "request", "castSource"]) {
    if (freshLane[f] != null && dataLane[f] === null) delete dataLane[f];
  }

  // Boolean commit markers: live true → data falsy → prune (don't revert committed state).
  for (const f of ["hasDeclared", "declared"]) {
    if (freshLane[f] === true && dataLane[f] != null && !dataLane[f]) delete dataLane[f];
  }

  // Nested banked sub-fields: protect individual commit markers inside the banked object.
  if (freshLane.banked && dataLane.banked && typeof dataLane.banked === "object") {
    if (freshLane.banked.committed === true && dataLane.banked.committed === false) {
      delete dataLane.banked.committed;
    }
    if (freshLane.banked.committedAt != null && dataLane.banked.committedAt === null) {
      delete dataLane.banked.committedAt;
    }
    if (freshLane.banked.committedBy != null && dataLane.banked.committedBy === null) {
      delete dataLane.banked.committedBy;
    }
  }

  // String identity fields: live non-null → data null → prune.
  for (const f of [
    "itemUuid", "spellUuid", "defenseType", "styleUuid", "skillUuid",
    "label", "defenseLabel", "testLabel", "variantLabel", "circumstanceLabel", "targetLabel",
    "variant", "rollMessageId"
  ]) {
    if (freshLane[f] != null && dataLane[f] === null) delete dataLane[f];
  }

  // Numeric committed fields: live finite → data null → prune.
  for (const f of ["target", "baseTarget", "totalMod", "variantMod", "manualMod", "circumstanceMod"]) {
    if (Number.isFinite(freshLane[f]) && dataLane[f] === null) delete dataLane[f];
  }
}

/**
 * Apply lane-aware stale-overwrite pruning to all lanes in the handler's payload.
 * Covers attacker, defender alias, and each defenders[] entry.
 * Modifies data in place before mergeObject.
 * @param {Object} freshState - Current live full state.
 * @param {Object} data       - Handler's payload (mutated in place).
 */
function _pruneStaleOverwrites(freshState, data) {
  if (freshState.attacker && data.attacker) {
    _pruneStaleOverwritesForLane(freshState.attacker, data.attacker);
  }
  if (freshState.defender && data.defender) {
    _pruneStaleOverwritesForLane(freshState.defender, data.defender);
  }
  if (Array.isArray(freshState.defenders) && Array.isArray(data.defenders)) {
    for (let i = 0; i < data.defenders.length; i++) {
      if (freshState.defenders[i] && data.defenders[i]) {
        _pruneStaleOverwritesForLane(freshState.defenders[i], data.defenders[i]);
      }
    }
  }
  // Shared context: protect auto-resolution markers from stale erasure.
  if (freshState.context && data.context) {
    const fc = freshState.context;
    const dc = data.context;
    for (const f of ["autoRollRequested", "noDefense"]) {
      if (fc[f] === true && (dc[f] === false || dc[f] === null)) delete dc[f];
    }
    for (const f of ["autoRollRequestedAt", "autoRollRequestedBy"]) {
      if (fc[f] != null && dc[f] === null) delete dc[f];
    }
  }
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
    const freshState = cloneFlagState(liveState);

    // Lane-aware stale-overwrite protection: prevent a handler's stale null/false
    // clone from clobbering already-committed live state. Covers declaration, banked
    // commit markers, TN, identity, result, and shared context markers — not just
    // result (the former narrow guard). See _pruneStaleOverwritesForLane for details.
    _pruneStaleOverwrites(freshState, data);

    // Merge handler's mutations on top of live state (additive).
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

  // Touch context for diagnostics.
  merged.context = merged.context ?? {};
  merged.context.schemaVersion = merged.context.schemaVersion ?? _CARD_VERSION;
  merged.context.updatedAt = Date.now();
  merged.context.updatedBy = game.user.id;
  // Bump seq from the LIVE state's value to ensure unique ordering even with concurrent writes.
  const liveSeq = Number(liveState?.context?.updatedSeq ?? 0);
  const handlerSeq = Number(data?.context?.updatedSeq ?? 0);
  merged.context.updatedSeq = Math.max(liveSeq, handlerSeq) + 1;

  const msgId = message?.id ?? message?._id ?? "unknown";
  const renderLabel = `card.update.render:magic:${msgId}`;
  perfStart(renderLabel);
  const content = _renderCard(merged, message.id);
  perfEnd(renderLabel);

  const payload = {
    content,
    flags: { [_FLAG_NS]: { [_FLAG_KEY]: { version: _CARD_VERSION, state: merged } } }
  };

  // Permission-safe update: defenders (non-message-authors) cannot update ChatMessage directly.
  // If lacking permission, ask the active GM to apply the update via socket.
  const persistLabel = `card.update.persist:magic:${msgId}`;
  perfStart(persistLabel);
  await safeUpdateChatMessage(message, payload);
  perfEnd(persistLabel);
}
