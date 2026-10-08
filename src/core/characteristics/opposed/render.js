import { renderTargetNumberLine, renderRollSummary, renderOpposedParticipant, renderParticipantContext, renderOpposedLayout, renderOpposedOutcome } from "../../opposed/shared/card-rendering.js";
/**
 * src/core/characteristics/opposed/render.js
 * Card HTML rendering for characteristic opposed workflow
 */

import { _esc } from "./util.js";
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
  return renderTargetNumberLine(tnLabel, _buildBreakdownRows(tnObj));
}

function _extractRollTotal(result) {
  const n = Number(result?.rollTotal ?? result?.total ?? result?.roll?.total ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function _renderRollLine(result) {
  if (!result) return "";
  const total = _extractRollTotal(result);
  const totalText = total == null ? "??" : String(total);
  return renderRollSummary(totalText, result);
}

function _charLabel(key) {
  return CHARACTERISTICS[key] ?? String(key ?? "").toUpperCase();
}

export function _renderCard(data, messageId) {
  const a = data.attacker;
  const d = data.defender;
  const aName = a.tokenName ?? a.name ?? "";
  const dName = d.tokenName ?? d.name ?? "";
  const aCharLabel = _charLabel(a.charKey);
  const dCharLabel = _charLabel(d.charKey ?? "(choose)");

  // Banked mode: hide details until both committed
  const bothCommitted = Boolean(a?.committedAt) && Boolean(d?.committedAt);
  const revealDetails = bothCommitted || data.status === "resolved" || !!data.outcome;

  const aTNLabel = (revealDetails && a.tn) ? `${a.tn.finalTN}` : "-";
  const dTNLabel = (revealDetails && d.tn) ? `${d.tn.finalTN}` : "-";

  const attackerActions = (() => {
    if (a.result) return "";
    if (!a.committedAt) return `<div class="uesrpg-opposed-action-row">${_btn(t("UESRPG.Chat.Opposed.CommitChoices", "Commit Choices"), "attacker-roll")}</div>`;
    return `<div class="uesrpg-chat-status-note"><i>${t("UESRPG.Chat.Opposed.ChoicesCommitted", "Choices committed")}</i></div>`;
  })();

  const defenderActions = (() => {
    if (d.result) return "";
    if (!d.committedAt) return `<div class="uesrpg-opposed-action-row">${_btn(t("UESRPG.Chat.Opposed.CommitChoices", "Commit Choices"), "defender-roll")}</div>`;
    return `<div class="uesrpg-chat-status-note"><i>${t("UESRPG.Chat.Opposed.ChoicesCommitted", "Choices committed")}</i></div>`;
  })();

  const beginRollActions = (bothCommitted && !data.outcome && !data.status && !a.result && !d.result)
    ? `<div style="margin-top:8px;" data-ues-gm-only="true">${_btn(t("UESRPG.Chat.Opposed.BeginOpposedRoll", "Begin Opposed Roll"), "begin-banked-roll")}</div>`
    : "";

  const outcomeLine = data.outcome
    ? renderOpposedOutcome(_esc(data.outcome.text ?? ""))
    : (() => {
        if (!bothCommitted) {
          return `<div class="uesrpg-chat-status-note"><i>${t("UESRPG.Chat.Opposed.WaitingBothCommit", "Waiting for both sides to commit choices...")}</i></div>`;
        }
        return `<div class="uesrpg-chat-status-note"><i>${t("UESRPG.Chat.Status.Pending", "Pending")}</i></div>`;
      })();

  const contextLabel = data.context?.label ? `<div style="margin-bottom:6px; font-size:13px; opacity:0.85;"><b>${t("UESRPG.Chat.Common.Context", "Context")}:</b> ${_esc(data.context.label)}</div>` : "";

  const manualNote = participant => revealDetails && participant.declared?.manualMod
    ? `<div class="uesrpg-chat-secondary">${t("UESRPG.Chat.Common.Manual", "Manual")} ${Number(participant.declared.manualMod) >= 0 ? "+" : ""}${participant.declared.manualMod}</div>` : "";
  return `<div class="ues-char-opposed-card uesrpg-chat-surface" data-message-id="${messageId}">${contextLabel}
    ${renderOpposedLayout({
      attacker: renderOpposedParticipant({ name: aName, title: t("UESRPG.Chat.Opposed.Initiator", "Initiator"),
        context: renderParticipantContext([{ label: t("UESRPG.Chat.Common.Char", "Char"), value: aCharLabel }]),
        tn: _renderTNLine(aTNLabel, revealDetails ? a.tn : null), roll: _renderRollLine(a.result),
        extra: manualNote(a), actions: attackerActions, compactActions: !a.result }),
      defender: renderOpposedParticipant({ role: "defender", name: dName, title: t("UESRPG.Chat.Common.Target", "Target"),
        context: renderParticipantContext([{ label: t("UESRPG.Chat.Common.Char", "Char"), value: dCharLabel }]),
        tn: _renderTNLine(dTNLabel, revealDetails ? d.tn : null), roll: _renderRollLine(d.result),
        extra: manualNote(d), actions: defenderActions, compactActions: !d.result }),
      after: beginRollActions + outcomeLine
    })}
  </div>`;
}
