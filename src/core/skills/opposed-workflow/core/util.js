import { emitSuppressedSubRollDice } from "../../../../utils/dice-visualization.js";
import { escapeHtml as _esc } from '../../../../utils/html.js';
export { _esc };
/**
 * src/core/skills/opposed/util.js
 * General utility helpers for skill opposed workflow
 */

import { doesUserOwnActor } from "../../../../utils/authority-proxy.js";
import { formatResultSummary } from "../../../../utils/degree-roll-helper.js";
import { getCoreRollMode } from "../../../../utils/chat-roll-mode.js";



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
  return getCoreRollMode({ fallback: defaultValue });
}

export function _isQuickShiftRequested(event) {
  return Boolean(event?.shiftKey) && Boolean(_safeGetSetting("skillRollQuickShift", false));
}

export function _emitSuppressedSubRollDice(roll, options = {}) {
  void emitSuppressedSubRollDice(roll, options);
  return null;
}
