/**
 * src/core/characteristics/opposed/util.js
 * General utility helpers for characteristic opposed workflow
 */

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

export function _canControlActor(actor) {
  return Boolean(actor?.testUserPermission?.(game.user, "OWNER"));
}

export function _userHasActorOwnership(user, actor) {
  if (!actor || !user) return false;
  if (user.isGM) return true;
  const userId = user?.id ?? user?._id ?? null;
  if (!userId) return false;
  const ownership = actor?.ownership ?? actor?.permission ?? {};
  const userLevel = Number(ownership[userId] ?? ownership.default ?? 0);
  return userLevel >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
}

export function _fmtDegree(res) {
  if (!res) return "-";
  const cls = res.isSuccess ? "green" : "red";
  const textual = `${Number(res.degree ?? 0)} ${res.isSuccess ? "DoS" : "DoF"}`;
  return `<span style="color: ${cls};">${textual}</span>`;
}
