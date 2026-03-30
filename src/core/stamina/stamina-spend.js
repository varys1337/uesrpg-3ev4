import { createOrUpdateStatusEffect } from "../active-effects/status-effect.js";
import { requestDeleteEmbeddedDocuments, requestAtomicUpdateDocument } from "../../utils/authority-proxy.js";
import { canUseHeroicActions } from "../rules/npc-rules.js";
import { isActorUndead } from "../traits/trait-registry.js";
import { hasTalent } from "../traits/talents-api.js";
import { SYSTEM_ID } from "../constants.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { getStaminaIcon } from "./stamina-options.js";

function esc(value) {
  const raw = String(value ?? "");
  if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(raw);
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function spendFromPools({ sp = 0, temp = 0, cost = 0 } = {}) {
  let remainingCost = Math.max(0, Number(cost ?? 0) || 0);
  let newTemp = Number(temp ?? 0) || 0;
  let newSp = Number(sp ?? 0) || 0;

  if (remainingCost > 0 && newTemp > 0) {
    const tempConsumed = Math.min(newTemp, remainingCost);
    newTemp -= tempConsumed;
    remainingCost -= tempConsumed;
  }

  if (remainingCost > 0) {
    newSp -= remainingCost;
  }

  return {
    newSp,
    newTemp,
    tempConsumed: Math.max(0, (Number(temp ?? 0) || 0) - newTemp),
    regularConsumed: Math.max(0, (Number(sp ?? 0) || 0) - newSp)
  };
}

async function spendHeroicAction(actor, option, cost) {
  if (!canUseHeroicActions(actor)) {
    ui.notifications.warn("Heroic Actions require the Elite trait for NPCs.");
    return;
  }

  const combat = game.combat;
  const isInCombat = Boolean(combat?.started);
  const currentRound = isInCombat ? Number(combat.round ?? 0) : null;

  const chatMeta = { currentAP: 0, newAP: 0, newSP: 0, newTemp: 0, maxSP: 0 };
  let heroicBlocked = false;

  const ok = await requestAtomicUpdateDocument(actor.uuid ?? actor, (freshActor) => {
    const freshSP = Number(freshActor.system?.stamina?.value ?? 0);
    const freshTemp = Number(freshActor.system?.stamina?.temp ?? 0);
    const freshAP = Number(freshActor.system?.action_points?.value ?? 0);
    const freshMaxAP = Number(freshActor.system?.action_points?.max ?? 0);

    if (isActorUndead(freshActor) && (freshSP + freshTemp - cost) < 0) {
      heroicBlocked = true;
      return null;
    }

    const updates = {};
    if (isInCombat && currentRound !== null) {
      const lastUsedRound = freshActor.getFlag(SYSTEM_ID, "heroicActionLastRound");
      if (lastUsedRound === currentRound) {
        heroicBlocked = true;
        return null;
      }
      updates[`flags.${SYSTEM_ID}.heroicActionLastRound`] = currentRound;
    }

    const { newSp, newTemp } = spendFromPools({ sp: freshSP, temp: freshTemp, cost });
    chatMeta.currentAP = freshAP;
    chatMeta.newAP = Math.min(freshAP + 1, freshMaxAP);
    chatMeta.newSP = newSp;
    chatMeta.newTemp = newTemp;
    chatMeta.maxSP = Number(freshActor.system?.stamina?.max ?? 0);

    updates["system.stamina.temp"] = newTemp;
    updates["system.stamina.value"] = newSp;
    updates["system.action_points.value"] = chatMeta.newAP;
    return updates;
  });

  if (heroicBlocked) {
    if (isActorUndead(actor) && (Number(actor.system?.stamina?.value ?? 0) + Number(actor.system?.stamina?.temp ?? 0) - cost) < 0) {
      ui.notifications?.warn?.("Undead cannot spend Stamina below 0.");
    } else {
      ui.notifications.warn("Heroic Action can only be used once per round.");
    }
    return;
  }
  if (!ok) return;

  const { currentAP, newAP, newSP, newTemp, maxSP } = chatMeta;
  const tempConsumedTotal = Number(actor.system?.stamina?.temp ?? 0) - newTemp;
  const regularConsumedTotal = Number(actor.system?.stamina?.value ?? 0) - newSP;
  const remainingSPDisplay = newSP + (newTemp > 0 ? ` (+${newTemp} temp)` : "");

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg-stamina-card">
      <h3>Stamina: ${esc(option.name)}</h3>
      <p><b>Cost:</b> ${cost} SP ${tempConsumedTotal > 0 ? `(${tempConsumedTotal} temp, ${regularConsumedTotal} regular)` : ""}</p>
      <p><b>Effect:</b> Regained 1 Action Point (${currentAP} -> ${newAP})</p>
      <p><b>Remaining SP:</b> ${remainingSPDisplay} / ${maxSP}</p>
      ${isInCombat ? '<p class="uesrpg-stamina-note">Can only be used once per round in combat.</p>' : ""}
    </div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });

  ui.notifications.info(`${option.name}: Regained 1 AP`);
}

async function spendPersistentEffect(actor, option, cost, spAmount) {
  const chatMeta = { newSP: 0, newTemp: 0, currentSP: 0, currentTemp: 0 };
  let spendBlocked = false;

  const ok = await requestAtomicUpdateDocument(actor.uuid ?? actor, (freshActor) => {
    const freshSP = Number(freshActor.system?.stamina?.value ?? 0);
    const freshTemp = Number(freshActor.system?.stamina?.temp ?? 0);

    if (isActorUndead(freshActor) && (freshSP + freshTemp - cost) < 0) {
      spendBlocked = true;
      return null;
    }

    const { newSp, newTemp } = spendFromPools({ sp: freshSP, temp: freshTemp, cost });
    chatMeta.currentSP = freshSP;
    chatMeta.currentTemp = freshTemp;
    chatMeta.newSP = newSp;
    chatMeta.newTemp = newTemp;
    return { "system.stamina.temp": newTemp, "system.stamina.value": newSp };
  });

  if (spendBlocked) {
    ui.notifications?.warn?.("Undead cannot spend Stamina below 0.");
    return;
  }
  if (!ok) return;

  const existing = actor.effects.find((effect) =>
    !effect.disabled && getFlagValueWithFallback(effect, "key") === option.effectKey
  );
  if (existing) {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [existing.id]);
  }

  const effectData = {
    name: option.name,
    statusId: null,
    img: getStaminaIcon(option.id),
    duration: {},
    flags: {
      [FLAG_SCOPE]: {
        key: option.effectKey,
        spentSP: cost,
        consumeOn: option.consumeOn,
        description: option.description
      }
    },
    changes: []
  };

  if (option.allowAmount) {
    const multiplier = hasTalent(actor, "killingblow") ? 3 : 2;
    const damageBonus = spAmount * multiplier;
    if (option.id === "power-attack" && hasTalent(actor, "killingblow")) {
      effectData.flags[FLAG_SCOPE].description = "+3 damage per SP spent (max +9), spend before damage roll";
    }
    effectData.flags[FLAG_SCOPE].damageBonus = damageBonus;
    effectData.changes.push({
      key: "system.modifiers.combat.damage.dealt",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: String(damageBonus),
      priority: 20
    });
  }

  if (option.id === "physical-exertion") {
    effectData.changes.push({
      key: "system.modifiers.skills.physicalExertion",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: "20",
      priority: 20
    });
  }

  await createOrUpdateStatusEffect(actor, effectData);

  const { newSP, newTemp, currentSP, currentTemp } = chatMeta;
  const tempConsumedTotal = currentTemp - newTemp;
  const regularConsumedTotal = currentSP - newSP;
  const remainingSPDisplay = newSP + (newTemp > 0 ? ` (+${newTemp} temp)` : "");
  const maxSP = actor.system?.stamina?.max ?? 0;

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg-stamina-card">
      <h3>Stamina: ${esc(option.name)}</h3>
      <p><b>Cost:</b> ${cost} SP ${tempConsumedTotal > 0 ? `(${tempConsumedTotal} temp, ${regularConsumedTotal} regular)` : ""}</p>
      <p><b>Effect:</b> ${esc(effectData.flags[FLAG_SCOPE].description)}</p>
      ${option.allowAmount ? `<p><b>Damage Bonus:</b> +${effectData.flags[FLAG_SCOPE].damageBonus}</p>` : ""}
      <p><b>Remaining SP:</b> ${remainingSPDisplay} / ${maxSP}</p>
      <p class="uesrpg-stamina-note">Effect will persist until consumed by the appropriate action.</p>
    </div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });

  ui.notifications.info(`${option.name} effect active (${cost} SP spent)`);
}

export async function spendStaminaOption(actor, option, spAmount = 1) {
  const cost = option.allowAmount ? spAmount : option.cost;
  if (option.immediate) {
    await spendHeroicAction(actor, option, cost);
    return;
  }
  await spendPersistentEffect(actor, option, cost, spAmount);
}
