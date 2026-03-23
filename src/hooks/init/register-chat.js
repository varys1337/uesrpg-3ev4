import { FLAG_SCOPE } from "../../core/constants.js";
import { registerOnce } from "../_internal/hook-registry.js";
import { isDebugEnabled } from "../../utils/debug.js";

function _chatDebug(event, payload = {}) {
  if (!isDebugEnabled("opposedDebug")) return;
  try {
    console.log(`UESRPG | registerChat | ${event}`, payload);
  } catch (_e) {
    // no-op
  }
}

/**
 * Register combat chat integrations initialized during init.
 */
export function registerChat({
  registerCombatChatHandlers,
  registerActivationStateHooks,
  registerChatMessageSocket,
  registerAuthorityProxy,
  registerReachVisualizer,
  registerClashChatActions,
} = {}) {
  _chatDebug("start");

  try {
    _chatDebug("registrar:start", { name: "combatHandlers" });
    registerCombatChatHandlers?.();
    _chatDebug("registrar:ok", { name: "combatHandlers" });
  } catch (err) {
    console.error("UESRPG | registerChat combatHandlers failed", err);
    _chatDebug("registrar:fail", { name: "combatHandlers", error: String(err?.message ?? err) });
  }

  try {
    _chatDebug("registrar:start", { name: "activationHooks" });
    registerActivationStateHooks?.();
    _chatDebug("registrar:ok", { name: "activationHooks" });
  } catch (err) {
    console.error("UESRPG | registerChat activationHooks failed", err);
    _chatDebug("registrar:fail", { name: "activationHooks", error: String(err?.message ?? err) });
  }

  try {
    _chatDebug("registrar:start", { name: "socket" });
    registerChatMessageSocket?.();
    _chatDebug("registrar:ok", { name: "socket" });
  } catch (err) {
    console.error("UESRPG | registerChat socket failed", err);
    _chatDebug("registrar:fail", { name: "socket", error: String(err?.message ?? err) });
  }

  try {
    _chatDebug("registrar:start", { name: "authorityProxy" });
    registerAuthorityProxy?.();
    _chatDebug("registrar:ok", { name: "authorityProxy" });
  } catch (err) {
    console.error("UESRPG | registerChat authorityProxy failed", err);
    _chatDebug("registrar:fail", { name: "authorityProxy", error: String(err?.message ?? err) });
  }

  try {
    _chatDebug("registrar:start", { name: "reachVisualizer" });
    registerReachVisualizer?.();
    _chatDebug("registrar:ok", { name: "reachVisualizer" });
  } catch (err) {
    console.error("UESRPG | registerChat reachVisualizer failed", err);
    _chatDebug("registrar:fail", { name: "reachVisualizer", error: String(err?.message ?? err) });
  }

  try {
    _chatDebug("registrar:start", { name: "clashChatActions" });
    registerClashChatActions?.();
    _chatDebug("registrar:ok", { name: "clashChatActions" });
  } catch (err) {
    console.error("UESRPG | registerChat clashChatActions failed", err);
    _chatDebug("registrar:fail", { name: "clashChatActions", error: String(err?.message ?? err) });
  }

  _chatDebug("done");
}

/**
 * Auto-execute Special Action outcomes when a skill opposed test resolves.
 */
export function registerSpecialActionOutcomeHook({ executeSpecialAction } = {}) {
  registerOnce("hooks:special-action-outcome", () => {
    Hooks.on("createChatMessage", async (message) => {
      const state = message?.flags?.[FLAG_SCOPE]?.skillOpposed?.state;
      if (!state?.outcome || !state?.specialActionId) return;

      try {
        const attacker = fromUuidSync(state.attacker?.actorUuid);
        const defender = fromUuidSync(state.defender?.actorUuid);
        if (!attacker) return;

        const result = await executeSpecialAction({
          specialActionId: state.specialActionId,
          actor: attacker,
          target: defender ?? null,
          isAutoWin: false,
          opposedResult: state.outcome,
        });

        if (!result?.success) return;
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: attacker }),
          content: `<div class="uesrpg-special-action-outcome"><b>Special Action Outcome:</b><p>${result.message}</p></div>`,
          style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        });
      } catch (err) {
        console.error("UESRPG | Failed to execute Special Action outcome automation", err);
      }
    });
  });
}
