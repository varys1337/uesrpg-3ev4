import { SYSTEM_ID } from "../constants.js";
import { requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { getFlagValueWithFallback, getSystemFlagsWithFallback } from "../system/flags.js";

/**
 * Stamina effect key constants to avoid typos.
 */
export const STAMINA_EFFECT_KEYS = {
  PHYSICAL_EXERTION: "stamina-physical-exertion",
  SPRINT: "stamina-sprint",
  POWER_DRAW: "stamina-power-draw",
  POWER_ATTACK: "stamina-power-attack",
  POWER_BLOCK: "stamina-power-block",
  HEROIC_ACTION: "stamina-heroic-action",
  HEROIC_USED: "stamina-heroic-used-this-round",
};

function _esc(value) {
  const raw = String(value ?? "");
  if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(raw);
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Check if actor has a specific stamina effect active.
 * @param {Actor} actor
 * @param {string} effectKey
 * @returns {ActiveEffect|null}
 */
export function getActiveStaminaEffect(actor, effectKey) {
  if (!actor) return null;
  return actor.effects.find((e) => {
    if (!e || e.disabled) return false;
    const keyA = String(getFlagValueWithFallback(e, "key") ?? "").trim();
    const keyB = String(e?.flags?.[SYSTEM_ID]?.key ?? "").trim();
    return keyA === effectKey || keyB === effectKey;
  }) || null;
}

/**
 * Consume a stamina effect and post chat message.
 * @param {Actor} actor
 * @param {string} effectKey
 * @param {Object} context
 * @returns {Promise<Object|null>}
 */
export async function consumeStaminaEffect(actor, effectKey, context = {}) {
  const effect = getActiveStaminaEffect(actor, effectKey);
  if (!effect) return null;

  const effectFlags = getSystemFlagsWithFallback(effect) || effect.flags?.[SYSTEM_ID] || {};
  const effectName = effect.name || "Stamina Effect";
  const bonus = effectFlags.damageBonus || 0;
  const description = effectFlags.description || "";

  await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg-stamina-consumed">
      <h3>Stamina Effect Consumed: ${_esc(effectName)}</h3>
      <p><b>Effect:</b> ${_esc(description)}</p>
      ${bonus > 0 ? `<p><b>Bonus Applied:</b> +${bonus} damage</p>` : ""}
      ${context.bonus ? `<p><b>Bonus Applied:</b> ${_esc(context.bonus)}</p>` : ""}
      ${context.message ? `<p>${_esc(context.message)}</p>` : ""}
    </div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });

  return {
    name: effectName,
    bonus,
    description,
    flags: effectFlags
  };
}
