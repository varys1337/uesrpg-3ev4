import { renderTargetNumberLine, renderRollSummary, renderOpposedParticipant, renderParticipantContext, renderOpposedLayout, renderOpposedOutcome } from "../../../opposed/shared/card-rendering.js";
/**
 * src/core/skills/opposed/render.js
 * Card HTML rendering for skill opposed workflow
 */

import { _esc } from "./util.js";
import { t } from "../../../../utils/i18n.js";
import { systemTooltipAttributes } from "../../../../ui/shared/system-tooltips.js";

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
  return `<button type="button" data-ues-skill-opposed-action="${action}" ${ds}
    style="width:100%; box-sizing:border-box; white-space:normal; line-height:1.15; text-align:center;">${label}</button>`;
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
        <summary style="display:inline-block; cursor:var(--uesrpg-cursor-pointer, pointer); user-select:none; white-space:nowrap;" ${systemTooltipAttributes({ text: t("UESRPG.Chat.Common.TnBreakdown", "TN breakdown"), ariaLabel: t("UESRPG.Chat.Common.TnBreakdown", "TN breakdown") })}>&#9654;</summary>
        <div style="margin-top:4px; font-size:12px; opacity:0.9;">${rows}</div>
      </details>`;
  }
  return `
    <details style="margin-top:4px;">
      <summary style="cursor:var(--uesrpg-cursor-pointer, pointer); user-select:none; white-space:nowrap; overflow-wrap:normal; word-break:keep-all;">${t("UESRPG.Chat.Common.TnBreakdown", "TN breakdown")}</summary>
      <div style="margin-top:4px; font-size:12px; opacity:0.9;">${rows}</div>
    </details>`;
}

function _renderTNLine(tnLabel, tnObj = null) {
  return renderTargetNumberLine(tnLabel, _buildBreakdownRows(tnObj));
}

function _extractRollTotal(result) {
  const n = Number(result?.rollTotal ?? result?.total ?? result?.roll?.total ?? result?.roll?.result ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function _renderRollLine(result) {
  if (!result) return "";
  const total = _extractRollTotal(result);
  const totalText = total == null ? "??" : String(total);
  return renderRollSummary(totalText, result);
}

export function _renderCard(data, messageId) {
  const a = data.attacker;
  const d = data.defender;
  const aName = a.tokenName ?? a.name ?? "";
  const dName = d.tokenName ?? d.name ?? "";
  const aSkillLabel = a.skillLabel ?? "";
  const dSkillLabel = d.skillLabel ?? "(choose)";

  // Banked-choice mode: do not reveal TN/choice details until both sides have committed.
  const bankMode = true;
  const bothCommitted = Boolean(a?.committedAt) && Boolean(d?.committedAt);
  const revealDetails = !bankMode || bothCommitted || data.status === "resolved" || !!data.outcome;

  const aTNLabel = (revealDetails && a.tn) ? `${a.tn.finalTN}` : "-";
  const dTNLabel = (revealDetails && d.tn) ? `${d.tn.finalTN}` : "-";

  const attackerActions = (() => {
    if (a.result) return "";
    if (!a.committedAt) return `<div class="uesrpg-opposed-action-row">${_btn(t("UESRPG.Chat.Opposed.CommitChoices", "Commit Choices"), "attacker-roll")}</div>`;
    // Committed; awaiting GM auto-roll or resolution.
    return `<div class="uesrpg-chat-status-note"><i>${t("UESRPG.Chat.Opposed.ChoicesCommitted", "Choices committed")}</i></div>`;
  })();

  const defenderActions = (() => {
    if (d.result) return "";
    if (!d.committedAt) return `<div class="uesrpg-opposed-action-row">${_btn(t("UESRPG.Chat.Opposed.CommitChoices", "Commit Choices"), "defender-roll")}</div>`;
    return `<div class="uesrpg-chat-status-note"><i>${t("UESRPG.Chat.Opposed.ChoicesCommitted", "Choices committed")}</i></div>`;
  })();

  const unresolved = !data.outcome && String(data?.status ?? "").toLowerCase() !== "resolved";
  const beginRollActions = (bankMode && bothCommitted && unresolved && !a.result && !d.result)
    ? `<div style="margin-top:8px;" data-ues-gm-only="true">${_btn(t("UESRPG.Chat.Opposed.BeginOpposedRoll", "Begin Opposed Roll"), "begin-banked-roll")}</div>`
    : "";

  const outcomeLine = data.outcome
    ? renderOpposedOutcome(_esc(data.outcome.text ?? ""))
    : (() => {
        if (bankMode && !bothCommitted) {
          return `<div class="uesrpg-chat-status-note"><i>${t("UESRPG.Chat.Opposed.WaitingBothCommit", "Waiting for both sides to commit choices...")}</i></div>`;
        }
        const phase = String(data?.context?.phase ?? "pending");
        const waitingSince = Number(data?.context?.waitingSince ?? 0);
        const ageMs = waitingSince ? (Date.now() - waitingSince) : 0;
        const isWaiting = (phase === "waitingDefender");
        const isStale = isWaiting && ageMs > 60_000;
        const note = isStale
          ? `<div style="margin-top:6px; font-size:12px; opacity:0.85;">
               ${t("UESRPG.Chat.Opposed.StillWaitingDefenderResult", "Still waiting on the defender result. If this persists, ensure the defender roll message was posted, and have the attacker refresh the page to re-render the card.")}
             </div>`
          : "";
        return `<div class="uesrpg-chat-status-note"><i>${t("UESRPG.Chat.Status.Pending", "Pending")}</i></div>${note}`;
      })();

  return `<div class="ues-skill-opposed-card uesrpg-chat-surface" data-message-id="${messageId}">
    ${renderOpposedLayout({
      attacker: renderOpposedParticipant({ name: aName, title: t("UESRPG.UI.Actor", "Actor"),
        context: renderParticipantContext([{ label: t("UESRPG.UI.Skill", "Skill"), value: aSkillLabel }]),
        tn: _renderTNLine(aTNLabel, revealDetails ? a.tn : null), roll: _renderRollLine(a.result), actions: attackerActions, compactActions: bankMode && !a.result }),
      defender: renderOpposedParticipant({ role: "defender", name: dName, title: t("UESRPG.Chat.Common.Target", "Target"),
        context: renderParticipantContext([{ label: t("UESRPG.UI.Skill", "Skill"), value: dSkillLabel }]),
        tn: _renderTNLine(dTNLabel, revealDetails ? d.tn : null), roll: _renderRollLine(d.result), actions: defenderActions, compactActions: bankMode && !d.result }),
      after: beginRollActions + outcomeLine
    })}
  </div>`;
}
