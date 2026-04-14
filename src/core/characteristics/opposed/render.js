/**
 * src/core/characteristics/opposed/render.js
 * Card HTML rendering for characteristic opposed workflow
 */

import { _esc, _fmtDegree } from "./util.js";
import { CHARACTERISTICS } from "./constants.js";
import { t } from "../../../utils/i18n.js";

export function _btn(label, action, extraDataset = {}) {
  const ds = Object.entries(extraDataset)
    .map(([k, v]) => `data-${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
  return `<button type="button" data-ues-char-opposed-action="${action}" ${ds}>${label}</button>`;
}

function _buildBreakdownRows(tnObj) {
  return (tnObj?.breakdown ?? []).map((b) => {
    const v = Number(b.value ?? 0);
    const sign = v >= 0 ? "+" : "";
    const label = _esc(b.label);
    return `<div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:start;">
      <span style="text-align:left;">${label}</span>
      <span style="white-space:nowrap; text-align:right;">${sign}${v}</span>
    </div>`;
  }).join("");
}

function _renderTNLine(tnLabel, tnObj = null) {
  const rows = _buildBreakdownRows(tnObj);
  if (!rows) return `<div><b>${t("UESRPG.Chat.Common.TN", "TN")}:</b> ${tnLabel}</div>`;
  return `
    <details style="margin:0;">
      <summary style="display:inline-block; cursor:pointer; user-select:none; white-space:nowrap;">
        <b>${t("UESRPG.Chat.Common.TN", "TN")}:</b> ${tnLabel} &#9654;
      </summary>
      <div style="margin:4px 0 0 0; padding-left:8px; width:100%; box-sizing:border-box; font-size:12px; opacity:0.9;">${rows}</div>
    </details>
  `;
}

function _extractRollTotal(result) {
  const n = Number(result?.rollTotal ?? result?.total ?? result?.roll?.total ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function _renderRollLine(result) {
  if (!result) return "";
  const total = _extractRollTotal(result);
  const totalText = total == null ? "??" : String(total);
  return `<div><b>${t("UESRPG.Chat.Common.Roll", "Roll")}:</b> ${totalText} - ${_fmtDegree(result)}</div>`;
}

function _charLabel(key) {
  return CHARACTERISTICS[key] ?? String(key ?? "").toUpperCase();
}

export function _renderCard(data, messageId) {
  const a = data.attacker;
  const d = data.defender;
  const aName = _esc(a.tokenName ?? a.name ?? "");
  const dName = _esc(d.tokenName ?? d.name ?? "");
  const aCharLabel = _esc(_charLabel(a.charKey));
  const dCharLabel = _esc(_charLabel(d.charKey ?? "(choose)"));

  // Banked mode: hide details until both committed
  const bothCommitted = Boolean(a?.committedAt) && Boolean(d?.committedAt);
  const revealDetails = bothCommitted || data.status === "resolved" || !!data.outcome;

  const aTNLabel = (revealDetails && a.tn) ? `${a.tn.finalTN}` : "-";
  const dTNLabel = (revealDetails && d.tn) ? `${d.tn.finalTN}` : "-";

  const attackerActions = (() => {
    if (a.result) return "";
    if (!a.committedAt) return `<div style="margin-top:6px;">${_btn(t("UESRPG.Chat.Opposed.CommitChoices", "Commit Choices"), "attacker-roll")}</div>`;
    return `<div style="margin-top:6px; opacity:0.85;"><i>${t("UESRPG.Chat.Opposed.ChoicesCommitted", "Choices committed")}</i></div>`;
  })();

  const defenderActions = (() => {
    if (d.result) return "";
    if (!d.committedAt) return `<div style="margin-top:6px;">${_btn(t("UESRPG.Chat.Opposed.CommitChoices", "Commit Choices"), "defender-roll")}</div>`;
    return `<div style="margin-top:6px; opacity:0.85;"><i>${t("UESRPG.Chat.Opposed.ChoicesCommitted", "Choices committed")}</i></div>`;
  })();

  const beginRollActions = (bothCommitted && !data.outcome && !data.status && !a.result && !d.result)
    ? `<div style="margin-top:8px;" data-ues-gm-only="true">${_btn(t("UESRPG.Chat.Opposed.BeginOpposedRoll", "Begin Opposed Roll"), "begin-banked-roll")}</div>`
    : "";

  const outcomeLine = data.outcome
    ? `<div style="margin-top:10px;"><b>${t("UESRPG.Chat.Common.Outcome", "Outcome")}:</b> ${_esc(data.outcome.text ?? "")}</div>`
    : (() => {
        if (!bothCommitted) {
          return `<div style="margin-top:10px;"><i>${t("UESRPG.Chat.Opposed.WaitingBothCommit", "Waiting for both sides to commit choices...")}</i></div>`;
        }
        return `<div style="margin-top:10px;"><i>${t("UESRPG.Chat.Status.Pending", "Pending")}</i></div>`;
      })();

  const contextLabel = data.context?.label ? `<div style="margin-bottom:6px; font-size:13px; opacity:0.85;"><b>${t("UESRPG.Chat.Common.Context", "Context")}:</b> ${_esc(data.context.label)}</div>` : "";

  return `
  <div class="ues-char-opposed-card" data-message-id="${messageId}" style="padding:6px 6px;">
    ${contextLabel}
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; align-items:start;">
      <div style="padding-right:10px; border-right:1px solid rgba(0,0,0,0.12);">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
          <div style="font-size:16px; font-weight:700; flex-shrink:0;">${t("UESRPG.Chat.Opposed.Initiator", "Initiator")}</div>
          <div style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;"><b>${aName}</b></div>
        </div>
        <div style="margin-top:4px; font-size:13px; line-height:1.25;">
          <div><b>${t("UESRPG.Chat.Common.Char", "Char")}:</b> ${aCharLabel}</div>
          ${_renderTNLine(aTNLabel, revealDetails ? a.tn : null)}
          ${_renderRollLine(a.result)}
          ${revealDetails && a.declared?.manualMod ? `<div style="font-size:12px; opacity:0.85;">${t("UESRPG.Chat.Common.Manual", "Manual")} ${Number(a.declared.manualMod) >= 0 ? "+" : ""}${a.declared.manualMod}</div>` : ""}
        </div>
        ${attackerActions}
      </div>
      <div>
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
          <div style="font-size:16px; font-weight:700; flex-shrink:0;">${t("UESRPG.Chat.Common.Target", "Target")}</div>
          <div style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;"><b>${dName}</b></div>
        </div>
        <div style="margin-top:4px; font-size:13px; line-height:1.25;">
          <div><b>${t("UESRPG.Chat.Common.Char", "Char")}:</b> ${dCharLabel}</div>
          ${_renderTNLine(dTNLabel, revealDetails ? d.tn : null)}
          ${_renderRollLine(d.result)}
          ${revealDetails && d.declared?.manualMod ? `<div style="font-size:12px; opacity:0.85;">${t("UESRPG.Chat.Common.Manual", "Manual")} ${Number(d.declared.manualMod) >= 0 ? "+" : ""}${d.declared.manualMod}</div>` : ""}
        </div>
        ${defenderActions}
      </div>
    </div>
    ${beginRollActions}
    ${outcomeLine}
  </div>`;
}
