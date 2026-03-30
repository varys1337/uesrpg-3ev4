/**
 * src/core/skills/opposed/util.js
 * General utility helpers for skill opposed workflow
 */

import { doesUserOwnActor } from "../../../../utils/authority-proxy.js";
import { formatResultSummary } from "../../../../utils/degree-roll-helper.js";

export function _esc(value) {
  const raw = String(value ?? "");
  if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(raw);
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _canControlActor(actor) {
  return Boolean(actor?.testUserPermission?.(game.user, "OWNER"));
}

export function _userHasActorOwnership(user, actor) {
  return doesUserOwnActor(user, actor);
}

export function _fmtDegree(res) {
  if (!res) return "-";
  const cls = res.isSuccess ? "green" : "red";
  const textual = formatResultSummary(res, { includeDegree: true, degreeStyle: "paren" });
  return `<span style="color: ${cls};">${textual}</span>`;
}

function _anyActiveGMOnline() {
  const activeGM = game.users.activeGM ?? null;
  return Boolean(activeGM);
}

export function _safeGetSetting(key, defaultValue = null) {
  try {
    return game.settings.get("uesrpg-3ev4", key) ?? defaultValue;
  } catch (_e) {
    return defaultValue;
  }
}

export function _getCoreRollMode(defaultValue = "roll") {
  try {
    return game.settings.get("core", "rollMode") ?? defaultValue;
  } catch (_e) {
    return defaultValue;
  }
}

export function _isQuickShiftRequested(event) {
  return Boolean(event?.shiftKey) && Boolean(_safeGetSetting("skillRollQuickShift", false));
}

export function _emitSuppressedSubRollDice(roll, { rollMode = null } = {}) {
  if (!roll) return null;
  const dsn = game?.dice3d;
  if (!dsn || typeof dsn.showForRoll !== "function") return null;

  const mode = String(rollMode ?? _getCoreRollMode("roll")).toLowerCase();
  const isPublic = mode === "roll" || mode === "publicroll";
  const sync = Boolean(isPublic);

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

