import { FLAG_SCOPE } from "../../core/constants.js";
import { registerOnce } from "../_internal/hook-registry.js";
import { isDebugEnabled } from "../../utils/debug.js";
import { isActiveGMUser } from "../../utils/users.js";

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
  registerArmorCoverageOverlay,
  registerClashChatActions,
} = {}) {
  registerOnce("hooks:chat-orchestrator", () => {
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
      _chatDebug("registrar:start", { name: "armorCoverageOverlay" });
      registerArmorCoverageOverlay?.();
      _chatDebug("registrar:ok", { name: "armorCoverageOverlay" });
    } catch (err) {
      console.error("UESRPG | registerChat armorCoverageOverlay failed", err);
      _chatDebug("registrar:fail", { name: "armorCoverageOverlay", error: String(err?.message ?? err) });
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
  });
}

/**
 * Auto-execute Special Action outcomes when a skill opposed test resolves.
 */
export function registerSpecialActionOutcomeHook({ executeSpecialAction } = {}) {
  registerOnce("hooks:special-action-outcome", () => {
    const processMessage = async (message) => {
      if (!isActiveGMUser(game.user)) return;
      const state = message?.flags?.[FLAG_SCOPE]?.skillOpposed?.state;
      if (!state?.outcome || !state?.specialActionId) return;

      const revision = Number(state?.context?.updatedSeq ?? state?.context?.updatedAt ?? 0) || 0;
      const automation = message?.flags?.[FLAG_SCOPE]?.specialActionOutcomeAutomation;
      if (automation?.status === "complete" && Number(automation?.revision ?? -1) === revision) return;
      const processingAge = Date.now() - Number(automation?.updatedAt ?? 0);
      const processingIsLive = automation?.status === "processing"
        && Number(automation?.revision ?? -1) === revision
        && Number.isFinite(processingAge)
        && processingAge >= 0
        && processingAge < 60_000;
      if (processingIsLive) return;

      try {
        await message.update({
          [`flags.${FLAG_SCOPE}.specialActionOutcomeAutomation`]: {
            status: "processing",
            revision,
            processedBy: game.user.id,
            updatedAt: Date.now(),
          },
        });

        const attacker = fromUuidSync(state.attacker?.actorUuid);
        const defender = fromUuidSync(state.defender?.actorUuid);
        if (!attacker) throw new Error("Special Action attacker could not be resolved");

        const result = await executeSpecialAction({
          specialActionId: state.specialActionId,
          actor: attacker,
          target: defender ?? null,
          isAutoWin: false,
          opposedResult: state.outcome,
        });

        if (result?.success) {
          const safeMessage = foundry.utils.escapeHTML(String(result.message ?? ""));
          await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: attacker }),
            content: `<div class="uesrpg-special-action-outcome"><b>Special Action Outcome:</b><p>${safeMessage}</p></div>`,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER,
          });
        }

        await message.update({
          [`flags.${FLAG_SCOPE}.specialActionOutcomeAutomation`]: {
            status: "complete",
            revision,
            processedBy: game.user.id,
            updatedAt: Date.now(),
            success: result?.success === true,
          },
        });
      } catch (err) {
        console.error("UESRPG | Failed to execute Special Action outcome automation", err);
        try {
          await message.update({
            [`flags.${FLAG_SCOPE}.specialActionOutcomeAutomation`]: {
              status: "failed",
              revision,
              processedBy: game.user.id,
              updatedAt: Date.now(),
            },
          });
        } catch (_updateError) {
          // Preserve the original automation failure.
        }
      }
    };

    Hooks.on("createChatMessage", processMessage);
    Hooks.on("ready", async () => {
      if (!isActiveGMUser(game.user)) return;
      for (const message of (game.messages?.contents ?? [])) await processMessage(message);
    });
  });
}
