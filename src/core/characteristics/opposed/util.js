import { escapeHtml as _esc } from '../../../utils/html.js';
export { _esc };
/**
 * src/core/characteristics/opposed/util.js
 * General utility helpers for characteristic opposed workflow
 */

import { doesUserOwnActor } from "../../../utils/authority-proxy.js";
import { formatResultSummary } from "../../../utils/degree-roll-helper.js";



export function _canControlActor(actor) {
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
