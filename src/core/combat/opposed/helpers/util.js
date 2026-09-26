import { emitSuppressedSubRollDice as _emitSuppressedSubRollDice } from '../../../../utils/dice-visualization.js';
export { _emitSuppressedSubRollDice };
/**
 * src/core/combat/opposed/helpers/util.js
 * Utility functions for opposed workflow
 */

import { isDebugEnabled } from "../../../../utils/debug.js";
import { doesUserOwnActor, getChatMessageAuthorUser } from "../../../../utils/authority-proxy.js";

export { getRuntimeSystemId as _getSystemId } from "../../../system/namespace.js";
import { getFlagValueWithFallback } from "../../../system/flags.js";

export function _debugEnabled() {
  return isDebugEnabled("opposedDebug");
}

export function _logDebug(event, payload) {
  if (!_debugEnabled()) return;
  try {
    console.log(`UESRPG Opposed | ${event}`, payload);
    try {
      const id = payload?.messageId ?? payload?.parentMessageId ?? null;
      game.uesrpg?.debug?.recordOpposedEvent?.(id, event, payload);
    } catch (_e2) {
      /* no-op */
    }
  } catch (_e) {}
}

export function _findEnabledEffectByUesrpgKey(actor, key) {
  if (!actor || !key) return null;
  return actor.effects?.find?.((e) => !e.disabled && getFlagValueWithFallback(e, "key") === key) ?? null;
}

export function _userHasActorOwnership(user, actor) {
  return doesUserOwnActor(user, actor);
}

export function _asNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

export function _normalizeKey(v) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function _safeGetSetting(namespace, key, fallback = false) {
  try {
    const full = `${namespace}.${key}`;
    if (game?.settings?.settings?.has?.(full) === false) return fallback;
    if (typeof game?.settings?.get === "function") return game.settings.get(namespace, key);
  } catch (_e) {
    // ignore and fall back
  }
  return fallback;
}

export function _anyActiveGMOnline() {
  try {
    const users = game?.users ? Array.from(game.users.values()) : [];
    return users.some(u => u?.active && u.isGM);
  } catch (_e) {
    return false;
  }
}

export function _canControlActor(actor) {
  return game.user.isGM || actor?.isOwner;
}

export function _getChatMessageAuthorUser(msg) {
  return getChatMessageAuthorUser(msg);
}

export function _opposedFlags(parentMessageId, stage, extra = null) {
  // Thread all workflow messages to the originating opposed card for easier debugging and filtering.
  // Optionally include additional metadata under the same flag lane.
  const base = {
    parentMessageId,
    stage
  };
  const opposed = (extra && typeof extra === "object") ? foundry.utils.mergeObject(base, extra, { inplace: false }) : base;
  return {
    "uesrpg-3ev4": {
      opposed
    }
  };
}


