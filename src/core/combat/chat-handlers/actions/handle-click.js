const _chatLogMountHandlers = new Map();
let _chatLogHookRegistered = false;

function _registerChatLogHook() {
  if (_chatLogHookRegistered) return;
  Hooks.on("renderChatLog", (_app, html) => {
    const host = html instanceof HTMLElement ? html : html?.[0];
    if (!(host instanceof HTMLElement)) return;

    const chatLog = host.querySelector?.("#chat-log") ?? host;
    if (!(chatLog instanceof HTMLElement)) return;

    for (const mount of _chatLogMountHandlers.values()) {
      try {
        mount({ host, chatLog });
      } catch (err) {
        console.error("UESRPG | Chat log mount failed", err);
      }
    }
  });
  _chatLogHookRegistered = true;
}

export function registerChatLogHostMount(id, mount) {
  if (!id || typeof mount !== "function") return;
  _chatLogMountHandlers.set(String(id), mount);
  _registerChatLogHook();
}

/**
 * Register a delegated click listener on the chat log host.
 * Keeps per-message render hooks free from click handler churn.
 */
export function registerDelegatedChatLogClickHandler({
  id = "default",
  selector,
  isBound,
  markBound,
  resolveMessageFromButton,
  dispatch,
} = {}) {
  registerChatLogHostMount(`click:${id}`, ({ chatLog }) => {
    if (isBound?.(chatLog)) return;
    markBound?.(chatLog);

    chatLog.addEventListener(
      "click",
      async (ev) => {
        const target = ev.target instanceof HTMLElement ? ev.target : null;
        if (!target) return;

        const btn = target.closest(selector);
        if (!(btn instanceof HTMLElement)) return;

        if (btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true") {
          ev.preventDefault();
          return;
        }
        if (btn instanceof HTMLButtonElement && btn.disabled) {
          ev.preventDefault();
          return;
        }

        const message = resolveMessageFromButton?.(btn);
        if (!message) return;

        const delegatedEv = {
          originalEvent: ev,
          currentTarget: btn,
          delegateTarget: btn,
          target: ev.target,
          type: ev.type,
          altKey: ev.altKey,
          ctrlKey: ev.ctrlKey,
          shiftKey: ev.shiftKey,
          metaKey: ev.metaKey,
          button: ev.button,
          buttons: ev.buttons,
          clientX: ev.clientX,
          clientY: ev.clientY,
          preventDefault: () => ev.preventDefault(),
          stopPropagation: () => ev.stopPropagation(),
          stopImmediatePropagation: () => ev.stopImmediatePropagation?.(),
        };

        await dispatch?.(delegatedEv, btn, message);
      },
      true
    );
  });
}
