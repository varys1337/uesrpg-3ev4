/**
 * src/core/combat/chat-handlers/combat-chat-actions.js
 *
 * Delegated chat-log click handler registration.
 * Routes button clicks to appropriate workflow handlers.
 */

import { canUserRollActor } from "../../../utils/permissions.js";
import { resolveShockTestFromChat } from "../../wounds/wound-engine.js";
import { resolveDeathTestFromChat } from "../../wounds/death-tests.js";
import { requestUpdateChatMessage, doesUserOwnActor, canUserUpdateChatMessage } from "../../../utils/authority-proxy.js";
import { AUTHORITY_RESULT_CODES, registerAuthorityIntentCommand, requestAuthorityIntent } from "../../../utils/authority-intents.js";
import { acquireLock, releaseLock } from "../../../utils/authority-proxy/shared.js";
import { getActiveGMUser } from "../../../utils/users.js";
import { getDiseaseResistancePercent, isActorImmuneToDamageType } from "../../traits/trait-registry.js";
import { createChatOutcome } from "../../config/outcome-application-policy.js";
import { ChatOutcomeApplicationService } from "../../../application/combat/chat-outcome-application-service.js";
import { renderDiseasedCheckCard, renderRegenerationPromptCard, renderRegenerationPromptBatch } from "../../traits/trait-automation.js";
import { resolveActorFromUuidSync, resolveUuidSync } from "../../../utils/uuid-cache.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { registerDelegatedChatLogClickHandler } from "./actions/handle-click.js";
import { isApplyDamageButton } from "./cards/attack-card.js";
import { isApplyHealingButton } from "./cards/damage-card.js";
import { getMessageIdFromContextLi } from "../../../utils/chat/contextmenu.js";
import { resolveActor, onApplyDamage, onApplyHealing } from "./combat-chat-apply.js";
import { onOpposedAction, onSkillOpposedAction, onCharOpposedAction, onMagicOpposedAction } from "./combat-chat-opposed.js";
import { asyncGuard } from "../../../utils/async-guard.js";

const _FLAG_NS = FLAG_SCOPE;

let _delegatedChatClickRegistered = false;
let _regenerationAuthorityRegistered = false;
const _guardedApplyDamage = asyncGuard(onApplyDamage, {
  onError: () => ui.notifications?.error?.("Damage application failed. Review the target before retrying."),
});
const _guardedApplyHealing = asyncGuard(onApplyHealing, {
  onError: () => ui.notifications?.error?.("Healing application failed. Review the target before retrying."),
});

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

async function resolveRegenerationOutcome({ requester, data }) {
  const message = game.messages.get(String(data?.messageId ?? ""));
  if (!message || !canUserUpdateChatMessage(message, game.user)) return { ok: false, code: AUTHORITY_RESULT_CODES.NO_ACTIVE_GM };
  const lockKey = `ChatMessage:${message.id}`;
  await acquireLock(lockKey);
  try {
    const live = game.messages.get(message.id);
    const batch = foundry.utils.deepClone(live.flags?.[_FLAG_NS]?.regenerationPromptBatch);
    const single = foundry.utils.deepClone(live.flags?.[_FLAG_NS]?.regenerationPrompt);
    const state = batch?.entries?.find(entry => entry.actorUuid === data.targetUuid)
      ?? (single?.actorUuid === data.targetUuid ? single : null);
    const actor = resolveActorFromUuidSync(state?.actorUuid);
    if (!actor || !doesUserOwnActor(requester, actor)) return { ok: false, code: AUTHORITY_RESULT_CODES.UNAUTHORIZED };
    if (state.result || state.resolved) return { ok: true };
    const value = Math.max(0, Number(state.value ?? 0) || 0);
    if (!value) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
    const tn = Number(actor.system?.characteristics?.end?.total ?? 0)
      + Number(actor.system?.woundPenalty ?? 0) + Number(actor.system?.fatigue?.penalty ?? 0)
      + Number(actor.system?.carry_rating?.penalty ?? 0);
    const roll = await new Roll("1d100").evaluate();
    const passed = Number(roll.total) <= tn;
    const outcomes = foundry.utils.deepClone(live.flags?.[_FLAG_NS]?.chatOutcomes?.entries ?? []);
    if (passed) outcomes.push(createChatOutcome({ adapter: "healing", kind: "healing",
      sourceActorUuid: actor.uuid, targetUuid: actor.uuid, label: "Regeneration",
      payload: { amount: value, source: "Regeneration" } }));
    state.resolved = true;
    state.resolvedAt = Date.now();
    state.result = { passed, tn, roll: Number(roll.total), healed: passed ? value : 0, applicationPending: passed };
    const key = batch ? "regenerationPromptBatch" : "regenerationPrompt";
    const saved = batch ?? state;
    const content = batch ? renderRegenerationPromptBatch(batch)
      : renderRegenerationPromptCard({ actor, value, round: state.round, result: state.result });
    const updated = await requestUpdateChatMessage(live, { content,
      [`flags.${_FLAG_NS}.${key}`]: saved, [`flags.${_FLAG_NS}.chatOutcomes`]: { version: 1, entries: outcomes } });
    return { ok: Boolean(updated), code: updated ? null : AUTHORITY_RESULT_CODES.FAILED };
  } finally { releaseLock(lockKey); }
}

async function _onRegenerationAction(event, message) {
  event.preventDefault();
  if (event.currentTarget?.dataset?.uesRegenerationAction !== "roll") return;
  const targetUuid = event.currentTarget.dataset.actorUuid;
  const data = { messageId: message.id, targetUuid };
  const gm = getActiveGMUser();
  const result = gm?.id === game.user.id || (!gm && canUserUpdateChatMessage(message, game.user))
    ? await resolveRegenerationOutcome({ requester: game.user, data })
    : await requestAuthorityIntent("combat.resolveRegeneration", data, { timeout: 60_000 });
  if (!result?.ok) ui.notifications?.warn?.("Regeneration could not be resolved. An authorized card writer is required.");
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

async function _onEnchantingAction(event, message) {
  event.preventDefault();
  const button = event.currentTarget;
  if (button instanceof HTMLButtonElement) button.disabled = true;
  const { handleEnchantmentChatAction } = await import("../../enchanting/workflow.js");
  await handleEnchantmentChatAction(message?.id ?? "");
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
  const state = message?.flags?.[_FLAG_NS]?.upkeepGroup ?? {};
  if (state?.resolved === true || state?.resolving === true) return;
  const card = el?.closest?.(".uesrpg-upkeep-card");
  card?.querySelectorAll?.("[data-ues-upkeep-action]")?.forEach?.((btn) => {
    if (btn instanceof HTMLButtonElement) btn.disabled = true;
    else btn?.setAttribute?.("disabled", "disabled");
  });
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
  if (!_regenerationAuthorityRegistered) {
    if (!registerAuthorityIntentCommand("combat.resolveRegeneration", resolveRegenerationOutcome)) {
      throw new Error("UESRPG | Regeneration resolution command registration failed.");
    }
    _regenerationAuthorityRegistered = true;
  }
  try {
    const SELECTOR = [
      "[data-ues-chat-outcome]",
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
      "[data-action='enchantingRoll']",
    ].join(", ");

    registerDelegatedChatLogClickHandler({
      id: "combat-actions",
      selector: SELECTOR,
      isBound: (chatLog) => chatLog.dataset.uesrpgDelegatedClick === "1",
      markBound: (chatLog) => {
        chatLog.dataset.uesrpgDelegatedClick = "1";
      },
      resolveMessageFromButton: (btn) => {
        // Core's enclosing message is authoritative; an inner card can still
        // contain the empty id from its initial creation or a stale stored id.
        const enclosing = btn.closest("li.chat-message, .chat-message, .message[data-message-id]");
        const messageId = getMessageIdFromContextLi(enclosing)
          ?? getMessageIdFromContextLi(btn.closest("[data-message-id]"));
        const message = messageId ? game.messages?.get?.(messageId) : null;
        if (!message) {
          console.error("UESRPG | Chat action could not resolve its message", { messageId });
          ui.notifications?.warn?.("Could not find this chat message. Reopen chat and try again.");
        }
        return message;
      },
      dispatch: async (delegatedEv, btn, message) => {
        try {
          if (btn.hasAttribute("data-ues-chat-outcome")) {
            delegatedEv.preventDefault();
            return await ChatOutcomeApplicationService.apply(message, { outcomeId: btn.dataset.uesChatOutcome });
          }
          if (isApplyDamageButton(btn)) return await _guardedApplyDamage(delegatedEv, message);
          if (isApplyHealingButton(btn)) return await _guardedApplyHealing(delegatedEv, message);
          if (btn.hasAttribute("data-ues-opposed-action")) return await onOpposedAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-skill-opposed-action")) return await onSkillOpposedAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-char-opposed-action")) return await onCharOpposedAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-magic-opposed-action")) {
            delegatedEv.stopImmediatePropagation?.();
            return await onMagicOpposedAction(delegatedEv, message);
          }
          if (btn.hasAttribute("data-ues-shock-action")) return await _onShockAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-death-action")) return await _onDeathAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-disease-action")) return await _onDiseaseAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-regeneration-action")) return await _onRegenerationAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-upkeep-action")) return await _onUpkeepAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-alchemy-poison-action")) return await _onAlchemyPoisonAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-alchemy-toxin-action")) return await _onAlchemyToxinAction(delegatedEv, message);
          if (btn.matches("[data-action='alchemyRoll'], [data-action='alchemyDrink'], [data-action='alchemyApplyToWeapon'], [data-action='alchemyApplyToTarget']")) {
            return await _onAlchemyAction(delegatedEv, message);
          }
          if (btn.matches("[data-action='enchantingRoll']")) return await _onEnchantingAction(delegatedEv, message);
          if (btn.hasAttribute("data-ues-special-action")) {
            delegatedEv.preventDefault?.();
            const action = btn.dataset.uesSpecialAction;
            const { handleSpecialActionCardAction } = await import("../special-actions-helper.js");
            return await handleSpecialActionCardAction(message, action);
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
          ui.notifications?.error?.("Chat action failed. Check the console for details before retrying.");
        }
      },
    });
    _delegatedChatClickRegistered = true;
  } catch (err) {
    _delegatedChatClickRegistered = false;
    console.error("UESRPG | Failed to register delegated chat click handler", err);
  }
}
