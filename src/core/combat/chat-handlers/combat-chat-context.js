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
import { registerChatLogHostMount } from "./actions/handle-click.js";
import { getMessageIdFromContextLi } from "../../../utils/chat/contextmenu.js";
import { t } from "../../../utils/i18n.js";

let _chatContextHooksRegistered = false;
let _ctxMenuDebugHelperRegistered = false;
let _chatLogContextProbeRegistered = false;
let _chatContextMenuPatchRegistered = false;

const CHAT_CONTEXT_MENU_CLASS = "uesrpg-chat-context-menu";
const CHAT_CONTEXT_MENU_BODY_CLASS = "uesrpg-chat-context-menu-pending";
const CHAT_ROLL_CONTEXT_SOURCE = "Chat Roll";

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

function _getControlledActors() {
  const out = [];
  const seen = new Set();
  for (const token of Array.from(canvas?.tokens?.controlled ?? [])) {
    const actor = token?.actor ?? null;
    if (!actor?.uuid || (!game.user?.isGM && !actor.isOwner)) continue;
    if (seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    out.push(actor);
  }
  return out;
}

function _getContextMenuElement() {
  const menu = document.querySelector("#context-menu");
  return menu instanceof HTMLElement ? menu : null;
}

function _isChatContextMenuPending() {
  return Boolean(document.body?.classList?.contains?.(CHAT_CONTEXT_MENU_BODY_CLASS));
}

function _isChatContextMenuElement(menu) {
  return Boolean(menu?.dataset?.uesrpgChatContextMenu === "1" || menu?.classList?.contains?.(CHAT_CONTEXT_MENU_CLASS));
}

function _tagChatContextMenu(menu = _getContextMenuElement()) {
  if (!(menu instanceof HTMLElement)) return false;
  if (!_isChatContextMenuPending()) return false;
  menu.classList.add(CHAT_CONTEXT_MENU_CLASS);
  menu.dataset.uesrpgChatContextMenu = "1";
  return true;
}

function _clearChatContextMenuMarker() {
  document.body?.classList?.remove?.(CHAT_CONTEXT_MENU_BODY_CLASS);
}

function _clearChatContextMenuMarkerSoon() {
  queueMicrotask(() => {
    setTimeout(() => {
      if (!_isChatContextMenuElement(_getContextMenuElement())) _clearChatContextMenuMarker();
    }, 0);
  });
}

function _registerChatContextMenuPatch() {
  if (_chatContextMenuPatchRegistered) return;
  _chatContextMenuPatchRegistered = true;

  const ContextMenu = globalThis.foundry?.applications?.ux?.ContextMenu ?? globalThis.CONFIG?.ux?.ContextMenu;
  const proto = ContextMenu?.prototype;
  if (!proto || proto.__uesrpgChatContextMenuPatch === true) return;
  Object.defineProperty(proto, "__uesrpgChatContextMenuPatch", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  const originalPreRenderEntries = proto._preRenderEntries;
  if (typeof originalPreRenderEntries === "function") {
    proto._preRenderEntries = async function uesrpgChatContextPreRenderEntries(...args) {
      if (_isChatContextMenuPending()) this.element?.classList?.add?.(CHAT_CONTEXT_MENU_CLASS);
      return originalPreRenderEntries.apply(this, args);
    };
  }

  const originalSetPosition = proto._setPosition;
  if (typeof originalSetPosition === "function") {
    proto._setPosition = function uesrpgChatContextSetPosition(html, target, options = {}) {
      if (_isChatContextMenuPending()) _tagChatContextMenu(html);
      return originalSetPosition.call(this, html, target, options);
    };
  }

  const originalAnimate = proto._animate;
  if (typeof originalAnimate === "function") {
    proto._animate = async function uesrpgChatContextAnimate(...args) {
      if (_isChatContextMenuPending() || _isChatContextMenuElement(this?.element) || _isChatContextMenuElement(_getContextMenuElement())) {
        return undefined;
      }
      return originalAnimate.apply(this, args);
    };
  }

  document.addEventListener("pointerdown", _clearChatContextMenuMarkerSoon, true);

  document.addEventListener("keydown", (ev) => {
    if (ev?.key === "Escape") _clearChatContextMenuMarkerSoon();
  }, true);
}

function _getMessageRollTotal(message) {
  const rolls = Array.isArray(message?.rolls)
    ? message.rolls
    : Array.from(message?.rolls ?? []);
  let total = 0;
  let count = 0;
  for (const roll of rolls) {
    const value = Number(roll?.total);
    if (!Number.isFinite(value)) continue;
    total += value;
    count += 1;
  }
  return count > 0 ? total : null;
}

function _getContextMessage(li) {
  const messageId = _getMessageIdFromContextLi(li);
  return messageId ? (game.messages?.get?.(messageId) ?? null) : null;
}

function _canApplyChatRoll(li) {
  const message = _getContextMessage(li);
  const total = _getMessageRollTotal(message);
  return Number.isFinite(total) && total > 0 && _getControlledActors().length > 0;
}

function _chatRollAmount(message, multiplier = 1) {
  const total = Number(_getMessageRollTotal(message));
  if (!Number.isFinite(total) || total <= 0) return 0;
  const scaled = total * Number(multiplier || 1);
  return Math.max(0, Math.floor(scaled));
}

async function _applyChatRollToControlledActors(li, { mode = "damage", multiplier = 1 } = {}) {
  const message = _getContextMessage(li);
  if (!message) {
    ui.notifications?.warn?.("No chat message found for roll application.");
    return;
  }

  const actors = _getControlledActors();
  if (!actors.length) {
    ui.notifications?.warn?.("Select at least one token with an actor you can modify.");
    return;
  }

  const amount = _chatRollAmount(message, multiplier);
  if (amount <= 0) {
    ui.notifications?.warn?.("No positive roll total found on this chat message.");
    return;
  }

  const failures = [];
  for (const actor of actors) {
    try {
      if (mode === "healing" || mode === "temporary") {
        await actor.applyHealing(amount, {
          source: CHAT_ROLL_CONTEXT_SOURCE,
          isTemporary: mode === "temporary",
        });
      } else {
        await actor.applyDamage(amount, "physical", {
          source: CHAT_ROLL_CONTEXT_SOURCE,
          ignoreReduction: true,
        });
      }
    } catch (err) {
      failures.push(actor.name ?? actor.uuid);
      console.error("UESRPG | Failed to apply chat roll context action", { actor, mode, amount, err });
    }
  }

  if (failures.length) {
    ui.notifications?.warn?.(`Failed to apply roll to: ${failures.join(", ")}`);
  }
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

  registerChatLogHostMount("context-probe", ({ host }) => {
    if (host.dataset.uesrpgCtxProbe === "1") return;
    host.dataset.uesrpgCtxProbe = "1";

    host.addEventListener("contextmenu", (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target : null;
      const li = target?.closest?.(".message");
      const messageId = li ? _getMessageIdFromContextLi(li) : null;
      if (li) {
        document.body?.classList?.add?.(CHAT_CONTEXT_MENU_BODY_CLASS);
        _tagChatContextMenu();
      } else {
        _clearChatContextMenuMarker();
      }
      if (!_ctxMenuDebugEnabled()) return;
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

function _registerChatRollContextOptions(hookName, options) {
  if (!Array.isArray(options)) return;

  const labels = {
    damage: t("UESRPG.Chat.Context.ApplyAsDamage", "Apply As Damage"),
    healing: t("UESRPG.Chat.Context.ApplyAsHealing", "Apply As Healing"),
    temporary: t("UESRPG.Chat.Context.ApplyAsTemporaryHp", "Apply As Temporary HP"),
    doubleDamage: t("UESRPG.Chat.Context.ApplyDoubleAsDamage", "Apply Double As Damage"),
    halfDamage: t("UESRPG.Chat.Context.ApplyHalfAsDamage", "Apply Half As Damage"),
  };

  const entries = [
    {
      label: labels.damage,
      icon: '<i class="fas fa-user-minus"></i>',
      group: "damage",
      visible: _canApplyChatRoll,
      onClick: (event, target) => _applyChatRollToControlledActors(target ?? event, { mode: "damage", multiplier: 1 }),
    },
    {
      label: labels.healing,
      icon: '<i class="fas fa-user-plus"></i>',
      group: "damage",
      visible: _canApplyChatRoll,
      onClick: (event, target) => _applyChatRollToControlledActors(target ?? event, { mode: "healing", multiplier: 1 }),
    },
    {
      label: labels.temporary,
      icon: '<i class="fas fa-user-clock"></i>',
      group: "damage",
      visible: _canApplyChatRoll,
      onClick: (event, target) => _applyChatRollToControlledActors(target ?? event, { mode: "temporary", multiplier: 1 }),
    },
    {
      label: labels.doubleDamage,
      icon: '<i class="fas fa-user-injured"></i>',
      group: "damage",
      visible: _canApplyChatRoll,
      onClick: (event, target) => _applyChatRollToControlledActors(target ?? event, { mode: "damage", multiplier: 2 }),
    },
    {
      label: labels.halfDamage,
      icon: '<i class="fas fa-user-shield"></i>',
      group: "damage",
      visible: _canApplyChatRoll,
      onClick: (event, target) => _applyChatRollToControlledActors(target ?? event, { mode: "damage", multiplier: 0.5 }),
    },
  ];

  for (const entry of entries) pushContextOptionOnce(options, entry);
  _ctxMenuDebug(`hook.${hookName}.chatRollOptionsPushed`, { optionsCountAfter: options.length });
}

// ── Public registration ───────────────────────────────────────────────────────

export function registerCombatChatContextHandlers() {
  if (_chatContextHooksRegistered) return;

  try {
    _registerChatContextMenuPatch();
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
      label: "Change attacker",
      icon: '<i class="fas fa-user-pen"></i>',
      visible: (li) => {
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
      onClick: async (event, target) => {
        const li = target ?? event;
        await _executeContextRetarget(li, { role: "attacker" });
      },
    });

    pushContextOptionOnce(options, {
      label: "Change defender",
      icon: '<i class="fas fa-user-shield"></i>',
      visible: (li) => {
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
      onClick: async (event, target) => {
        const li = target ?? event;
        await _executeContextRetarget(li, { role: "defender" });
      },
    });

    _ctxMenuDebug(`hook.${hookName}.optionsPushed`, { optionsCountAfter: options.length });
  };

  Hooks.on("getChatMessageContextOptions", (_html, options) => {
    _registerChatRollContextOptions("getChatMessageContextOptions", options);
    addOpposedContextOptions("getChatMessageContextOptions", options);
    registerLuckContextMenuOptions("getChatMessageContextOptions", options);
  });
  Hooks.on("getChatLogEntryContext", (_html, options) => {
    _registerChatRollContextOptions("getChatLogEntryContext", options);
    addOpposedContextOptions("getChatLogEntryContext", options);
    registerLuckContextMenuOptions("getChatLogEntryContext", options);
  });
}
