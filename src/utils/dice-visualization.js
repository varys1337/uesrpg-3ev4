import { getCoreRollMode, isPublicChatMessageMode } from './chat-roll-mode.js';

export function emitSuppressedSubRollDice(roll, { rollMode = null } = {}) {
  if (!roll) return null;
  const dsn = game?.dice3d;
  if (!dsn || typeof dsn.showForRoll !== "function") return null;

  const sync = isPublicChatMessageMode(rollMode ?? getCoreRollMode());

  try {
    const primary = dsn.showForRoll(roll, game.user, sync);
    Promise.resolve(primary).catch(() => {
      try {
        const fallback = dsn.showForRoll(roll);
        Promise.resolve(fallback).catch(() => {});
      } catch (_err2) {
        // no-op
      }
    });
  } catch (_err) {
    try {
      const fallback = dsn.showForRoll(roll);
      Promise.resolve(fallback).catch(() => {});
    } catch (_err2) {
      // no-op
    }
  }
  return null;
}
