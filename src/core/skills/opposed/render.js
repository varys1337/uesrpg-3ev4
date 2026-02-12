/**
 * src/core/skills/opposed/render.js
 * Card HTML rendering for skill opposed workflow
 */

import { _esc, _fmtDegree } from "./util.js";

export function _renderDeclared(declared, tnObj) {
  if (!declared) return "";
  const parts = [];
  const diff = tnObj?.difficulty;
  if (diff?.label) {
    const sign = Number(diff.mod || 0) >= 0 ? "+" : "";
    parts.push(`${diff.label} (${sign}${Number(diff.mod || 0)})`);
  }
  const manual = Number(declared.manualMod || 0);
  if (manual) parts.push(`Manual ${manual >= 0 ? "+" : ""}${manual}`);
  if (declared.useSpec) parts.push("Spec +10");
  if (!parts.length) return "";
  return `<div style="margin-top:2px; font-size:12px; opacity:0.85;"><b>Options:</b> ${parts.join("; ")}</div>`;
}

export function _btn(label, action, extraDataset = {}) {
  const ds = Object.entries(extraDataset)
    .map(([k, v]) => `data-${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
  return `<button type="button" data-ues-skill-opposed-action="${action}" ${ds}>${label}</button>`;
}

function _buildBreakdownRows(tnObj) {
  return (tnObj?.breakdown ?? []).map((b) => {
    const v = Number(b.value ?? 0);
    const sign = v >= 0 ? "+" : "";
    const label = _esc(b.label);
    return `<div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:start;">
      <span style="overflow-wrap:anywhere; word-break:normal; text-align:left;">${label}</span>
      <span style="white-space:nowrap; text-align:right;">${sign}${v}</span>
    </div>`;
  }).join("");
}

export function _renderBreakdown(tnObj, { inline = false } = {}) {
  const rows = _buildBreakdownRows(tnObj);
  if (!rows) return "";
  if (inline) {
    return `
      <details style="display:inline-block; margin-left:6px; vertical-align:baseline;">
        <summary style="display:inline-block; cursor:pointer; user-select:none; white-space:nowrap;" title="TN breakdown">&#9654;</summary>
        <div style="margin-top:4px; font-size:12px; opacity:0.9;">${rows}</div>
      </details>`;
  }
  return `
    <details style="margin-top:4px;">
      <summary style="cursor:pointer; user-select:none; white-space:nowrap; overflow-wrap:normal; word-break:keep-all;">TN breakdown</summary>
      <div style="margin-top:4px; font-size:12px; opacity:0.9;">${rows}</div>
    </details>`;
}

function _renderTNLine(tnLabel, tnObj = null) {
  const rows = _buildBreakdownRows(tnObj);
  if (!rows) return `<div><b>TN:</b> ${tnLabel}</div>`;
  return `
    <details style="margin:0;">
      <summary style="display:inline-block; cursor:pointer; user-select:none; white-space:nowrap;">
        <b>TN:</b> ${tnLabel} &#9654;
      </summary>
      <div style="margin:4px 0 0 0; padding-left:8px; width:100%; box-sizing:border-box; font-size:12px; opacity:0.9;">${rows}</div>
    </details>
  `;
}

function _extractRollTotal(result) {
  const n = Number(result?.rollTotal ?? result?.total ?? result?.roll?.total ?? result?.roll?._total ?? result?.roll?.result ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function _renderRollLine(result) {
  if (!result) return "";
  const total = _extractRollTotal(result);
  const totalText = total == null ? "??" : String(total);
  return `<div><b>Roll:</b> ${totalText} - ${_fmtDegree(result)}</div>`;
}

export function _renderCard(data, messageId) {
  const a = data.attacker;
  const d = data.defender;
  const aName = _esc(a.tokenName ?? a.name ?? "");
  const dName = _esc(d.tokenName ?? d.name ?? "");
  const aSkillLabel = _esc(a.skillLabel ?? "");
  const dSkillLabel = _esc(d.skillLabel ?? "(choose)");

  // Banked-choice mode: do not reveal TN/choice details until both sides have committed.
  const bankMode = true;
  const bothCommitted = Boolean(a?.committedAt) && Boolean(d?.committedAt);
  const revealDetails = !bankMode || bothCommitted || data.status === "resolved" || !!data.outcome;

  const aTNLabel = (revealDetails && a.tn) ? `${a.tn.finalTN}` : "-";
  const dTNLabel = (revealDetails && d.tn) ? `${d.tn.finalTN}` : "-";

  const attackerActions = (() => {
    if (a.result) return "";
    if (!a.committedAt) return `<div style="margin-top:6px;">${_btn("Commit Choices", "attacker-roll")}</div>`;
    // Committed; awaiting GM auto-roll or resolution.
    return `<div style="margin-top:6px; opacity:0.85;"><i>Choices committed</i></div>`;
  })();

  const defenderActions = (() => {
    if (d.result) return "";
    if (!d.committedAt) return `<div style="margin-top:6px;">${_btn("Commit Choices", "defender-roll")}</div>`;
    return `<div style="margin-top:6px; opacity:0.85;"><i>Choices committed</i></div>`;
  })();

  const beginRollActions = (bankMode && bothCommitted && !data.outcome && !data.status && !a.result && !d.result && game.user.isGM)
    ? `<div style="margin-top:8px;">${_btn("Begin Opposed Roll", "begin-banked-roll")}</div>`
    : "";

  const outcomeLine = data.outcome
    ? `<div style="margin-top:10px;"><b>Outcome:</b> ${_esc(data.outcome.text ?? "")}</div>`
    : (() => {
        if (bankMode && !bothCommitted) {
          return `<div style="margin-top:10px;"><i>Waiting for both sides to commit choices...</i></div>`;
        }
        const phase = String(data?.context?.phase ?? "pending");
        const waitingSince = Number(data?.context?.waitingSince ?? 0);
        const ageMs = waitingSince ? (Date.now() - waitingSince) : 0;
        const isWaiting = (phase === "waitingdefender" || phase === "waitingDefender");
        const isStale = isWaiting && ageMs > 60_000;
        const note = isStale
          ? `<div style="margin-top:6px; font-size:12px; opacity:0.85;">
               Still waiting on the defender result. If this persists, ensure the defender roll message was posted, and have the attacker refresh the page to re-render the card.
             </div>`
          : "";
        return `<div style="margin-top:10px;"><i>Pending</i></div>${note}`;
      })();

  return `
  <div class="ues-skill-opposed-card" data-message-id="${messageId}" style="padding:6px 6px;">
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; align-items:start;">
      <div style="padding-right:10px; border-right:1px solid rgba(0,0,0,0.12);">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
          <div style="font-size:16px; font-weight:700; flex-shrink:0;">Actor</div>
          <div style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;"><b>${aName}</b></div>
        </div>
        <div style="margin-top:4px; font-size:13px; line-height:1.25;">
          <div><b>Skill:</b> ${aSkillLabel}</div>
          ${_renderTNLine(aTNLabel, revealDetails ? a.tn : null)}
          ${_renderRollLine(a.result)}
        </div>
        ${attackerActions}
      </div>
      <div style="padding-left:2px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
          <div style="font-size:16px; font-weight:700; flex-shrink:0;">Target</div>
          <div style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;"><b>${dName}</b></div>
        </div>
        <div style="margin-top:4px; font-size:13px; line-height:1.25;">
          <div><b>Skill:</b> ${dSkillLabel}</div>
          ${_renderTNLine(dTNLabel, revealDetails ? d.tn : null)}
          ${_renderRollLine(d.result)}
        </div>
        ${defenderActions}
      </div>
    </div>    ${beginRollActions}
    ${outcomeLine}
  </div>`;
}

