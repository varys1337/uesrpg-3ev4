/**
 * src/core/combat/opposed/cards/updater.js
 * Permission-safe card update functions for opposed combat workflows.
 * Extracted from opposed-workflow.js for maintainability.
 * 
 * This module is the SINGLE SOURCE OF TRUTH for card persistence.
 * All card mutations must route through these functions to ensure
 * proper permission handling in multi-user environments.
 */

import { safeUpdateChatMessage } from "../../../../utils/chat-message-socket.js";
import { cloneFlagState } from "../../../../utils/clone.js";

/* ────────────────────────────────────────────────────────────────────────
 * Per-message async mutex.
 *
 * Banking mode dispatches attacker + defender rolls via Promise.allSettled,
 * so both handlers call updateCard concurrently.  Without serialization the
 * merge-on-write pattern breaks: both callers read the same stale
 * message.flags snapshot, merge their lane changes on top, and the second
 * message.update() to complete overwrites the first (classic lost-update).
 *
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
 * Update opposed combat card with new data.
 * 
 * This is the primary card update function. It:
 * - Serializes concurrent writes to the same card via a per-message queue
 * - Touches diagnostic metadata (schemaVersion, updatedAt, updatedBy, updatedSeq)
 * - Renders the card content
 * - Persists to ChatMessage via permission-safe helper
 * 
 * @param {ChatMessage} message - The chat message to update.
 * @param {Object} data - The opposed workflow data object.
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
  const liveRaw = message?.flags?.["uesrpg-3ev4"]?.opposed;
  let merged;
  if (liveRaw && typeof liveRaw === "object") {
    const freshState = cloneFlagState(liveRaw);

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

    // Merge handler's mutations on top of live state (additive — all handlers use property sets, no deletions).
    merged = foundry.utils.mergeObject(freshState, data, { overwrite: true, insertKeys: true, insertValues: true });
  } else {
    merged = data;
  }

  // Touch context for diagnostics
  merged.context = merged.context ?? {};
  merged.context.schemaVersion = merged.context.schemaVersion ?? 1;
  merged.context.updatedAt = Date.now();
  merged.context.updatedBy = game.user.id;
  // Bump seq from the LIVE state's value to ensure unique ordering even with concurrent writes.
  const liveSeq = Number(liveRaw?.context?.updatedSeq ?? 0);
  const handlerSeq = Number(data?.context?.updatedSeq ?? 0);
  merged.context.updatedSeq = Math.max(liveSeq, handlerSeq) + 1;

  const payload = {
    content: _renderCard(merged, message.id),
    flags: { "uesrpg-3ev4": { opposed: merged } }
  };

  // Permission-safe update: defenders (non-message-authors) cannot update ChatMessage directly.
  // If lacking permission, ask the active GM to apply the update via socket.
  await safeUpdateChatMessage(message, payload);
}

/**
 * Get the author user for a chat message.
 * 
 * Handles various data structures (v12 vs v13 ChatMessage schemas).
 * 
 * @param {ChatMessage} msg - The chat message.
 * @returns {User|null} - The author User object or null.
 */
export function getChatMessageAuthorUser(msg) {
  const authorId =
    msg?.author?.id ??
    msg?._source?.author ??
    msg?._source?.user ??
    msg?.data?.author ??
    msg?.data?.user ??
    null;
  return authorId ? (game.users.get(String(authorId)) ?? null) : null;
}

/**
 * Apply defender commit data to workflow data.
 * 
 * Mutates `data.defender` in place with commit properties.
 * 
 * @param {Object} data - Opposed workflow data object.
 * @param {Object} commit - Commit data from defender.
 * @returns {boolean} - True if data was modified.
 */
export function applyDefenderCommitToData(data, commit) {
  if (!commit || typeof commit !== "object") return false;
  data.defender = data.defender ?? {};
  let dirty = false;
  if (commit.defenseType != null) {
    data.defender.defenseType = String(commit.defenseType);
    dirty = true;
  }
  if (Object.prototype.hasOwnProperty.call(commit, "styleUuid")) {
    data.defender.styleUuid = commit.styleUuid ? String(commit.styleUuid) : null;
    dirty = true;
  }
  if (commit.label != null) {
    data.defender.label = String(commit.label);
    dirty = true;
  }
  if (commit.defenseLabel != null) {
    data.defender.defenseLabel = String(commit.defenseLabel);
    dirty = true;
  }
  if (commit.testLabel != null) {
    data.defender.testLabel = String(commit.testLabel);
    dirty = true;
  }
  if (commit.target != null && Number.isFinite(Number(commit.target))) {
    data.defender.target = Number(commit.target);
    dirty = true;
  }
  if (commit.targetLabel != null) {
    data.defender.targetLabel = String(commit.targetLabel);
    dirty = true;
  }
  if (commit.tn && typeof commit.tn === "object") {
    data.defender.tn = foundry.utils.deepClone(commit.tn);
    dirty = true;
  }
  return dirty;
}

/**
 * Apply attacker commit data to workflow data.
 * 
 * Mutates `data.attacker` in place with commit properties.
 * 
 * @param {Object} data - Opposed workflow data object.
 * @param {Object} commit - Commit data from attacker.
 * @returns {boolean} - True if data was modified.
 */
export function applyAttackerCommitToData(data, commit) {
  if (!commit || typeof commit !== "object") return false;
  data.attacker = data.attacker ?? {};
  let dirty = false;
  if (commit.hasDeclared != null) {
    data.attacker.hasDeclared = Boolean(commit.hasDeclared);
    dirty = true;
  }
  if (commit.itemUuid != null) {
    data.attacker.itemUuid = String(commit.itemUuid);
    dirty = true;
  }
  if (commit.label != null) {
    data.attacker.label = String(commit.label);
    dirty = true;
  }
  if (commit.variant != null) {
    data.attacker.variant = String(commit.variant);
    dirty = true;
  }
  if (commit.variantLabel != null) {
    data.attacker.variantLabel = String(commit.variantLabel);
    dirty = true;
  }
  if (commit.variantMod != null && Number.isFinite(Number(commit.variantMod))) {
    data.attacker.variantMod = Number(commit.variantMod);
    dirty = true;
  }
  if (commit.manualMod != null && Number.isFinite(Number(commit.manualMod))) {
    data.attacker.manualMod = Number(commit.manualMod);
    dirty = true;
  }
  if (commit.circumstanceMod != null && Number.isFinite(Number(commit.circumstanceMod))) {
    data.attacker.circumstanceMod = Number(commit.circumstanceMod);
    dirty = true;
  }
  if (commit.circumstanceLabel != null) {
    data.attacker.circumstanceLabel = String(commit.circumstanceLabel);
    dirty = true;
  }
  if (commit.totalMod != null && Number.isFinite(Number(commit.totalMod))) {
    data.attacker.totalMod = Number(commit.totalMod);
    dirty = true;
  }
  if (commit.baseTarget != null && Number.isFinite(Number(commit.baseTarget))) {
    data.attacker.baseTarget = Number(commit.baseTarget);
    dirty = true;
  }
  if (commit.target != null && Number.isFinite(Number(commit.target))) {
    data.attacker.target = Number(commit.target);
    dirty = true;
  }
  if (commit.tn && typeof commit.tn === "object") {
    data.attacker.tn = foundry.utils.deepClone(commit.tn);
    dirty = true;
  }
  if (commit.pendingApCost != null && Number.isFinite(Number(commit.pendingApCost))) {
    data.attacker.pendingApCost = Number(commit.pendingApCost);
    dirty = true;
  }
  return dirty;
}
