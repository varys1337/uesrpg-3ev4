/**
 * src/core/combat/chat-handlers/combat-chat-actions.js
 *
 * Delegated chat-log click handler registration.
 * Routes button clicks to appropriate workflow handlers.
 */

import { canUserRollActor } from "../../../utils/permissions.js";
import { resolveShockTestFromChat } from "../../wounds/wound-engine.js";
import { resolveDeathTestFromChat } from "../../wounds/death-tests.js";
import { requestUpdateChatMessage } from "../../../utils/authority-proxy.js";
import { getDiseaseResistancePercent, isActorImmuneToDamageType } from "../../traits/trait-registry.js";
import { applyHealing } from "../damage-automation.js";
import { renderDiseasedCheckCard, renderRegenerationPromptCard } from "../../traits/trait-automation.js";
import { resolveActorFromUuidSync, resolveUuidSync } from "../../../utils/uuid-cache.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { registerDelegatedChatLogClickHandler } from "./actions/handle-click.js";
import { isApplyDamageButton } from "./cards/attack-card.js";
import { isApplyHealingButton } from "./cards/damage-card.js";
import { getMessageIdFromContextLi } from "../../../utils/chat/contextmenu.js";
import { resolveActor, onApplyDamage, onApplyHealing } from "./combat-chat-apply.js";
import { onOpposedAction, onSkillOpposedAction, onCharOpposedAction, onMagicOpposedAction } from "./combat-chat-opposed.js";

const _FLAG_NS = FLAG_SCOPE;

let _delegatedChatClickRegistered = false;

// ── Private action handlers ───────────────────────────────────────────────────

async function _onShockAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  const action = el?.dataset?.uesShockAction;
  if (!action) return;

  const actorUuid = el?.dataset?.actorUuid;
  const woundEffectId = el?.dataset?.woundEffectId;
  if (!actorUuid || !woundEffectId) {
    ui.notifications?.warn?.("Shock: missing actor or wound reference.");
    return;
  }

  const actor = resolveActorFromUuidSync(actorUuid) ?? resolveUuidSync(actorUuid);
  if (!actor) {
    ui.notifications?.warn?.("Shock: actor not found.");
    return;
  }

  if (!canUserRollActor(game.user, actor)) {
    ui.notifications?.warn?.("You do not have permission to roll for this actor.");
    return;
  }

  try {
    await resolveShockTestFromChat({ actorUuid, woundEffectId, action, messageId: message?.id ?? null });
  } catch (err) {
    console.error("UESRPG | Shock roll handler failed", err);
    ui.notifications?.error?.("Shock roll failed. Check console for details.");
  }
}

async function _onDeathAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  const action = el?.dataset?.uesDeathAction;
  if (!action) return;

  const actorUuid = el?.dataset?.actorUuid;
  if (!actorUuid) {
    ui.notifications?.warn?.("Death test: missing actor reference.");
    return;
  }

  const actor = resolveActorFromUuidSync(actorUuid) ?? resolveUuidSync(actorUuid);
  if (!actor) {
    ui.notifications?.warn?.("Death test: actor not found.");
    return;
  }

  if (!canUserRollActor(game.user, actor)) {
    ui.notifications?.warn?.("You do not have permission to roll for this actor.");
    return;
  }

  try {
    await resolveDeathTestFromChat({
      actorUuid: String(actorUuid),
      messageId: String(message?.id ?? ""),
      action: String(action),
    });
  } catch (err) {
    console.error("UESRPG | Death test roll handler failed", err);
    ui.notifications?.error?.("Death test roll failed. Check console for details.");
  }
}

async function _onDiseaseAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  const action = el?.dataset?.uesDiseaseAction;
  if (action !== "roll") return;

  const state = message?.flags?.["uesrpg-3ev4"]?.diseaseCheck ?? {};
  if (state?.resolved) return;

  const actorUuid = el?.dataset?.actorUuid ?? state?.actorUuid;
  const actor = actorUuid ? resolveActor(message, actorUuid) : null;
  if (!actor) {
    ui.notifications?.warn?.("Disease check: actor not found.");
    return;
  }

  if (!canUserRollActor(game.user, actor)) {
    ui.notifications?.warn?.("You do not have permission to roll for this actor.");
    return;
  }

  const traitValue = Number(el?.dataset?.traitValue ?? state?.traitValue ?? 0) || 0;
  const sourceLabel = String(el?.dataset?.sourceLabel ?? state?.sourceLabel ?? "Disease").trim() || "Disease";

  if (isActorImmuneToDamageType(actor, "disease")) {
    await requestUpdateChatMessage(message, {
      content: renderDiseasedCheckCard({
        actor,
        sourceLabel,
        traitValue,
        result: { passed: true, resisted: true, immune: true }
      }),
      [`flags.${_FLAG_NS}.diseaseCheck.resolved`]: true,
      [`flags.${_FLAG_NS}.diseaseCheck.resolvedAt`]: Date.now(),
      [`flags.${_FLAG_NS}.diseaseCheck.result`]: { passed: true, resisted: true, immune: true },
    });
    return;
  }

  const endTotal = Number(actor.system?.characteristics?.end?.total ?? 0);
  const woundPenalty = Number(actor.system?.woundPenalty ?? 0);
  const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0);
  const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0);
  const tn = endTotal + woundPenalty + fatiguePenalty + carryPenalty + traitValue;

  const roll = new Roll("1d100");
  await roll.evaluate();

  const passed = Number(roll.total ?? 0) <= tn;
  const resistPercent = getDiseaseResistancePercent(actor);
  let resisted = false;
  let resistRoll = null;

  if (!passed && resistPercent > 0) {
    resistRoll = new Roll("1d100");
    await resistRoll.evaluate();
    resisted = Number(resistRoll.total ?? 0) <= resistPercent;
  }

  await requestUpdateChatMessage(message, {
    content: renderDiseasedCheckCard({
      actor,
      sourceLabel,
      traitValue,
      result: {
        passed,
        resisted,
        tn,
        roll: Number(roll.total ?? 0),
        resistPercent,
        resistRoll: resistRoll ? Number(resistRoll.total ?? 0) : null,
      }
    }),
    [`flags.${_FLAG_NS}.diseaseCheck.resolved`]: true,
    [`flags.${_FLAG_NS}.diseaseCheck.resolvedAt`]: Date.now(),
    [`flags.${_FLAG_NS}.diseaseCheck.result`]: {
      passed,
      resisted,
      tn,
      roll: Number(roll.total ?? 0),
      resistPercent,
      resistRoll: resistRoll ? Number(resistRoll.total ?? 0) : null,
    },
  });
}

async function _onRegenerationAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  const action = el?.dataset?.uesRegenerationAction;
  if (action !== "roll") return;

  const state = message?.flags?.["uesrpg-3ev4"]?.regenerationPrompt ?? {};
  if (state?.resolved) return;

  const actorUuid = el?.dataset?.actorUuid ?? state?.actorUuid;
  const actor = actorUuid ? resolveActor(message, actorUuid) : null;
  if (!actor) {
    ui.notifications?.warn?.("Regeneration: actor not found.");
    return;
  }

  if (!canUserRollActor(game.user, actor)) {
    ui.notifications?.warn?.("You do not have permission to roll for this actor.");
    return;
  }

  const value = Number(el?.dataset?.regenValue ?? state?.value ?? 0) || 0;
  if (value <= 0) return;

  const endTotal = Number(actor.system?.characteristics?.end?.total ?? 0);
  const woundPenalty = Number(actor.system?.woundPenalty ?? 0);
  const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0);
  const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0);
  const tn = endTotal + woundPenalty + fatiguePenalty + carryPenalty;

  const roll = new Roll("1d100");
  await roll.evaluate();
  const passed = Number(roll.total ?? 0) <= tn;
  let healed = 0;

  if (passed) {
    const healResult = await applyHealing(actor, value, { source: "Regeneration", skipChatMessage: true });
    healed = Math.max(0, Number(healResult?.healing ?? 0) || 0);
  }

  await requestUpdateChatMessage(message, {
    content: renderRegenerationPromptCard({
      actor,
      value,
      round: state?.round ?? null,
      result: {
        passed,
        tn,
        roll: Number(roll.total ?? 0),
        healed,
      }
    }),
    [`flags.${_FLAG_NS}.regenerationPrompt.resolved`]: true,
    [`flags.${_FLAG_NS}.regenerationPrompt.resolvedAt`]: Date.now(),
    [`flags.${_FLAG_NS}.regenerationPrompt.result`]: {
      passed,
      tn,
      roll: Number(roll.total ?? 0),
      healed,
    },
  });
}

async function _onAlchemyAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  if (el instanceof HTMLButtonElement) el.disabled = true;
  const action = String(el?.dataset?.action ?? "").trim();
  if (!action) return;

  if (action === "alchemyRoll") {
    const { handleBrewChatAction } = await import("../../alchemy/workflow.js");
    await handleBrewChatAction(message?.id ?? "");
    return;
  }

  const actorUuid = String(el?.dataset?.actorUuid ?? "").trim();
  const itemUuid = String(el?.dataset?.itemUuid ?? "").trim();
  if (!actorUuid || !itemUuid) return;

  const actor = await fromUuid(actorUuid).catch(() => null);
  const item = await fromUuid(itemUuid).catch(() => null);
  if (!actor || !item) return;

  if (action === "alchemyDrink") {
    const { drinkPotion } = await import("../../alchemy/runtime.js");
    await drinkPotion(actor, item);
    return;
  }

  if (action === "alchemyApplyToWeapon" || action === "alchemyApplyToTarget") {
    const { applyAlchemyToTarget, pickAlchemyCoatingTarget } = await import("../../alchemy/runtime.js");
    const targetItem = await pickAlchemyCoatingTarget(actor);
    if (!targetItem) return;
    await applyAlchemyToTarget(actor, item, targetItem);
  }
}

async function _onAlchemyPoisonAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  const action = String(el?.dataset?.uesAlchemyPoisonAction ?? "").trim().toLowerCase();
  if (action !== "roll") return;

  const state = message?.flags?.[_FLAG_NS]?.alchemyPoisonCard ?? {};
  const actorUuid = String(el?.dataset?.actorUuid ?? state?.targetActorUuid ?? "").trim();
  if (!actorUuid) {
    ui.notifications?.warn?.("Poison resistance: missing actor reference.");
    return;
  }

  const actor = resolveActorFromUuidSync(actorUuid) ?? resolveUuidSync(actorUuid);
  if (!actor) {
    ui.notifications?.warn?.("Poison resistance: actor not found.");
    return;
  }

  if (!canUserRollActor(game.user, actor)) {
    ui.notifications?.warn?.("You do not have permission to roll for this actor.");
    return;
  }

  try {
    const { resolvePoisonResistanceFromChat } = await import("../../alchemy/runtime.js");
    await resolvePoisonResistanceFromChat({
      messageId: String(message?.id ?? ""),
      action,
    });
  } catch (err) {
    console.error("UESRPG | Poison resistance roll handler failed", err);
    ui.notifications?.error?.("Poison resistance roll failed. Check console for details.");
  }
}

async function _onAlchemyToxinAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  const action = String(el?.dataset?.uesAlchemyToxinAction ?? "").trim().toLowerCase();
  if (action !== "roll") return;

  const state = message?.flags?.[_FLAG_NS]?.alchemyToxinCard ?? {};
  const actorUuid = String(el?.dataset?.actorUuid ?? state?.targetActorUuid ?? "").trim();
  if (!actorUuid) {
    ui.notifications?.warn?.("Toxin resistance: missing actor reference.");
    return;
  }

  const actor = resolveActorFromUuidSync(actorUuid) ?? resolveUuidSync(actorUuid);
  if (!actor) {
    ui.notifications?.warn?.("Toxin resistance: actor not found.");
    return;
  }

  if (!canUserRollActor(game.user, actor)) {
    ui.notifications?.warn?.("You do not have permission to roll for this actor.");
    return;
  }

  try {
    const { resolveToxinResistanceFromChat } = await import("../../alchemy/runtime.js");
    await resolveToxinResistanceFromChat({
      messageId: String(message?.id ?? ""),
      action,
    });
  } catch (err) {
    console.error("UESRPG | Toxin resistance roll handler failed", err);
    ui.notifications?.error?.("Toxin resistance roll failed. Check console for details.");
  }
}

async function _onUpkeepAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  if (el instanceof HTMLButtonElement) el.disabled = true;
  const action = String(el?.dataset?.uesUpkeepAction ?? "").trim().toLowerCase();
  if (!action) return;
  const upkeep = await import("../../magic/upkeep-workflow.js");
  if (action === "confirm") {
    await upkeep.handleUpkeepGroupConfirm(message);
    return;
  }
  if (action === "cancel") {
    await upkeep.handleUpkeepGroupCancel(message);
  }
}

// ── Public registration ───────────────────────────────────────────────────────

export function registerCombatChatClickHandler() {
  if (_delegatedChatClickRegistered) return;
  try {
    const SELECTOR = [
      ".apply-damage-btn",
      ".apply-healing-btn",
      "[data-ues-opposed-action]",
      "[data-ues-skill-opposed-action]",
      "[data-ues-char-opposed-action]",
      "[data-ues-magic-opposed-action]",
      "[data-ues-shock-action]",
      "[data-ues-death-action]",
      "[data-ues-disease-action]",
      "[data-ues-regeneration-action]",
      "[data-ues-upkeep-action]",
      "[data-ues-special-action]",
      "[data-ues-action-card-toggle]",
      "[data-ues-alchemy-poison-action]",
      "[data-ues-alchemy-toxin-action]",
      "[data-action='alchemyRoll']",
      "[data-action='alchemyDrink']",
      "[data-action='alchemyApplyToWeapon']",
      "[data-action='alchemyApplyToTarget']",
    ].join(", ");

    registerDelegatedChatLogClickHandler({
      id: "combat-actions",
      selector: SELECTOR,
      isBound: (chatLog) => chatLog.dataset.uesrpgDelegatedClick === "1",
      markBound: (chatLog) => {
        chatLog.dataset.uesrpgDelegatedClick = "1";
      },
      resolveMessageFromButton: (btn) => {
        const li = btn.closest("li.chat-message, .chat-message, .message, [data-message-id]");
        const messageId = getMessageIdFromContextLi(li);
        return messageId ? game.messages?.get?.(messageId) : null;
      },
      dispatch: async (delegatedEv, btn, message) => {
        try {
          if (isApplyDamageButton(btn)) return onApplyDamage(delegatedEv, message);
          if (isApplyHealingButton(btn)) return onApplyHealing(delegatedEv, message);
          if (btn.hasAttribute("data-ues-opposed-action")) return onOpposedAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-skill-opposed-action")) return onSkillOpposedAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-char-opposed-action")) return onCharOpposedAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-magic-opposed-action")) {
            delegatedEv.stopImmediatePropagation?.();
            return onMagicOpposedAction(delegatedEv, message);
          }
          if (btn.hasAttribute("data-ues-shock-action")) return _onShockAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-death-action")) return _onDeathAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-disease-action")) return _onDiseaseAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-regeneration-action")) return _onRegenerationAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-upkeep-action")) return _onUpkeepAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-alchemy-poison-action")) return _onAlchemyPoisonAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-alchemy-toxin-action")) return _onAlchemyToxinAction(delegatedEv, message);
          if (btn.matches("[data-action='alchemyRoll'], [data-action='alchemyDrink'], [data-action='alchemyApplyToWeapon'], [data-action='alchemyApplyToTarget']")) {
            return _onAlchemyAction(delegatedEv, message);
          }
          if (btn.hasAttribute("data-ues-special-action")) {
            delegatedEv.preventDefault?.();
            const action = btn.dataset.uesSpecialAction;
            const { handleSpecialActionCardAction } = await import("../special-actions-helper.js");
            return handleSpecialActionCardAction(message, action);
          }
          if (btn.hasAttribute("data-ues-action-card-toggle")) {
            delegatedEv.preventDefault?.();
            const card = btn.closest(".uesrpg-action-card[data-ues-action-card]");
            if (!card) return;
            const body = card.querySelector("[data-ues-action-card-body]");
            if (!body) return;
            const nextExpanded = body.style.display === "none";
            body.style.display = nextExpanded ? "" : "none";
            body.setAttribute("aria-hidden", nextExpanded ? "false" : "true");
            card.dataset.uesActionCardExpanded = nextExpanded ? "1" : "0";
            btn.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
            btn.textContent = nextExpanded ? "Collapse" : "Expand";
          }
        } catch (err) {
          console.error("UESRPG | Delegated chat handler failed", err);
        }
      },
    });
    _delegatedChatClickRegistered = true;
  } catch (err) {
    _delegatedChatClickRegistered = false;
    console.error("UESRPG | Failed to register delegated chat click handler", err);
  }
}
