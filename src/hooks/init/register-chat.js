let _specialActionOutcomeHookRegistered = false;

/**
 * Register combat chat integrations initialized during init.
 */
export function registerChat({
  registerCombatChatHandlers,
  initializeChatHandlers,
  registerCombatChatHooks,
  registerActivationStateHooks,
  registerChatMessageSocket,
  registerAuthorityProxy,
  registerReachVisualizer,
} = {}) {
  if (typeof registerCombatChatHandlers === "function") {
    registerCombatChatHandlers();
  } else {
    initializeChatHandlers?.();
    registerCombatChatHooks?.();
  }
  registerActivationStateHooks?.();
  registerChatMessageSocket?.();
  registerAuthorityProxy?.();
  registerReachVisualizer?.();
}

/**
 * Auto-execute Special Action outcomes when a skill opposed test resolves.
 */
export function registerSpecialActionOutcomeHook({ executeSpecialAction } = {}) {
  if (_specialActionOutcomeHookRegistered) return;
  _specialActionOutcomeHookRegistered = true;

  Hooks.on("createChatMessage", async (message) => {
    const state = message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
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
}
