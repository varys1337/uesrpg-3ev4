import { customDialog } from "../../utils/dialog-v2-helper.js";
import { canUserActOnLuckActor, createLuckUuidResolver, resolveLuckActor } from "./actor-resolution.js";
import { classifyLuckMessage } from "./message-classification.js";

export function escapeLuckHtml(str) {
  const raw = String(str ?? "");
  try {
    return foundry.utils.escapeHTML(raw);
  } catch (_err) {
    return raw;
  }
}

export async function pickLuckSide(info, opts = {}) {
  if (!info) return null;
  const resolver = opts.resolver ?? createLuckUuidResolver();
  const classifyMessage = opts.classifyMessage ?? classifyLuckMessage;
  const canMutateLuckResult = opts.canMutateLuckResult ?? (() => ({ ok: true }));
  const eligible = info.sides.filter((side) => {
    if (!side.actorUuid) return false;
    const actor = resolveLuckActor(side.actorUuid, resolver);
    if (!canUserActOnLuckActor(actor)) return false;
    if (opts.requireResult && !side.result) return false;
    if (opts.requireFailure && (side.result?.isSuccess !== false || !side.result)) return false;
    if (opts.requireSuccess && (side.result?.isSuccess !== true || !side.result)) return false;
    const liveMessage = opts.message ?? null;
    if (!liveMessage) return true;
    return canMutateLuckResult(liveMessage, info, side, { classifyMessage }).ok;
  });
  if (!eligible.length) return null;
  if (eligible.length === 1) return eligible[0];

  const optionRows = eligible.map((side, index) => {
    const roleName = side.role === "attacker" ? "Attacker" : side.role === "defender" ? "Defender" : "Roller";
    const deg = side.result ? (side.result.isSuccess ? `${side.result.degree} DoS` : `${side.result.degree} DoF`) : "-";
    return `<option value="${index}">${roleName}: ${escapeLuckHtml(side.label)} (${deg})</option>`;
  }).join("");

  return new Promise((resolve) => {
    customDialog({
      title: "Choose Side",
      content: `<div class="uesrpg" style="padding:8px;"><p>Which side should receive the Luck effect?</p><select name="selected-side" style="width:100%;">${optionRows}</select></div>`,
      buttons: {
        ok: {
          label: "Confirm",
          icon: "fas fa-check",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const idx = Number(root?.querySelector('select[name="selected-side"]')?.value ?? 0);
            resolve(eligible[idx] ?? null);
          }
        },
        cancel: { label: "Cancel", icon: "fas fa-times", callback: () => resolve(null) }
      },
      default: "ok",
      width: 400,
    }).catch(() => resolve(null));
  });
}
