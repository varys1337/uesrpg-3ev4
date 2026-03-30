const _ALCHEMY_TOOL_RX = /(?:(?:alchem(?:y|ical)).*(?:tools?|equipment|kits?|field\s*kit)|(?:tools?|equipment|kits?|field\s*kit).*(?:alchem(?:y|ical)))/i;

export const ALCHEMY_TOOL_RX = _ALCHEMY_TOOL_RX;

export function getActorItemsArray(actor) {
  return Array.from(actor?.items ?? []);
}

export function buildActorItemSnapshot(actor) {
  const items = getActorItemsArray(actor);
  const byType = new Map();
  for (const item of items) {
    const type = String(item?.type ?? "").trim().toLowerCase();
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(item);
  }
  return { items, byType };
}

export function getItemsOfType(snapshotOrActor, type) {
  const wanted = String(type ?? "").trim().toLowerCase();
  if (!wanted) return [];
  if (snapshotOrActor?.byType instanceof Map) {
    return snapshotOrActor.byType.get(wanted) ?? [];
  }
  return getActorItemsArray(snapshotOrActor).filter((item) => String(item?.type ?? "").trim().toLowerCase() === wanted);
}

export function normalizeAlchemyName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function safeFromUuidSync(uuid) {
  const wanted = String(uuid ?? "").trim();
  if (!wanted || typeof fromUuidSync !== "function") return null;
  try {
    return fromUuidSync(wanted) ?? null;
  } catch (_err) {
    return null;
  }
}

export function isSupportedAlchemySpellSource(actor, spell) {
  if (!spell || spell.type !== "spell") return false;
  if (spell.pack) return false;

  const parent = spell.parent ?? null;
  if (!parent) return true;
  if (parent.documentName !== "Actor") return false;
  return String(parent.uuid ?? "") === String(actor?.uuid ?? "");
}

export function findActorSpellByUuid(actor, spellUuid, { items = null } = {}) {
  const wanted = String(spellUuid ?? "").trim();
  if (!wanted) return null;
  const actorItems = Array.isArray(items) ? items : getActorItemsArray(actor);
  const actorOwned = actorItems.find((item) => item?.type === "spell" && String(item?.uuid ?? "").trim() === wanted) ?? null;
  if (actorOwned) return actorOwned;

  const resolved = safeFromUuidSync(wanted);
  return isSupportedAlchemySpellSource(actor, resolved) ? resolved : null;
}

export function createAlchemyOperationResult({ ok = false, reason = "", data = null, ...rest } = {}) {
  return {
    ok: Boolean(ok),
    reason: String(reason ?? "").trim(),
    data,
    ...rest,
  };
}
