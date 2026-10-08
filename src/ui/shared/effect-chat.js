import { getEffectDropRestriction } from "../../core/active-effects/drop-eligibility.js";
import { t } from "../../utils/i18n.js";
import { setSystemTooltip } from "./system-tooltips.js";

/** Use native content links so chat, popouts and enriched journal content share drag data. */
export function renderEffectLinks(effects, { eligibleOnly = true } = {}) {
  const links = [];
  for (const effect of effects ?? []) {
    const restriction = getEffectDropRestriction(effect);
    if (!effect?.uuid || (eligibleOnly && restriction)) continue;
    const label = t(`UESRPG.EffectTransfer.${effect.parent?.documentName === "Actor" ? "MoveLabel" : "ApplyLabel"}`);
    const anchor = effect.toAnchor();
    anchor.draggable = true;
    anchor.classList.add("uesrpg-effect-link");
    setSystemTooltip(anchor, {
      text: restriction ? t(`UESRPG.EffectTransfer.${restriction}`) : `${label}: ${effect.name}`,
      ariaLabel: `${label}: ${effect.name}`,
    });
    links.push(`<div class="uesrpg-effect-link-row"><span>${foundry.utils.escapeHTML(label)}:</span> ${anchor.outerHTML}</div>`);
  }
  return links.length ? `<div class="uesrpg-effect-links">${links.join("")}</div>` : "";
}

export async function postEffectToChat(effect) {
  if (!effect?.parent?.testUserPermission(game.user, "OBSERVER")) return null;
  const actor = effect.parent.documentName === "Actor" ? effect.parent : effect.parent.actor;
  const content = `<div class="uesrpg-chat-card uesrpg-effect-card"><h2><img src="${foundry.utils.escapeHTML(effect.img ?? "icons/svg/aura.svg")}" alt="" />${foundry.utils.escapeHTML(effect.name)}</h2><div>${effect.description ?? ""}</div>${renderEffectLinks([effect], { eligibleOnly: false })}</div>`;
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}
