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

  const liveItem = resolvedActor.items?.get?.(resolvedId) ?? null;
  if (!liveItem) {
    return { actor: null, item: null, itemId: "" };
  }

  return {
    actor: resolvedActor,
    item: liveItem,
    itemId: resolvedId,
  };
}

export async function updateOwnedItem({ item = null, actor = null, itemId = null, updates = {} } = {}) {
  const ctx = _resolveOwnedItemContext({ item, actor, itemId });
  if (!ctx.actor || !ctx.itemId || !updates || typeof updates !== "object") {
    return { ok: false, item: null, itemId: "" };
  }

  const update = { _id: ctx.itemId, ...updates };
  const ok = await requestUpdateEmbeddedDocuments(ctx.actor, "Item", [update]);
  return { ok: Boolean(ok), item: ctx.item, itemId: ctx.itemId };
}

export async function setOwnedItemEquipped({ item = null, actor = null, itemId = null, equipped = null } = {}) {
  const ctx = _resolveOwnedItemContext({ item, actor, itemId });
  if (!ctx.actor || !ctx.item || !ctx.itemId) {
    return { ok: false, item: null, itemId: "", equipped: null };
  }

  const next = equipped === null || equipped === undefined
    ? !Boolean(ctx.item.system?.equipped)
    : Boolean(equipped);
  const result = await updateOwnedItem({
    actor: ctx.actor,
    itemId: ctx.itemId,
    updates: { "system.equipped": next },
  });
  return { ...result, equipped: next };
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

  const result = await updateOwnedItem({
    actor: ctx.actor,
    itemId: ctx.itemId,
    updates: { "system.quantity": next },
  });
  return { ok: Boolean(result.ok), deleted: false, quantity: next };
}
