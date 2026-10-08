import { t, tf } from "../../../utils/i18n.js";
import { escapeHtml } from "../../../utils/html.js";
import { formatResultSummary } from "../../../utils/degree-roll-helper.js";
import { systemTooltipAttributes } from "../../../ui/shared/system-tooltips.js";

/** Shared markup; each workflow supplies its own breakdown rows and TN policy. */
export function renderTargetNumberLine(tnLabel, rows = "") {
  if (!rows) return `<div class="uesrpg-opposed-stat"><b>${t("UESRPG.Chat.Common.TN", "TN")}:</b> ${tnLabel}</div>`;
  return `
    <details class="uesrpg-chat-details uesrpg-chat-details--tn">
      <summary>
        <b>${t("UESRPG.Chat.Common.TN", "TN")}:</b> ${tnLabel}
      </summary>
      <div class="uesrpg-chat-details__body">${rows}</div>
    </details>
  `;
}

/** Presentation only: callers retain their own reveal, TN and result policies. */
export function renderResultSummary(result) {
  if (!result) return "";
  const cls = result.isSuccess ? "is-success" : "is-failure";
  return `<span class="uesrpg-chat-result ${cls}">${formatResultSummary(result, { includeDegree: true, degreeStyle: "paren" })}</span>`;
}

export function renderRollSummary(total, result, { automatic = false } = {}) {
  const value = automatic ? t("UESRPG.Chat.Common.Automatic", "Automatic") : total;
  return `<div class="uesrpg-opposed-stat uesrpg-opposed-stat--roll"><b>${t("UESRPG.Chat.Common.Roll", "Roll")}:</b> ${escapeHtml(String(value ?? "??"))}</div>${automatic ? "" : renderResultSummary(result)}`;
}

/** Collapse only identical context values; labels remain available to assistive technology. */
export function renderParticipantContext(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const value = String(row?.value ?? "").trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  }).map(({ label = "", value }) => `<span class="uesrpg-opposed-context-item"><span class="uesrpg-chat-sr-only">${escapeHtml(label)}: </span>${escapeHtml(String(value))}</span>`).join("");
}

/** All fragment arguments are prepared, reveal-filtered markup from the owning workflow. */
export function renderOpposedParticipant({
  role = "attacker", name = "", title = "", context = "", tn = "", roll = "",
  status = "", actions = "", extra = "", aftermath = "", defenderCard = false, compactActions = false
} = {}) {
  const defender = role === "defender";
  const cls = defenderCard ? "uesrpg-opposed-defender-card" : `uesrpg-opposed-lane uesrpg-opposed-lane--${defender ? "defender" : "attacker"}`;
  const contextRow = context ? `<div class="uesrpg-opposed-context">${context}</div>` : "";
  const metrics = `<div class="uesrpg-opposed-metrics">${tn}${roll}</div>`;
  return `<section class="${cls}${compactActions ? " uesrpg-opposed-lane--pending" : ""}">
    <div class="uesrpg-opposed-participant">
    <div class="uesrpg-opposed-participant-top">
    <div class="uesrpg-opposed-lane-header" ${systemTooltipAttributes({ text: title })}>
      <span class="uesrpg-opposed-lane-icon" aria-hidden="true"><i class="fa-solid ${defender ? "fa-shield-halved" : "fa-crosshairs"}"></i></span>
      <div class="uesrpg-opposed-identity"><span class="uesrpg-opposed-lane-name">${escapeHtml(String(name ?? ""))}</span>
        ${compactActions ? `<div class="uesrpg-opposed-pending-meta">${contextRow}${metrics}</div>` : contextRow}
      </div>
    </div>
    ${compactActions && actions ? `<div class="uesrpg-opposed-commit-actions">${actions}</div>` : ""}
    </div>
    ${compactActions ? "" : metrics}
    ${status}${compactActions ? "" : actions}${extra}
    </div>
    ${aftermath}
  </section>`;
}

export function renderOpposedLayout({ attacker = "", defender = "", defenders = "", after = "" } = {}) {
  if (defenders) return `<div class="uesrpg-opposed-stack">${attacker}<div class="uesrpg-opposed-defenders">${defenders}</div></div>${after}`;
  return `<div class="uesrpg-opposed-duel-grid">${attacker}${defender}</div>${after}`;
}

export function renderOpposedOutcome(text) {
  return `<div class="uesrpg-chat-outcome"><b>${t("UESRPG.Chat.Common.Outcome", "Outcome")}:</b> ${text ?? ""}</div>`;
}

/** A status notice belongs below the identity, never inside the action column. */
export function renderParticipantNotice(text) {
  return text ? `<div class="uesrpg-chat-status-note"><i>${escapeHtml(String(text))}</i></div>` : "";
}

export function renderUnavailableCommitNotice({ active, gate, kind = "defense" } = {}) {
  if (!active || gate?.allowed !== false) return "";
  const labels = {
    attack: ["UESRPG.Chat.Opposed.AttackUnavailable", "Attack unavailable"],
    casting: ["UESRPG.Chat.Magic.CastingUnavailable", "Casting unavailable"],
    defense: ["UESRPG.Chat.Opposed.DefenseUnavailable", "Defense unavailable"]
  };
  const [key, label] = labels[kind] ?? labels.defense;
  const reason = String(gate.reason ?? t("UESRPG.UI.Unavailable", "Unavailable"));
  return renderParticipantNotice(tf(key, { reason }, `${label}: ${reason}`));
}

export function renderAutomaticNoDefenseNotice(defender) {
  return defender?.noDefense && defender?.banked?.reason === "insufficient-ap"
    ? renderParticipantNotice(t("UESRPG.Chat.Opposed.AutoNoDefenseAP", "No Defense selected — insufficient AP.")) : "";
}

export function renderCommitWaitingStatus({ attackerCommitted, defendersCommitted } = {}) {
  const text = attackerCommitted
    ? t("UESRPG.Chat.Opposed.WaitingDefendersCommit", "Waiting for all defenders to commit choices.")
    : defendersCommitted
      ? t("UESRPG.Chat.Opposed.WaitingAttackerCommit", "Waiting for the attacker to commit choices...")
      : t("UESRPG.Chat.Opposed.WaitingBothCommit", "Waiting for both sides to commit choices...");
  return renderParticipantNotice(text);
}

export function variantLabel(variant) {
  switch (variant) {
    case "allOut": return "All Out";
    case "precision": return "Precision";
    case "coup": return "Coup";
    case "normal":
    default: return "Attack";
  }
}
