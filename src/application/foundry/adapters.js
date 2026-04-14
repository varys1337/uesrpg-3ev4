import { resolveActorFromUuidSync, resolveUuidSync } from "../../utils/uuid-cache.js";

export async function resolveActorDocument(actorOrUuid) {
  if (actorOrUuid?.documentName === "Actor") return actorOrUuid;

  const raw = String(actorOrUuid?.uuid ?? actorOrUuid ?? "").trim();
  if (!raw) return null;

  const cached = resolveActorFromUuidSync(raw) ?? resolveUuidSync(raw);
  if (cached?.documentName === "Actor") return cached;

  try {
    const resolved = await fromUuid(raw);
    if (resolved?.documentName === "Actor") return resolved;
  } catch (_err) {
    // Fall back to world actor id resolution below.
  }

  const fallback = game.actors?.get?.(raw.split(".").pop()) ?? null;
  return fallback?.documentName === "Actor" ? fallback : null;
}

export async function resolveGroupActorDocument(groupActorOrUuid) {
  const actor = await resolveActorDocument(groupActorOrUuid);
  return String(actor?.type ?? "") === "Group" ? actor : null;
}

export function normalizeTargetTokenUuids(targets = []) {
  return Array.from(targets ?? [])
    .map((target) => target?.document?.uuid ?? target?.uuid ?? String(target ?? "").trim())
    .filter((uuid) => String(uuid ?? "").trim().length > 0);
}

export async function createApplicationChatMessage(data) {
  return ChatMessage.create(data);
}
