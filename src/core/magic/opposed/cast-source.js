import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { resolveUuidSync } from "../../../utils/uuid-cache.js";
import { FLAG_SCOPE } from "../../system/namespace.js";

const _FLAG_NS = FLAG_SCOPE;

export function normalizeCastSourceCostMode(castSource = null) {
  const mode = String(castSource?.costMode ?? "soul").trim().toLowerCase();
  if (mode === "magicka" || mode === "none") return mode;
  return "soul";
}

export function resolveItemContextFromCastSource(castSource = null, itemCastContext = null) {
  const itemUuid = String(itemCastContext?.itemUuid ?? castSource?.itemUuid ?? "").trim();
  const sourceLane = String(itemCastContext?.sourceLane ?? castSource?.sourceLane ?? "workshop").trim().toLowerCase();
  const slotId = String(itemCastContext?.slotId ?? castSource?.spellSlotId ?? "").trim();
  if (!itemUuid) return null;

  const itemDoc = resolveUuidSync(itemUuid);
  const item = itemDoc?.documentName === "Item" ? itemDoc : null;
  if (!item) return null;

  return { item, sourceLane, slotId };
}

export function getItemSoulPoolSnapshot(itemCtx = null) {
  if (!itemCtx?.item) return { value: 0, max: 0, poolPath: "" };

  const { item, sourceLane } = itemCtx;
  if (sourceLane === "extension") {
    const pool = item.flags?.[_FLAG_NS]?.itemSpellcasting?.pool ?? {};
    return {
      value: Number(item.system?.charge?.value ?? pool?.value ?? 0) || 0,
      max: Number(item.system?.charge?.max ?? pool?.max ?? 0) || 0,
      poolPath: `flags.${_FLAG_NS}.itemSpellcasting.pool.value`,
    };
  }

  const pool = item.flags?.[_FLAG_NS]?.enchanting?.cast?.pool ?? {};
  return {
    value: Number(pool?.value ?? 0) || 0,
    max: Number(pool?.max ?? 0) || 0,
    poolPath: `flags.${_FLAG_NS}.enchanting.cast.pool.value`,
  };
}

export async function spendItemSoulCost({ itemCtx, cost }) {
  const amount = Math.max(0, Number(cost ?? 0) || 0);
  const snapshot = getItemSoulPoolSnapshot(itemCtx);

  if (snapshot.value < amount) {
    return { ok: false, reason: "insufficient", value: snapshot.value, max: snapshot.max, spent: 0 };
  }

  const next = Math.max(0, snapshot.value - amount);
  const updates = { [snapshot.poolPath]: next, "system.charge.value": next };
  const ok = await requestUpdateDocument(itemCtx.item, updates);
  if (!ok) {
    return { ok: false, reason: "update-failed", value: snapshot.value, max: snapshot.max, spent: 0 };
  }

  return { ok: true, value: next, max: snapshot.max, spent: amount };
}
