import {
  requestDeleteEmbeddedDocuments,
  requestUpdateEmbeddedDocuments,
} from "../../utils/authority-proxy.js";

function _normalizeQuantity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function _resolveOwnedItemContext({ item = null, actor = null, itemId = null } = {}) {
  const resolvedItem = item ?? actor?.items?.get?.(itemId) ?? null;
  const resolvedActor = actor ?? resolvedItem?.parent ?? null;
  const resolvedId = String(itemId ?? resolvedItem?.id ?? "").trim();

  if (!resolvedActor || resolvedActor.documentName !== "Actor" || !resolvedId) {
    return { actor: null, item: null, itemId: "" };
  }

  return {
    actor: resolvedActor,
    item: resolvedItem,
    itemId: resolvedId,
  };
}

export async function setOwnedItemQuantityOrDelete({ item = null, actor = null, itemId = null, quantity } = {}) {
  const ctx = _resolveOwnedItemContext({ item, actor, itemId });
  if (!ctx.actor || !ctx.itemId) {
    return { ok: false, deleted: false, quantity: null };
  }

  const next = _normalizeQuantity(quantity);
  if (next <= 0) {
    const ok = await requestDeleteEmbeddedDocuments(ctx.actor, "Item", [ctx.itemId]);
    return { ok: Boolean(ok), deleted: Boolean(ok), quantity: 0 };
  }

  const ok = await requestUpdateEmbeddedDocuments(ctx.actor, "Item", [{ _id: ctx.itemId, "system.quantity": next }]);
  return { ok: Boolean(ok), deleted: false, quantity: next };
}
