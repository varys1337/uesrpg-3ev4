import { doesUserOwnActor } from "../../utils/authority-proxy.js";
import { canUserRollActor } from "../../utils/permissions.js";
import { createUuidResolver, getActorFromResolvedDocument, resolveUuidSync } from "../../utils/uuid-cache.js";

export function createLuckUuidResolver() {
  return createUuidResolver();
}

export function resolveLuckActor(docOrUuid, resolver = null) {
  if (!docOrUuid) return null;
  if (typeof docOrUuid !== "string") return getActorFromResolvedDocument(docOrUuid) ?? docOrUuid?.actor ?? null;
  const doc = resolver ? resolver.resolveSync(docOrUuid) : resolveUuidSync(docOrUuid);
  return getActorFromResolvedDocument(doc);
}

export function resolveLuckActorFromSpeaker(message) {
  const sp = message?.speaker;
  if (sp?.token) return canvas?.tokens?.get(sp.token)?.actor ?? null;
  if (sp?.actor) return game.actors?.get(sp.actor) ?? null;
  return null;
}

export function getLuckWhisperRecipients(actor) {
  const out = new Set();
  for (const user of (game.users?.contents ?? [])) {
    if (!user) continue;
    if (user.isGM) {
      out.add(user.id);
      continue;
    }
    if (doesUserOwnActor(user, actor)) out.add(user.id);
  }
  return Array.from(out);
}

export function canUserActOnLuckActor(actor) {
  if (!actor) return false;
  if (game.user?.isGM) return true;
  return canUserRollActor(game.user, actor);
}
