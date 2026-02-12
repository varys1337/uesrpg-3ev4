/**
 * src/core/combat/opposed/helpers/util.js
 * Utility functions for opposed workflow
 */

import { isDebugEnabled } from "../../../../utils/debug.js";

export function _debugEnabled() {
  return isDebugEnabled("opposedDebug");
}

export function _logDebug(event, payload) {
  if (!_debugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
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
  return actor.effects?.find?.((e) => !e.disabled && e?.flags?.uesrpg?.key === key) ?? null;
}

export function _userHasActorOwnership(user, actor) {
  try {
    if (!user || !actor) return false;
    if (user.isGM) return true;
    if (typeof actor.testUserPermission === 'function') {
      return actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
    }
    const level = Number(actor?.ownership?.[user.id] ?? 0);
    return level >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  } catch (_e) {
    return false;
  }
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

export function _getSystemId() {
  // Prefer runtime system id; fall back to the canonical package id.
  return String(game?.system?.id ?? "uesrpg-3ev4");
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
  const authorId =
    msg?.author?.id ??
    msg?._source?.author ??
    msg?._source?.user ??
    msg?.data?.author ??
    msg?.data?.user ??
    null;
  return authorId ? (game.users.get(String(authorId)) ?? null) : null;
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
