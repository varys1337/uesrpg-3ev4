import { escapeHtml } from "../../utils/html.js";
import { t } from "../../utils/i18n.js";

/** Render only the already-projected client-local standalone view. */
export function renderStandaloneDamageDetails(model) {
  const publicDetails = renderRecordedMessageRolls(model.messageRolls);
  if (!model.damageExplanation || model.damageExplanation.source === "unavailable") return publicDetails;
  const report = renderGmDamageReportHtml(model.damageExplanation);
  if (!report) return publicDetails;
  return publicDetails + '<details class="uesrpg-chat-details"><summary>'
    + escapeHtml(t("UESRPG.Chat.DamageExplanation.ApplicationDetails", "Damage details"))
    + '</summary><div class="uesrpg-chat-details__body">' + report + '</div></details>';
}


/** Saved visible message rolls are separate from target application results. */
export function renderRecordedMessageRolls(model) {
  const label = (key, fallback) => escapeHtml(t("UESRPG.Chat.DamageExplanation." + key, fallback));
  const rows = model.filter(roll => roll.formula !== null || roll.total !== null).map(roll =>
    '<div class="uesrpg-chat-kv-row"><span>' + escapeHtml(String(roll.formula ?? "")) + '</span><span>'
    + escapeHtml(String(roll.total ?? "")) + '</span></div>').join("");
  return rows ? '<details class="uesrpg-chat-details"><summary>' + label("MessageRolls", "Rolls")
    + '</summary><div class="uesrpg-chat-details__body">' + rows + '</div></details>' : "";
}


export function renderGmDamageReportHtml(model) {
  const label = (key, fallback) => escapeHtml(t(`UESRPG.Chat.DamageExplanation.${key}`, fallback));
  if (model.source === "unavailable") return "";
  const display = value => escapeHtml(String(value));
  const row = (key, fallback, value) => value == null ? "" : `<div class="uesrpg-chat-kv-row"><span>${label(key, fallback)}</span><span>${display(value)}</span></div>`;
  const nonzeroRow = (key, fallback, value) => value == null || value === 0 ? "" : row(key, fallback, value);
  const resourceRow = (resource, key, fallback) => {
    if (!resource) return "";
    const value = resource.value == null ? null : `${resource.before == null ? "" : `${resource.before} → `}${resource.value}${resource.max == null ? "" : ` / ${resource.max}`}`;
    return row(key, fallback, value);
  };
  const segmentHtml = model.segments.map(segment => {
    const hasModifiers = [segment.dosBonus, segment.weaponBonus, segment.armor, segment.resistance,
      segment.toughness, segment.penetrated, segment.reduction].some(value => value != null && value !== 0);
    if (!hasModifiers && model.segments.length < 2) return "";
    const name = segment.label ?? segment.damageType;
    return `<div class="uesrpg-da-segment uesrpg-chat-damage-segment">
      ${name ? `<div class="uesrpg-chat-damage-note"><b>${display(name)}</b></div>` : ""}
      ${row("Raw", "Raw damage", segment.raw)}
      ${nonzeroRow("DosBonus", "DoS bonus", segment.dosBonus)}
      ${nonzeroRow("WeaponBonus", "Weapon bonus", segment.weaponBonus)}
      ${nonzeroRow("Armor", "Armor after penetration", segment.armor)}
      ${nonzeroRow("Resistance", "Resistance", segment.resistance)}
      ${nonzeroRow("Toughness", "Toughness", segment.toughness)}
      ${nonzeroRow("Penetrated", "Armor penetrated", segment.penetrated)}
      ${nonzeroRow("Reduction", "Total reduction", segment.reduction)}
      ${row("Applied", "After reductions", segment.applied)}
    </div>`;
  }).join("");
  const statusKeys = {
    pending: ["Pending", "Pending"], processing: ["Processing", "Processing"],
    partial: ["NeedsReview", "Needs review"], failed: ["Failed", "Failed"],
    waitingGM: ["WaitingGM", "Waiting for GM"], applied: ["Completed", "Completed"],
  };
  const status = model.status !== "applied" && Object.hasOwn(statusKeys, model.status) ? statusKeys[model.status] : null;
  const tempChanged = model.tempHp && (model.tempHp.absorbed > 0
    || (model.tempHp.before != null && model.tempHp.value != null && model.tempHp.before !== model.tempHp.value));
  const body = `${row("Status", "Status", status ? t(`UESRPG.Chat.DamageExplanation.${status[0]}`, status[1]) : null)}
    ${row("TotalApplied", "Damage after reductions", model.total)}
    ${resourceRow(model.hp, "HP", "HP")}
    ${nonzeroRow("HpLost", "HP lost", model.hp?.delta)}
    ${tempChanged ? resourceRow(model.tempHp, "TempHP", "Temporary HP") : ""}
    ${nonzeroRow("TempAbsorbed", "Temporary HP absorbed", model.tempHp?.absorbed)}
    ${model.buffers.map(buffer => {
    if (!(buffer.absorbed > 0)) return "";
    const name = buffer.pool ? `${display(buffer.pool)} ${label("Buffer", "buffer")}` : label("Buffer", "Buffer");
    return `<div class="uesrpg-chat-kv-row"><span>${name} — ${label("Absorbed", "absorbed")}</span><span>${display(buffer.absorbed)}</span></div>${buffer.remaining == null ? "" : `<div class="uesrpg-chat-kv-row"><span>${name} — ${label("Remaining", "remaining")}</span><span>${display(buffer.remaining)}</span></div>`}`;
  }).join("")}
    ${model.woundTriggered === true ? `<div class="uesrpg-chat-status-note">${label("Wounded", "Wounded")}${model.woundThreshold == null ? "" : ` (${label("WoundThresholdShort", "threshold")} ${display(model.woundThreshold)})`}</div>` : ""}
    ${model.defeated === true ? `<div class="uesrpg-chat-status-note">${label("Defeated", "Defeated / unconscious")}</div>` : ""}
    ${segmentHtml}`;
  return body.trim() ? `<div class="uesrpg-gm-damage-breakdown uesrpg-chat-details-panel"><div class="uesrpg-chat-details-panel__title">${label("GmTitle", "Target outcome")}</div>${body}</div>` : "";
}

