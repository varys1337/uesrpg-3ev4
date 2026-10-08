import { getCoreMessageMode, normalizeChatMessageMode } from './chat-roll-mode.js';

const emittedRolls = new WeakMap();
const DICE_ROLES = Object.freeze({ frost: "cold", shock: "lightning" });

/** Animate an evaluated sub-roll without posting or waiting on a card.
 * The returned promise settles safely; mechanics must not await it.
 */
export function emitSuppressedSubRollDice(roll, {
  rollMode = null, messageMode = null, message = null, parentMessageId = null,
  user = null, actor = null, token = null, speaker = null,
  whisper = null, blind = null, synchronize = true, damageType = null,
} = {}) {
  try {
    const runtime = globalThis.game;
    const dsn = runtime?.dice3d;
    if (!roll || !roll.dice?.length || !dsn || typeof dsn.showForRoll !== "function") return Promise.resolve(false);
    if (emittedRolls.has(roll)) return emittedRolls.get(roll);

    const source = message ?? (parentMessageId ? runtime.messages?.get(parentMessageId) : null);
    const roller = user ?? source?.author ?? runtime.user;
    const actualSpeaker = speaker ?? (actor ? ChatMessage.getSpeaker({ actor, token }) : source?.speaker ?? null);
    const mode = normalizeChatMessageMode(messageMode ?? rollMode ?? getCoreMessageMode());
    const nativeMode = { roll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self" }[mode];
    const visibility = source ? { whisper: source.whisper ?? [], blind: Boolean(source.blind) }
      : ChatMessage.applyMode({}, nativeMode);
    if (!source && mode === "selfroll") visibility.whisper = roller?.id ? [roller.id] : [];
    const recipients = (source ? visibility.whisper : whisper ?? visibility.whisper ?? [])
      .map((entry) => typeof entry === "string" ? entry : entry?.id).filter(Boolean);
    if (!recipients.length && ((source && source.blind) || (!source && mode !== "roll"))) return Promise.resolve(false);
    const isBlind = source ? visibility.blind : blind ?? visibility.blind ?? false;
    if (isBlind && !recipients.length) return Promise.resolve(false);

    if (actor?.id && roll.data) roll.data.actorId = actor.id;
    if ((damageType || roll.options?.type) && roll.options) {
      const type = String(damageType ?? roll.options.type).toLowerCase().trim();
      roll.options.type = DICE_ROLES[type] ?? type;
    }
    let animation;
    try {
      // Parent cards remain visible; animation completion never gates application.
      animation = Promise.resolve(dsn.showForRoll(
        roll, roller, synchronize, recipients.length ? recipients : null,
        Boolean(isBlind), null, actualSpeaker,
      )).catch(() => false);
    } catch (_error) {
      animation = Promise.resolve(false);
    }
    emittedRolls.set(roll, animation);
    return animation;
  } catch (_error) {
    return Promise.resolve(false);
  }
}
