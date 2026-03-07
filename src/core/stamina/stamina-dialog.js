/**
 * Stamina spending dialog and effect creation.
 * Implements Chapter 1 stamina rules from documentation.
 */

import { createOrUpdateStatusEffect } from "../active-effects/status-effect.js";
import { requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { canUseHeroicActions } from "../rules/npc-rules.js";
import { isActorUndead } from "../traits/trait-registry.js";
import { hasTalent } from "../traits/talents-api.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { SYSTEM_ID, systemRootPath } from "../constants.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { STAMINA_EFFECT_KEYS, getActiveStaminaEffect, consumeStaminaEffect } from "./stamina-effects.js";

export { STAMINA_EFFECT_KEYS, getActiveStaminaEffect, consumeStaminaEffect };

/**
 * Stamina spending options with their costs and descriptions
 */
const STAMINA_OPTIONS = [
  {
    id: "physical-exertion",
    name: "Physical Exertion",
    cost: 1,
    description: "+20 bonus on next STR/END based skill or characteristic test (not Combat Style)",
    effectKey: STAMINA_EFFECT_KEYS.PHYSICAL_EXERTION,
    consumeOn: "str-end-test"
  },
  {
    id: "sprint",
    name: "Sprint",
    cost: 1,
    description: "Next Dash action allows movement up to 2× speed",
    effectKey: STAMINA_EFFECT_KEYS.SPRINT,
    consumeOn: "dash"
  },
  {
    id: "power-draw",
    name: "Power Draw",
    cost: 1,
    description: "Reduce reload time by 1 for next ranged weapon shot",
    effectKey: STAMINA_EFFECT_KEYS.POWER_DRAW,
    consumeOn: "ranged-shot"
  },
  {
    id: "power-attack",
    name: "Power Attack",
    cost: "1-3",
    description: "+2 damage per SP spent (max +6), spend before damage roll",
    effectKey: STAMINA_EFFECT_KEYS.POWER_ATTACK,
    consumeOn: "damage-roll",
    allowAmount: true
  },
  {
    id: "power-block",
    name: "Power Block",
    cost: 1,
    description: "Double shield BR vs physical damage, spend after damage roll",
    effectKey: STAMINA_EFFECT_KEYS.POWER_BLOCK,
    consumeOn: "block"
  },
  {
    id: "heroic-action",
    name: "Heroic Action",
    cost: 1,
    description: "Immediately regain 1 AP (once per round)",
    effectKey: STAMINA_EFFECT_KEYS.HEROIC_ACTION,
    consumeOn: "immediate",
    immediate: true
  }
];

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

function _spendFromPools({ sp = 0, temp = 0, cost = 0 } = {}) {
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
    regularConsumed: Math.max(0, (Number(sp ?? 0) || 0) - newSp),
  };
}

/**
 * Opens the stamina spending dialog and handles the selected action
 * @param {Actor} actor - The actor spending stamina
 * @returns {Promise<void>}
 */
export async function openStaminaDialog(actor) {
  if (!actor) {
    ui.notifications.warn("No actor available for stamina spending.");
    return;
  }

  const currentSP = actor.system?.stamina?.value ?? 0;
  const tempSP = actor.system?.stamina?.temp ?? 0;
  const maxSP = actor.system?.stamina?.max ?? 0;
  const effectiveSP = currentSP + tempSP;

  const allowHeroic = canUseHeroicActions(actor);
  const hasKillingBlow = hasTalent(actor, "killingblow");
  const options = STAMINA_OPTIONS
    .filter(opt => opt.id !== "heroic-action" || allowHeroic)
    .map(opt => {
      if (opt.id !== "power-attack" || !hasKillingBlow) return opt;
      return {
        ...opt,
        description: "+3 damage per SP spent (max +9), spend before damage roll"
      };
    });

  const content = await foundry.applications.handlebars.renderTemplate(`${systemRootPath}/templates/v2/dialogs/stamina-dialog.hbs`, {
    currentSP,
    tempSP,
    maxSP,
    effectiveSP,
    showWarning: effectiveSP <= 0,
    options: options.map(opt => ({
      id: opt.id,
      name: opt.name,
      cost: opt.cost,
      description: opt.description
    }))
  });

  await customDialog({
    title: "Spend Stamina",
    content,
    classes: ["uesrpg-resource-dialog", "uesrpg-resource-dialog--stamina"],
    buttons: {
      spend: {
        label: "Spend",
        callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const selectedId = root?.querySelector('select[name="stamina-action"]')?.value;
          const powerAttackSP = parseInt(root?.querySelector('input[name="power-attack-sp"]')?.value || "1", 10);
          
          if (!selectedId) {
            ui.notifications.warn("Please select a stamina action.");
            return;
          }

          const option = STAMINA_OPTIONS.find(o => o.id === selectedId);
          if (!option) return;

          const spAmount = option.allowAmount ? Math.max(1, Math.min(3, powerAttackSP)) : 1;
          await spendStamina(actor, option, spAmount);
        }
      },
      cancel: {
        label: "Cancel"
      }
    },
    default: "spend",
    render: (event, html) => {
      // Keep helper text and amount visibility synced to selected action.
      const root = html instanceof HTMLElement ? html : html?.element ?? html;
      const select = root?.querySelector('select[name="stamina-action"]');
      const amountDiv = root?.querySelector('.uesrpg-stamina-power-attack');
      const help = root?.querySelector(".uesrpg-stamina-action-help");
      const syncAmount = () => {
        const isPowerAttack = select?.value === "power-attack";
        amountDiv?.classList.toggle("is-hidden", !isPowerAttack);

        const option = select?.selectedOptions?.[0];
        const description = String(option?.dataset?.description ?? "").trim();
        if (help) {
          help.textContent = description || "Choose an action to see details.";
        }
      };
      select?.addEventListener('change', syncAmount);
      syncAmount();
    },
    width: 540
  });
}

/**
 * Spend stamina and create the appropriate effect
 * @param {Actor} actor - The actor spending stamina
 * @param {Object} option - The stamina option selected
 * @param {number} spAmount - Amount of SP to spend (for Power Attack)
 * @returns {Promise<void>}
 */
async function spendStamina(actor, option, spAmount = 1) {
  const cost = option.allowAmount ? spAmount : option.cost;
  const currentSP = actor.system?.stamina?.value ?? 0;
  const currentTemp = actor.system?.stamina?.temp ?? 0;
  const effectiveSP = currentSP + currentTemp;
  
  if (isActorUndead(actor) && (effectiveSP - cost) < 0) {
    ui.notifications?.warn?.("Undead cannot spend Stamina below 0.");
    return;
  }

  // Handle Heroic Action immediately
  if (option.immediate) {
    if (!canUseHeroicActions(actor)) {
      ui.notifications.warn("Heroic Actions require the Elite trait for NPCs.");
      return;
    }
    const currentAP = Number(actor.system?.action_points?.value ?? 0);
    const maxAP = Number(actor.system?.action_points?.max ?? 0);
    
    // Check if in active combat
    const combat = game.combat;
    const isInCombat = combat && combat.started;
    
    const updates = {};
    
    if (isInCombat) {
      // Check for heroic action flag this round
      const currentRound = Number(combat.round ?? 0);
      const lastUsedRound = actor.getFlag(SYSTEM_ID, "heroicActionLastRound");
      
      if (lastUsedRound === currentRound) {
        ui.notifications.warn("Heroic Action can only be used once per round.");
        return;
      }
      
      updates[`flags.${SYSTEM_ID}.heroicActionLastRound`] = currentRound;
    }
    
    const newAP = Math.min(currentAP + 1, maxAP);
    
    const { newSp: newSP, newTemp } = _spendFromPools({ sp: currentSP, temp: currentTemp, cost });
    
    updates["system.stamina.temp"] = newTemp;
    updates["system.stamina.value"] = newSP;
    updates["system.action_points.value"] = newAP;
    
    await requestUpdateDocument(actor, updates);
    
    const tempConsumedTotal = currentTemp - newTemp;
    const regularConsumedTotal = currentSP - newSP;
    const remainingSPDisplay = newSP + (newTemp > 0 ? ` (+${newTemp} temp)` : '');
    const maxSP = actor.system?.stamina?.max ?? 0;
    
    // Post chat message
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="uesrpg-stamina-card">
        <h3>Stamina: ${_esc(option.name)}</h3>
        <p><b>Cost:</b> ${cost} SP ${tempConsumedTotal > 0 ? `(${tempConsumedTotal} temp, ${regularConsumedTotal} regular)` : ''}</p>
        <p><b>Effect:</b> Regained 1 Action Point (${currentAP} -> ${newAP})</p>
        <p><b>Remaining SP:</b> ${remainingSPDisplay} / ${maxSP}</p>
        ${isInCombat ? '<p class="uesrpg-stamina-note">Can only be used once per round in combat.</p>' : ''}
      </div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
    
    ui.notifications.info(`${option.name}: Regained 1 AP`);
    return;
  }

  const { newSp: newSP, newTemp } = _spendFromPools({ sp: currentSP, temp: currentTemp, cost });
  
  // Update stamina
  await requestUpdateDocument(actor, {
    "system.stamina.temp": newTemp,
    "system.stamina.value": newSP
  });

  // Remove any existing effect of the same type (replacing)
  const existing = actor.effects.find(e => 
    !e.disabled && getFlagValueWithFallback(e, "key") === option.effectKey
  );
  if (existing) {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [existing.id]);
  }

  // Create effect with appropriate data
  const effectData = {
    name: option.name,
    statusId: null,
    img: getStaminaIcon(option.id),
    duration: {}, // Empty duration = persists until consumed
    flags: {
      [FLAG_SCOPE]: {
        key: option.effectKey,
        spentSP: cost,
        consumeOn: option.consumeOn,
        description: option.description
      }
    },
    changes: [] // Active Effect modifiers
  };

  // Add Power Attack specific data and Active Effect modifier
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
  
  // Physical Exertion: +20 to STR/END-based skill tests (not Combat Style)
  if (option.id === "physical-exertion") {
    effectData.changes.push({
      key: "system.modifiers.skills.physicalExertion",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: "20",
      priority: 20
    });
  }

  await createOrUpdateStatusEffect(actor, effectData);

  const tempConsumedTotal = currentTemp - newTemp;
  const regularConsumedTotal = currentSP - newSP;
  const remainingSPDisplay = newSP + (newTemp > 0 ? ` (+${newTemp} temp)` : '');
  const maxSP = actor.system?.stamina?.max ?? 0;
  
  // Post chat message
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg-stamina-card">
      <h3>Stamina: ${_esc(option.name)}</h3>
      <p><b>Cost:</b> ${cost} SP ${tempConsumedTotal > 0 ? `(${tempConsumedTotal} temp, ${regularConsumedTotal} regular)` : ''}</p>
      <p><b>Effect:</b> ${_esc(effectData.flags[FLAG_SCOPE].description)}</p>
      ${option.allowAmount ? `<p><b>Damage Bonus:</b> +${effectData.flags[FLAG_SCOPE].damageBonus}</p>` : ''}
      <p><b>Remaining SP:</b> ${remainingSPDisplay} / ${maxSP}</p>
      <p class="uesrpg-stamina-note">Effect will persist until consumed by the appropriate action.</p>
    </div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });

  ui.notifications.info(`${option.name} effect active (${cost} SP spent)`);
}

/**
 * Get appropriate icon for stamina effect
 * @param {string} optionId - The stamina option ID
 * @returns {string} Path to icon
 */
function getStaminaIcon(optionId) {
  const icons = {
    "physical-exertion": "icons/magic/control/buff-strength-muscle-damage-orange.webp",
    "sprint": "icons/magic/movement/trail-streak-zigzag-yellow.webp",
    "power-draw": "icons/weapons/ammunition/arrow-head-war-grey.webp",
    "power-attack": "icons/skills/melee/strike-sword-steel-yellow.webp",
    "power-block": "icons/equipment/shield/heater-steel-Boss-red.webp",
    "heroic-action": "icons/magic/control/buff-flight-wings-runes-purple.webp"
  };
  return icons[optionId] || "icons/svg/aura.svg";
}
