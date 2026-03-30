import { createAlchemyChatMessage } from "../operations.js";
import { FLAG_NS, cloneAlchemyData } from "../shared.js";
import { renderAlchemyUseCard } from "../render.js";

export const ALCHEMY_POISON_CARD_KEY = "alchemyPoisonCard";
export const ALCHEMY_TOXIN_CARD_KEY = "alchemyToxinCard";

export function getWhisperRecipientsForActor(actor) {
  const out = new Set();
  for (const user of game.users?.contents ?? []) {
    if (!user) continue;
    if (user.isGM) {
      out.add(user.id);
      continue;
    }
    try {
      if (actor?.testUserPermission?.(user, "OWNER")) out.add(user.id);
    } catch (_err) {
      // no-op
    }
  }
  return Array.from(out);
}

export function getPoisonCardState(message) {
  return cloneAlchemyData(message?.flags?.[FLAG_NS]?.[ALCHEMY_POISON_CARD_KEY] ?? {});
}

export function poisonCardFlagPatch(state = {}) {
  return Object.fromEntries(
    Object.entries(state).map(([key, value]) => [`flags.${FLAG_NS}.${ALCHEMY_POISON_CARD_KEY}.${key}`, value])
  );
}

export function toxinCardFlagPatch(state = {}) {
  return Object.fromEntries(
    Object.entries(state).map(([key, value]) => [`flags.${FLAG_NS}.${ALCHEMY_TOXIN_CARD_KEY}.${key}`, value])
  );
}

export function alchemyNoteHtml(label, text, extraClass = "") {
  return `
    <div class="uesrpg-alchemy-note ${extraClass}">
      <div class="label">${label}</div>
      <div class="text">${text}</div>
    </div>
  `;
}

export async function postAlchemyUseMessage(actor, item, title, bodyHtml) {
  const content = renderAlchemyUseCard({
    actorImg: actor.img ?? "icons/svg/mystery-man.svg",
    actorName: actor.name,
    title,
    bodyHtml,
  });
  await createAlchemyChatMessage({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}
