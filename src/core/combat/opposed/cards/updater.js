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
export { getChatMessageAuthorUser } from "../../../../utils/authority-proxy.js";
import { cloneFlagState } from "../../../../utils/clone.js";
import { perfStart, perfEnd } from "../../../../utils/debug.js";
import { createMessageQueue } from "../../../opposed/shared/message-queue.js";
import { reconcileBankedAutoRollRequest } from "../banking/state.js";

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
  for (const f of ["result", "tn", "declaration", "banked", "request"]) {
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
    "itemUuid", "defenseType", "blockSource", "styleUuid", "skillUuid",
    "label", "defenseLabel", "testLabel", "variantLabel", "circumstanceLabel", "targetLabel",
    "variant", "rollMessageId"
  ]) {
    if (freshLane[f] != null && dataLane[f] === null) delete dataLane[f];
  }

  // Numeric committed fields: live finite → data null → prune.
  for (const f of ["target", "baseTarget", "totalMod", "variantMod", "manualMod", "circumstanceMod", "pendingApCost"]) {
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
  const messageId = message?.id ?? message?._id ?? "";
  const liveMessage = (messageId ? (globalThis.game?.messages?.get?.(messageId) ?? null) : null) ?? message;

  // Re-read live state from the message to prevent concurrent overwrites.
  // Handlers clone state at dispatch time, mutate their fields, then call this function.
  // If another user committed in the meantime, the clone is stale.
  // By merging the handler's mutations onto the current live state, we preserve
  // fields that this handler didn't touch (e.g. the other side's commit).
  const liveRaw = liveMessage?.flags?.["uesrpg-3ev4"]?.opposed;
  let merged;
  if (liveRaw && typeof liveRaw === "object") {
    const freshState = cloneFlagState(liveRaw);

    // Lane-aware stale-overwrite protection: prevent a handler's stale null/false
    // clone from clobbering already-committed live state. Covers declaration, banked
    // commit markers, TN, identity, result, and shared context markers — not just
    // result (the former narrow guard). See _pruneStaleOverwritesForLane for details.
    _pruneStaleOverwrites(freshState, data);

    // Merge handler's mutations on top of live state (additive — all handlers use property sets, no deletions).
    merged = foundry.utils.mergeObject(freshState, data, { overwrite: true, insertKeys: true, insertValues: true });
  } else {
    merged = data;
  }

  reconcileBankedAutoRollRequest(merged);

  // No-op short-circuit: skip render/persist when the semantic card state is unchanged.
  try {
    const diff = foundry.utils.diffObject(liveRaw ?? {}, merged ?? {});
    if (!diff || Object.keys(diff).length === 0) return;
  } catch (_e) {
    // If diffObject fails, continue with normal persistence.
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

  const msgId = liveMessage?.id ?? liveMessage?._id ?? messageId ?? "unknown";
  const renderLabel = `card.update.render:combat:${msgId}`;
  perfStart(renderLabel);
  const content = _renderCard(merged, liveMessage?.id ?? messageId);
  perfEnd(renderLabel);

  const payload = {
    content,
    flags: { "uesrpg-3ev4": { opposed: merged } }
  };

  // Permission-safe update: defenders (non-message-authors) cannot update ChatMessage directly.
  // If lacking permission, ask the active GM to apply the update via socket.
  const persistLabel = `card.update.persist:combat:${msgId}`;
  perfStart(persistLabel);
  await safeUpdateChatMessage(liveMessage ?? message, payload);
  perfEnd(persistLabel);
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
    const rawDefenseType = String(commit.defenseType).toLowerCase();
    if (rawDefenseType === "ward") {
      data.defender.defenseType = "block";
      data.defender.blockSource = "ward";
    } else {
      data.defender.defenseType = rawDefenseType;
    }
    dirty = true;
  }
  if (Object.prototype.hasOwnProperty.call(commit, "blockSource")) {
    data.defender.blockSource = commit.blockSource ? String(commit.blockSource).toLowerCase() : null;
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
