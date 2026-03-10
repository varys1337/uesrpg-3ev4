/**
 * src/core/combat/chat-handlers/combat-chat-context.js
 *
 * Context menu registration for opposed card retargeting, luck options,
 * and the debug probe / console helper.
 */

import { canRetargetOpposedMessage, retargetOpposedMessage } from "../opposed/retarget.js";
import { registerLuckContextMenuOptions } from "../../luck/luck-workflow.js";
import { isDebugEnabled } from "../../../utils/debug.js";
import { pushContextOptionOnce } from "./actions/handle-contextmenu.js";
import { getMessageIdFromContextLi } from "../../../utils/chat/contextmenu.js";

let _chatContextHooksRegistered = false;
let _ctxMenuDebugHelperRegistered = false;
let _chatLogContextProbeRegistered = false;

// ── Debug helpers ─────────────────────────────────────────────────────────────

function _ctxMenuDebugEnabled() {
  const runtimeToggle = Boolean(globalThis?.__UESRPG_CTX_MENU_DEBUG__ === true);
  return isDebugEnabled("opposedDebug", { runtimeToggle });
}

function _ctxMenuDebug(event, payload = {}) {
  if (!_ctxMenuDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.log(`UESRPG | ContextMenuDebug | ${event}`, payload);
  } catch (_e) {
    // no-op
  }
}

function _getMessageIdFromContextLi(li) {
  const out = getMessageIdFromContextLi(li);
  if (out) {
    _ctxMenuDebug("resolveMessageId.shared", { out });
  } else {
    const el = li instanceof HTMLElement ? li : li?.[0];
    _ctxMenuDebug("resolveMessageId.failed", {
      hasElement: Boolean(el),
      elementId: String(el?.id ?? ""),
      dataMessageId: String(el?.dataset?.messageId ?? ""),
    });
  }
  return out;
}

function _getSingleUserSelectedToken() {
  const controlled = Array.from(canvas?.tokens?.controlled ?? []);
  if (controlled.length !== 1) return null;
  return controlled[0] ?? null;
}

function _isOpposedCardMessage(message) {
  const flags = message?.flags?.["uesrpg-3ev4"] ?? {};
  const isOpposed = Boolean(flags?.opposed || flags?.skillOpposed || flags?.magicOpposed);
  _ctxMenuDebug("isOpposedCardMessage", {
    messageId: message?.id ?? null,
    opposed: Boolean(flags?.opposed),
    skillOpposed: Boolean(flags?.skillOpposed),
    magicOpposed: Boolean(flags?.magicOpposed),
    isOpposed,
  });
  return isOpposed;
}

async function _executeContextRetarget(li, { role = "attacker" } = {}) {
  const messageId = _getMessageIdFromContextLi(li);
  const message = messageId ? (game.messages?.get?.(messageId) ?? null) : null;
  if (!message) {
    _ctxMenuDebug(`callback.change${role === "defender" ? "Defender" : "Attacker"}.noMessage`, { messageId });
    return;
  }

  const selected = _getSingleUserSelectedToken();
  if (!selected) {
    const selectedCount = Array.from(canvas?.tokens?.controlled ?? []).length;
    _ctxMenuDebug(`callback.change${role === "defender" ? "Defender" : "Attacker"}.badSelectedCount`, { count: selectedCount });
    ui.notifications?.warn?.(`Select exactly 1 token to change the ${role}.`);
    return;
  }

  const selectedTokenUuid = selected.document?.uuid ?? selected.uuid ?? null;
  _ctxMenuDebug(`callback.change${role === "defender" ? "Defender" : "Attacker"}.execute`, {
    messageId,
    selectedTokenId: selected.id ?? null,
    selectedTokenUuid,
  });

  if (role === "defender") {
    await retargetOpposedMessage(
      message,
      { defenderTokenUuid: selectedTokenUuid },
      { userId: game.user?.id ?? null, reason: "context-change-defender" }
    );
    return;
  }

  await retargetOpposedMessage(
    message,
    { attackerTokenUuid: selectedTokenUuid },
    { userId: game.user?.id ?? null, reason: "context-change-attacker" }
  );
}

function _registerChatLogContextProbe() {
  if (_chatLogContextProbeRegistered) return;
  _chatLogContextProbeRegistered = true;

  Hooks.on("renderChatLog", (_app, html) => {
    const host = html?.[0] ?? html;
    if (!(host instanceof HTMLElement)) return;
    if (host.dataset.uesrpgCtxProbe === "1") return;
    host.dataset.uesrpgCtxProbe = "1";

    host.addEventListener("contextmenu", (ev) => {
      if (!_ctxMenuDebugEnabled()) return;
      const target = ev.target instanceof HTMLElement ? ev.target : null;
      const li = target?.closest?.(".message");
      const messageId = li ? _getMessageIdFromContextLi(li) : null;
      _ctxMenuDebug("dom.contextmenu", {
        hasMessageLi: Boolean(li),
        messageId,
        targetClass: String(target?.className ?? ""),
        targetTag: String(target?.tagName ?? ""),
      });
    }, true);

    _ctxMenuDebug("probe.renderChatLog.bound", { bound: true });
  });
}

// ── Public registration ───────────────────────────────────────────────────────

export function registerCombatChatContextHandlers() {
  if (_chatContextHooksRegistered) return;

  try {
    _registerChatLogContextProbe();
  } catch (err) {
    console.error("UESRPG | Failed to register chat context probe", err);
  }

  _chatContextHooksRegistered = true;
  _ctxMenuDebug("register.getChatLogEntryContext", { registered: true });

  if (!_ctxMenuDebugHelperRegistered) {
    _ctxMenuDebugHelperRegistered = true;
    game.uesrpg = game.uesrpg || {};
    game.uesrpg.debugContextMenu = {
      enable() {
        globalThis.__UESRPG_CTX_MENU_DEBUG__ = true;
        // eslint-disable-next-line no-console
        console.log("UESRPG | ContextMenuDebug enabled");
      },
      disable() {
        globalThis.__UESRPG_CTX_MENU_DEBUG__ = false;
        // eslint-disable-next-line no-console
        console.log("UESRPG | ContextMenuDebug disabled");
      },
      status() {
        const enabled = _ctxMenuDebugEnabled();
        // eslint-disable-next-line no-console
        console.log("UESRPG | ContextMenuDebug status", { enabled, runtime: Boolean(globalThis?.__UESRPG_CTX_MENU_DEBUG__ === true) });
        return enabled;
      },
      inspectMessage(messageId) {
        const id = String(messageId ?? "").trim();
        const msg = id ? (game.messages?.get?.(id) ?? null) : null;
        const report = {
          messageId: id || null,
          found: Boolean(msg),
          isOpposed: Boolean(msg ? _isOpposedCardMessage(msg) : false),
          canRetarget: Boolean(msg ? canRetargetOpposedMessage(msg, game.user) : false),
          userId: game.user?.id ?? null,
          flags: msg?.flags?.["uesrpg-3ev4"] ?? null,
        };
        // eslint-disable-next-line no-console
        console.log("UESRPG | ContextMenuDebug inspectMessage", report);
        return report;
      },
      inspectLi(li) {
        const messageId = _getMessageIdFromContextLi(li);
        const report = this.inspectMessage(messageId);
        // eslint-disable-next-line no-console
        console.log("UESRPG | ContextMenuDebug inspectLi", {
          messageId,
          hasElement: Boolean(li instanceof HTMLElement ? li : li?.[0]),
        });
        return report;
      },
      inspectLatest() {
        const selectors = [
          "#chat-log li.chat-message:last-of-type",
          "#chat-log li.message:last-of-type",
          "#chat-log .chat-message:last-of-type",
          "#chat-log .message:last-of-type",
        ];
        let el = null;
        let matchedSelector = null;
        for (const sel of selectors) {
          const found = document.querySelector(sel);
          if (found) {
            el = found;
            matchedSelector = sel;
            break;
          }
        }
        if (!el) {
          // eslint-disable-next-line no-console
          console.log("UESRPG | ContextMenuDebug inspectLatest", { found: false, selectors });
          return this.inspectLi(null);
        }
        // eslint-disable-next-line no-console
        console.log("UESRPG | ContextMenuDebug inspectLatest", { found: true, matchedSelector, className: el.className, id: el.id });
        return this.inspectLi(el);
      },
    };
  }

  const addOpposedContextOptions = (hookName, options) => {
    if (!Array.isArray(options)) return;
    _ctxMenuDebug(`hook.${hookName}.fired`, { optionsCountBefore: options.length });

    pushContextOptionOnce(options, {
      name: "Change attacker",
      icon: '<i class="fas fa-user-pen"></i>',
      condition: (li) => {
        const messageId = _getMessageIdFromContextLi(li);
        if (!messageId) {
          _ctxMenuDebug("condition.changeAttacker.noMessageId");
          return false;
        }
        const message = game.messages?.get?.(messageId) ?? null;
        if (!message || !_isOpposedCardMessage(message)) {
          _ctxMenuDebug("condition.changeAttacker.notOpposed", { messageId, hasMessage: Boolean(message) });
          return false;
        }
        const allowed = canRetargetOpposedMessage(message, game.user);
        _ctxMenuDebug("condition.changeAttacker.result", { messageId, allowed, userId: game.user?.id ?? null });
        return allowed;
      },
      callback: async (li) => {
        await _executeContextRetarget(li, { role: "attacker" });
      },
    });

    pushContextOptionOnce(options, {
      name: "Change defender",
      icon: '<i class="fas fa-user-shield"></i>',
      condition: (li) => {
        const messageId = _getMessageIdFromContextLi(li);
        if (!messageId) {
          _ctxMenuDebug("condition.changeDefender.noMessageId");
          return false;
        }
        const message = game.messages?.get?.(messageId) ?? null;
        if (!message || !_isOpposedCardMessage(message)) {
          _ctxMenuDebug("condition.changeDefender.notOpposed", { messageId, hasMessage: Boolean(message) });
          return false;
        }
        const allowed = canRetargetOpposedMessage(message, game.user);
        _ctxMenuDebug("condition.changeDefender.result", { messageId, allowed, userId: game.user?.id ?? null });
        return allowed;
      },
      callback: async (li) => {
        await _executeContextRetarget(li, { role: "defender" });
      },
    });

    _ctxMenuDebug(`hook.${hookName}.optionsPushed`, { optionsCountAfter: options.length });
  };

  Hooks.on("getChatMessageContextOptions", (_html, options) => {
    addOpposedContextOptions("getChatMessageContextOptions", options);
    registerLuckContextMenuOptions("getChatMessageContextOptions", options);
  });
  Hooks.on("getChatLogEntryContext", (_html, options) => {
    addOpposedContextOptions("getChatLogEntryContext", options);
    registerLuckContextMenuOptions("getChatLogEntryContext", options);
  });
}
