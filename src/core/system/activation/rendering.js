import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import { SYSTEM_ID } from "../system-id.js";
import {
  firstNonEmptyString,
  getActivationCostValues,
  normalizeUsage,
  formatUsagePeriod
} from "./helpers.js";
import { getActivationActionTypeLabel } from "./costs-and-usage.js";

function buildActivationHeader({ label, img, actor, includeImage }) {
  const title = String(label ?? "Activation");
  const header = includeImage && img
    ? `<h2><img src="${img}" />${title}</h2>`
    : `<h2>${title}</h2>`;
  const actorLine = actor ? `<div class="uesrpg-activation-actor"><i>${actor.name}</i></div>` : "";
  return `${header}
  ${actorLine}`;
}

function buildActivationCostsHtml(costs) {
  const parts = [];
  const { ap, sp, mp, lp, hp } = getActivationCostValues(costs);
  if (ap) parts.push(`AP: ${ap}`);
  if (sp) parts.push(`SP: ${sp}`);
  if (mp) parts.push(`MP: ${mp}`);
  if (lp) parts.push(`LP: ${lp}`);
  if (hp) parts.push(`HP: ${hp}`);
  return parts.length
    ? `<div class="uesrpg-activation-costs"><b>Costs:</b> ${parts.join(", ")}</div>`
    : "";
}

function buildItemDescriptionHtml({ item, includeImage }) {
  if (!item) return "";
  if (includeImage) {
    return `<h2><img src="${item.img}" />${item.name}</h2>
    <i><b>${item.type}</b></i><p>
      <i>${item.system.description}</i>`;
  }
  return `<h2>${item.name}</h2><p>
  <i><b>${item.type}</b></i><p>
    <i>${item.system.description}</i>`;
}

export function renderActivationCard({
  item = null,
  actor = null,
  activation = {},
  label = "",
  includeImage = false,
  usageOverride = null,
  textOverride = null,
  resultNotes = []
} = {}) {
  const renderSimple = Boolean(item && activation?.renderFullCard !== true);
  if (renderSimple) {
    const baseHtml = buildItemDescriptionHtml({ item, includeImage });
    const notes = Array.isArray(resultNotes)
      ? resultNotes.map((note) => String(note ?? "").trim()).filter(Boolean)
      : [];
    if (!notes.length) return baseHtml;
    return `${baseHtml}
    <div class="uesrpg-activation-results" style="margin-top:8px;padding:8px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;background:rgba(0,0,0,0.03);">
      <div><b>Result</b></div>
      <ul style="margin:6px 0 0 18px;">${notes.map((note) => `<li>${foundry.utils.escapeHTML(note)}</li>`).join("")}</ul>
    </div>`;
  }

  const header = buildActivationHeader({
    label: label || item?.name || "Activation",
    img: item?.img ?? null,
    actor,
    includeImage
  });
  const actionType = getActivationActionTypeLabel(activation?.actionType ?? "action");
  const typeLine = item?.type
    ? `<div class="uesrpg-activation-type"><i><b>${item.type}</b></i></div>`
    : "";
  const costsHtml = buildActivationCostsHtml(activation.costs ?? {});

  const usage = normalizeUsage(activation);
  const usageCurrent = (usageOverride && usageOverride.consumed && usageOverride.current != null)
    ? usageOverride.current
    : usage.current;
  const usageMax = usage.max;
  const usagePeriod = formatUsagePeriod(usage.period);

  let usesHtml = "";
  if (usageMax != null && usageMax > 0) {
    usesHtml = `<div class="uesrpg-activation-uses"><b>Uses:</b> ${usageCurrent}/${usageMax}</div>`;
  } else if (usageCurrent > 0) {
    usesHtml = `<div class="uesrpg-activation-uses"><b>Uses:</b> ${usageCurrent}</div>`;
  }
  const resetHtml = usagePeriod
    ? `<div class="uesrpg-activation-reset"><b>Reset:</b> ${usagePeriod}</div>`
    : "";

  const textBlock = textOverride ?? {};
  const shortText = firstNonEmptyString(textBlock.short, activation?.text?.short);
  const fullText = firstNonEmptyString(textBlock.full, activation?.text?.full, item?.system?.description);
  const notes = Array.isArray(resultNotes)
    ? resultNotes.map((note) => String(note ?? "").trim()).filter(Boolean)
    : [];

  const shortHtml = shortText ? `<div class="uesrpg-activation-summary"><i>${shortText}</i></div>` : "";
  const fullHtml = fullText ? `<div class="uesrpg-activation-desc"><i>${fullText}</i></div>` : "";
  const notesHtml = notes.length
    ? `<div class="uesrpg-activation-results" style="margin-top:8px;padding:8px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;background:rgba(0,0,0,0.03);">
      <div><b>Result</b></div>
      <ul style="margin:6px 0 0 18px;">${notes.map((note) => `<li>${foundry.utils.escapeHTML(note)}</li>`).join("")}</ul>
    </div>`
    : "";

  return `${header}
  ${typeLine}
  <div class="uesrpg-activation-meta"><b>Activation:</b> ${actionType}</div>
  ${costsHtml}
  ${usesHtml}
  ${resetHtml}
  ${shortHtml}
  <hr />
  ${fullHtml}
  ${notesHtml}`;
}

export async function appendActivationResultToMessage(message, {
  item = null,
  actor = null,
  activation = {},
  label = "",
  includeImage = false,
  usageOverride = null,
  note = ""
} = {}) {
  const text = String(note ?? "").trim();
  if (!message || !text) return false;
  const existingNotes = foundry.utils.getProperty(message, `flags.${SYSTEM_ID}.activationCard.resultNotes`);
  const notes = Array.isArray(existingNotes)
    ? existingNotes.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
  notes.push(text);
  const resultNotes = notes.slice(-8);
  return safeUpdateChatMessage(message, {
    content: renderActivationCard({
      item,
      actor,
      activation,
      label,
      includeImage,
      usageOverride,
      resultNotes
    }),
    [`flags.${SYSTEM_ID}.activationCard.resultNotes`]: resultNotes
  });
}
