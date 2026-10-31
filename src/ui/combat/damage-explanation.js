import { escapeHtml } from "../../utils/html.js";
import { t } from "../../utils/i18n.js";

/** Render only the already-projected client-local standalone view. */
export function renderStandaloneDamageDetails(model) {
  const publicDetails = renderRecordedMessageRolls(model.messageRolls);
  if (!model.damageExplanation) return publicDetails;
  return publicDetails + '<details class="uesrpg-chat-details"><summary>'
    + escapeHtml(t("UESRPG.Chat.DamageExplanation.GmTitle", "Recorded target application"))
    + '</summary><div class="uesrpg-chat-details__body">' + renderGmDamageReportHtml(model.damageExplanation) + '</div></details>';
}


/** Saved visible message rolls are separate from target application results. */
export function renderRecordedMessageRolls(model) {
  const label = (key, fallback) => escapeHtml(t("UESRPG.Chat.DamageExplanation." + key, fallback));
  const missing = label("NotRecorded", "Not recorded");
  const display = value => value === null ? missing : escapeHtml(String(value));
  const rows = model.map(roll => '<div class="uesrpg-chat-kv-row"><span>' + display(roll.formula) + '</span><span>' + display(roll.total) + '</span></div>').join("");
  return '<details class="uesrpg-chat-details"><summary>' + label("MessageRolls", "Recorded message rolls")
    + '</summary><div class="uesrpg-chat-details__body"><p>' + label("MessageRollHint", "Saved rolls are separate from target application results.")
    + '</p>' + (rows || '<p>' + missing + '</p>') + '</div></details>';
}


export function renderGmDamageReportHtml(model) {
  const label = (key, fallback) => escapeHtml(t(`UESRPG.Chat.DamageExplanation.${key}`, fallback));
  const missing = label("NotRecorded", "Not recorded");
  if (model.source === "unavailable") return `<div class="uesrpg-gm-damage-breakdown uesrpg-chat-details-panel"><div class="uesrpg-chat-details-panel__title">${label("GmTitle", "Recorded target application")}</div><p class="uesrpg-chat-damage-note">${missing}</p></div>`;
  const display = value => value === null ? missing : escapeHtml(String(value));
  const row = (key, fallback, value) => `<div class="uesrpg-chat-kv-row"><span>${label(key, fallback)}</span><span>${display(value)}</span></div>`;
  const resourceRows = (resource, key, fallback) => !resource ? "" : `
    <div class="uesrpg-chat-damage-note"><b>${label(key, fallback)}</b></div>
    ${row("Before", "Before", resource.before)}
    ${row("After", "Recorded final value", resource.value)}
    ${row("Maximum", "Maximum", resource.max)}
    ${row("RecordedLoss", "Recorded loss", resource.delta)}
    ${resource.absorbed === null ? "" : row("Absorbed", "Absorbed", resource.absorbed)}`;
  const segmentHtml = model.segments.map(segment => `<div class="uesrpg-da-segment uesrpg-chat-damage-segment">
    <div class="uesrpg-chat-damage-segment__summary"><b>${display(segment.label ?? segment.damageType)}</b><span>${label("DamageType", "Damage type")} ${display(segment.damageType)}</span></div>
    ${row("Raw", "Recorded raw damage", segment.raw)}
    ${row("DosBonus", "DoS bonus", segment.dosBonus)}
    ${row("WeaponBonus", "Weapon bonus", segment.weaponBonus)}
    ${row("Armor", "Armor after penetration", segment.armor)}
    ${row("Resistance", "Resistance", segment.resistance)}
    ${row("Toughness", "Toughness", segment.toughness)}
    ${row("Penetrated", "Armor penetrated", segment.penetrated)}
    ${row("Reduction", "Total reduction", segment.reduction)}
    ${row("FinalDamage", "Damage after reductions", segment.finalDamage)}
    ${row("Applied", "Applied component", segment.applied)}
  </div>`).join("");
  const statusKeys = {
    pending: ["Pending", "Pending"], processing: ["Processing", "Processing"],
    partial: ["NeedsReview", "Needs review"], failed: ["Failed", "Failed"],
    waitingGM: ["WaitingGM", "Waiting for GM"], applied: ["Completed", "Completed"],
  };
  const status = Object.hasOwn(statusKeys, model.status) ? statusKeys[model.status] : null;
  return `<div class="uesrpg-gm-damage-breakdown uesrpg-chat-details-panel">
    <div class="uesrpg-chat-details-panel__title">${label("GmTitle", "Recorded target application")}</div>
    <p class="uesrpg-chat-damage-note">${label(model.source === "historical" ? "HistoricalHint" : "EvidenceHint", model.source === "historical"
      ? "Stored historical report; original input provenance may be incomplete."
      : "Saved calculation evidence only. Missing inputs are not reconstructed.")}</p>
    ${row("Status", "Application status", status ? t(`UESRPG.Chat.DamageExplanation.${status[0]}`, status[1]) : null)}
    ${row("TotalApplied", "Recorded application damage", model.total)}
    ${row("HitLocation", "Hit location", model.hitLocation)}
    ${resourceRows(model.hp, "HP", "HP")}
    ${resourceRows(model.tempHp, "TempHP", "Temporary HP")}
    ${model.buffers.map(buffer => `<div class="uesrpg-chat-damage-note"><b>${label("Buffer", "Buffer")} ${display(buffer.pool)}</b></div>${row("Remaining", "Remaining", buffer.remaining)}${row("Absorbed", "Absorbed", buffer.absorbed)}`).join("")}
    ${model.woundTriggered === true ? row("WoundThreshold", "Recorded wound threshold", model.woundThreshold) : ""}
    ${model.defeated === true ? `<div class="uesrpg-chat-status-note">${label("Defeated", "Recorded defeated / unconscious state")}</div>` : ""}
    ${segmentHtml || `<div class="uesrpg-chat-damage-note">${missing}</div>`}
    <p class="uesrpg-chat-damage-note">${label("AttributionHint", "Missing input sources are not reconstructed.")}</p>
  </div>`;
}

