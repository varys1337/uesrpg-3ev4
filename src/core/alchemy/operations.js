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

export async function consumeOwnedItem(item) {
  if (!item) {
    return createAlchemyOperationResult({ reason: "Missing item." });
  }

  const quantity = Number(item.system?.quantity ?? 1);
  if (quantity <= 1) {
    if (item.parent?.documentName === "Actor") {
      await requestDeleteEmbeddedDocuments(item.parent, "Item", [item.id]);
    } else {
      await item.delete();
    }
    return createAlchemyOperationResult({ ok: true, data: { deleted: true } });
  }

  await requestUpdateDocument(item, { "system.quantity": quantity - 1 });
  return createAlchemyOperationResult({ ok: true, data: { deleted: false, quantity: quantity - 1 } });
}

export async function consumeOwnedItemQuantity(item, amount = 1) {
  if (!item) return createAlchemyOperationResult({ reason: "Missing item." });
  const requested = Math.max(1, Math.floor(Number(amount) || 1));
  const quantity = Math.max(0, Number(item.system?.quantity ?? 1) || 0);
  if (quantity < requested) {
    return createAlchemyOperationResult({ reason: `Insufficient quantity: requires ${requested}, has ${quantity}.` });
  }
  if (quantity === requested) {
    const deleted = item.parent?.documentName === "Actor"
      ? await requestDeleteEmbeddedDocuments(item.parent, "Item", [item.id])
      : Boolean(await item.delete());
    if (!deleted) return createAlchemyOperationResult({ reason: "Ingredient deletion was rejected." });
    return createAlchemyOperationResult({ ok: true, data: { deleted: true, consumed: requested } });
  }
  const next = quantity - requested;
  const updated = await requestUpdateDocument(item, { "system.quantity": next });
  if (!updated) return createAlchemyOperationResult({ reason: "Ingredient quantity update was rejected." });
  return createAlchemyOperationResult({ ok: true, data: { deleted: false, consumed: requested, quantity: next } });
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
  await requestUpdateDocument(item, { [flagPath]: null });
  return createAlchemyOperationResult({ ok: true });
}

export async function updateAlchemyDocument(document, updateData) {
  const updated = await requestUpdateDocument(document, updateData);
  return createAlchemyOperationResult({
    ok: Boolean(updated),
    reason: updated ? "" : "Document update was rejected.",
    data: updated ? updateData : null,
  });
}
