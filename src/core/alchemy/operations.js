import { acquireLock, releaseLock, lockKeyForDoc } from "../../utils/authority-proxy/shared.js";
import { measurePerfStage } from "../../utils/perf-tracker.js";
import {
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
  requestUpdateDocument,
  requestUpdateChatMessage,
} from "../../utils/authority-proxy.js";
import { createAlchemyOperationResult } from "./utils.js";

export function createAlchemyChatMessage(payload = {}) {
  return ChatMessage.create(payload);
}

export function updateAlchemyChatMessage(message, payload = {}) {
  return requestUpdateChatMessage(message, payload);
}

const _pendingActivations = new Map();

/** Join pending use of one owned Item, including activations from different UI entry points. */
export function runAlchemyItemActivation(item, run) {
  const key = item?.uuid;
  if (!key) return Promise.resolve(createAlchemyOperationResult({ reason: "Missing owned Item." }));
  if (_pendingActivations.has(key)) return _pendingActivations.get(key);
  const pending = measurePerfStage("consumption", "settlement", { itemUuid: key }, async () => {
    const fresh = await fromUuid(key);
    if (!fresh || !(Number(fresh.system?.quantity ?? 1) > 0)) {
      ui.notifications?.warn?.("This Item is deleted or exhausted.");
      return createAlchemyOperationResult({ reason: "This Item is deleted or exhausted.", execution: { status: "failed", committed: false } });
    }
    return run(fresh);
  }).catch(error => {
    const reason = String(error.message ?? error);
    ui.notifications?.warn?.(reason);
    return createAlchemyOperationResult({ reason, execution: { status: "failed", committed: false } });
  }).finally(() => _pendingActivations.delete(key));
  _pendingActivations.set(key, pending);
  return pending;
}

export function consumeOwnedItem(item) {
  return consumeOwnedItemQuantity(item, 1);
}

export async function consumeOwnedItemQuantity(item, amount = 1) {
  if (!item?.uuid) return createAlchemyOperationResult({ reason: "Missing item." });
  const requested = Math.max(1, Math.floor(Number(amount) || 1));
  const lockKey = lockKeyForDoc(item);
  let acquired = false;
  try {
    await measurePerfStage("consumption", "queueWait", { itemUuid: item.uuid }, () => acquireLock(lockKey));
    acquired = true;
    const fresh = await fromUuid(item.uuid);
    if (!fresh) return createAlchemyOperationResult({ reason: "The Item no longer exists." });
    const quantity = Math.max(0, Number(fresh.system?.quantity ?? 1) || 0);
    if (quantity < requested) return createAlchemyOperationResult({ reason: `Insufficient quantity: requires ${requested}, has ${quantity}.` });
    const next = quantity - requested;
    const confirmed = await measurePerfStage("consumption", "persistence", { itemUuid: item.uuid, writeCount: 1 }, () => next === 0
      ? (fresh.parent?.documentName === "Actor" ? requestDeleteEmbeddedDocuments(fresh.parent, "Item", [fresh.id]) : fresh.delete().then(Boolean))
      : requestUpdateDocument(fresh, { "system.quantity": next }));
    return createAlchemyOperationResult({
      ok: confirmed, reason: confirmed ? "" : "Item consumption was not confirmed.",
      data: confirmed ? { deleted: next === 0, consumed: requested, quantity: next } : null,
    });
  } catch (error) {
    return createAlchemyOperationResult({ reason: error?.message ?? String(error) });
  } finally {
    if (acquired) releaseLock(lockKey);
  }
}

export async function createOwnedItem(actor, itemData) {
  const created = await requestCreateEmbeddedDocuments(actor, "Item", [itemData]);
  const item = created?.[0] ?? null;
  return createAlchemyOperationResult({
    ok: Boolean(item),
    reason: item ? "" : "Failed to create embedded Item document.",
    data: item,
  });
}

export async function deleteOwnedItem(actor, itemId) {
  const deleted = await requestDeleteEmbeddedDocuments(actor, "Item", [itemId]);
  return createAlchemyOperationResult({ ok: Boolean(deleted), data: deleted });
}

export async function createCarrierEffect(carrierItem, effectData) {
  const created = await requestCreateEmbeddedDocuments(carrierItem, "ActiveEffect", [effectData]);
  const effect = created?.[0] ?? null;
  return createAlchemyOperationResult({
    ok: Boolean(effect),
    reason: effect ? "" : "Failed to create embedded ActiveEffect document.",
    data: effect,
  });
}

export async function clearLegacyAlchemyCarrierFlag(item, flagPath) {
  const confirmed = await requestUpdateDocument(item, { [flagPath]: null }, { render: false });
  return createAlchemyOperationResult({ ok: confirmed, reason: confirmed ? "" : "Carrier metadata cleanup failed." });
}

export async function updateAlchemyDocument(document, updateData) {
  const updated = await requestUpdateDocument(document, updateData);
  return createAlchemyOperationResult({
    ok: Boolean(updated),
    reason: updated ? "" : "Document update was rejected.",
    data: updated ? updateData : null,
  });
}
