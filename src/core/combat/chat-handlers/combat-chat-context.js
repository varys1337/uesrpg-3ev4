/**
 * Documented ChatLog context-menu integration for UESRPG chat actions.
 */

import { canRetargetOpposedMessage, retargetOpposedMessage } from "../opposed/retarget.js";
import { registerLuckContextMenuOptions } from "../../luck/luck-workflow.js";
import { isDebugEnabled } from "../../../utils/debug.js";
import { pushContextOptionOnce } from "./actions/handle-contextmenu.js";
import { getMessageIdFromContextLi } from "../../../utils/chat/contextmenu.js";
import { t } from "../../../utils/i18n.js";

const CHAT_CONTEXT_ACTION_CLASS = "uesrpg-chat-context-action";
const CHAT_ROLL_CONTEXT_SOURCE = "Chat Roll";

let _chatContextHandlersRegistered = false;
let _ctxMenuDebugHelperRegistered = false;
let _uesrpgChatLogClass = null;

function _ctxMenuDebugEnabled() {
  const runtimeToggle = Boolean(globalThis?.__UESRPG_CTX_MENU_DEBUG__ === true);
  return isDebugEnabled("opposedDebug", { runtimeToggle });
}

function _ctxMenuDebug(event, payload = {}) {
  if (_ctxMenuDebugEnabled()) console.debug(`UESRPG | ContextMenuDebug | ${event}`, payload);
}

function _getMessageIdFromContextLi(target) {
  const messageId = getMessageIdFromContextLi(target);
  _ctxMenuDebug(messageId ? "resolveMessageId.success" : "resolveMessageId.failed", { messageId });
  return messageId;
}

function _getSingleUserSelectedToken() {
  const controlled = Array.from(canvas?.tokens?.controlled ?? []);
  return controlled.length === 1 ? (controlled[0] ?? null) : null;
}

function _getControlledActors() {
  const actors = [];
  const seen = new Set();
  for (const token of Array.from(canvas?.tokens?.controlled ?? [])) {
    const actor = token?.actor ?? null;
    if (!actor?.uuid || (!game.user?.isGM && !actor.isOwner) || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    actors.push(actor);
  }
  return actors;
}

function _getMessageRollTotal(message) {
  const rolls = Array.isArray(message?.rolls) ? message.rolls : Array.from(message?.rolls ?? []);
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

function _getContextMessage(target) {
  const messageId = _getMessageIdFromContextLi(target);
  return messageId ? (game.messages?.get?.(messageId) ?? null) : null;
}

function _canApplyChatRoll(target) {
  const total = _getMessageRollTotal(_getContextMessage(target));
  return Number.isFinite(total) && total > 0 && _getControlledActors().length > 0;
}

function _chatRollAmount(message, multiplier = 1) {
  const total = Number(_getMessageRollTotal(message));
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.floor(total * Number(multiplier || 1)));
}

async function _applyChatRollToControlledActors(target, { mode = "damage", multiplier = 1 } = {}) {
  const message = _getContextMessage(target);
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
    } catch (error) {
      failures.push(actor.name ?? actor.uuid);
      console.error("UESRPG | Failed to apply chat roll context action", { actor, mode, amount, error });
    }
  }

  if (failures.length) ui.notifications?.warn?.(`Failed to apply roll to: ${failures.join(", ")}`);
}

function _isOpposedCardMessage(message) {
  const flags = message?.flags?.["uesrpg-3ev4"] ?? {};
  return Boolean(flags.opposed || flags.skillOpposed || flags.magicOpposed);
}

function _canRetargetContextMessage(target) {
  const message = _getContextMessage(target);
  return Boolean(message && _isOpposedCardMessage(message) && canRetargetOpposedMessage(message, game.user));
}

async function _executeContextRetarget(target, { role = "attacker" } = {}) {
  const message = _getContextMessage(target);
  if (!message) return;

  const selected = _getSingleUserSelectedToken();
  if (!selected) {
    ui.notifications?.warn?.(`Select exactly 1 token to change the ${role}.`);
    return;
  }

  const selectedTokenUuid = selected.document?.uuid ?? selected.uuid ?? null;
  const update = role === "defender"
    ? { defenderTokenUuid: selectedTokenUuid }
    : { attackerTokenUuid: selectedTokenUuid };
  await retargetOpposedMessage(message, update, {
    userId: game.user?.id ?? null,
    reason: `context-change-${role}`,
  });
}

function _registerChatRollContextOptions(options) {
  if (!Array.isArray(options)) return;

  const definitions = [
    ["UESRPG.Chat.Context.ApplyAsDamage", "Apply As Damage", "fas fa-user-minus", "damage", 1],
    ["UESRPG.Chat.Context.ApplyAsHealing", "Apply As Healing", "fas fa-user-plus", "healing", 1],
    ["UESRPG.Chat.Context.ApplyAsTemporaryHp", "Apply As Temporary HP", "fas fa-user-clock", "temporary", 1],
    ["UESRPG.Chat.Context.ApplyDoubleAsDamage", "Apply Double As Damage", "fas fa-user-injured", "damage", 2],
    ["UESRPG.Chat.Context.ApplyHalfAsDamage", "Apply Half As Damage", "fas fa-user-shield", "damage", 0.5],
  ];

  for (const [localizationKey, fallback, icon, mode, multiplier] of definitions) {
    pushContextOptionOnce(options, {
      label: t(localizationKey, fallback),
      icon: `<i class="${icon}"></i>`,
      group: "damage",
      visible: _canApplyChatRoll,
      onClick: (event, target) => _applyChatRollToControlledActors(target ?? event, { mode, multiplier }),
    });
  }
}

function _registerOpposedContextOptions(options) {
  if (!Array.isArray(options)) return;
  pushContextOptionOnce(options, {
    label: "Change attacker",
    icon: '<i class="fas fa-user-pen"></i>',
    visible: _canRetargetContextMessage,
    onClick: (event, target) => _executeContextRetarget(target ?? event, { role: "attacker" }),
  });
  pushContextOptionOnce(options, {
    label: "Change defender",
    icon: '<i class="fas fa-user-shield"></i>',
    visible: _canRetargetContextMessage,
    onClick: (event, target) => _executeContextRetarget(target ?? event, { role: "defender" }),
  });
}

function _addContextActionClass(option) {
  const classes = new Set(String(option?.classes ?? "").split(/\s+/).filter(Boolean));
  classes.add(CHAT_CONTEXT_ACTION_CLASS);
  option.classes = [...classes].join(" ");
}

export function buildUESRPGChatContextOptions(baseOptions = []) {
  const options = Array.isArray(baseOptions) ? [...baseOptions] : [];
  const firstSystemEntry = options.length;
  _registerChatRollContextOptions(options);
  _registerOpposedContextOptions(options);
  registerLuckContextMenuOptions("ChatLog._getEntryContextOptions", options);
  for (const option of options.slice(firstSystemEntry)) _addContextActionClass(option);
  return options;
}

/**
 * Install the system ChatLog subclass through Foundry's documented CONFIG.ui extension point.
 */
export function registerUESRPGChatLogClass() {
  if (_uesrpgChatLogClass && CONFIG?.ui?.chat === _uesrpgChatLogClass) return _uesrpgChatLogClass;

  const BaseChatLog = CONFIG?.ui?.chat ?? foundry?.applications?.sidebar?.tabs?.ChatLog;
  if (typeof BaseChatLog !== "function") {
    throw new Error("UESRPG | CONFIG.ui.chat does not provide a ChatLog class");
  }

  class UESRPGChatLog extends BaseChatLog {
    _getEntryContextOptions() {
      return buildUESRPGChatContextOptions(super._getEntryContextOptions());
    }
  }

  _uesrpgChatLogClass = UESRPGChatLog;
  CONFIG.ui.chat = UESRPGChatLog;
  return UESRPGChatLog;
}

function _registerContextMenuDebugApi() {
  if (_ctxMenuDebugHelperRegistered) return;
  _ctxMenuDebugHelperRegistered = true;
  game.uesrpg = game.uesrpg || {};
  game.uesrpg.debugContextMenu = {
    enable() {
      globalThis.__UESRPG_CTX_MENU_DEBUG__ = true;
      console.log("UESRPG | ContextMenuDebug enabled");
    },
    disable() {
      globalThis.__UESRPG_CTX_MENU_DEBUG__ = false;
      console.log("UESRPG | ContextMenuDebug disabled");
    },
    status() {
      const enabled = _ctxMenuDebugEnabled();
      console.log("UESRPG | ContextMenuDebug status", { enabled });
      return enabled;
    },
    inspectMessage(messageId) {
      const id = String(messageId ?? "").trim();
      const message = id ? (game.messages?.get?.(id) ?? null) : null;
      const report = {
        messageId: id || null,
        found: Boolean(message),
        isOpposed: Boolean(message ? _isOpposedCardMessage(message) : false),
        canRetarget: Boolean(message ? canRetargetOpposedMessage(message, game.user) : false),
        userId: game.user?.id ?? null,
        flags: message?.flags?.["uesrpg-3ev4"] ?? null,
      };
      console.log("UESRPG | ContextMenuDebug inspectMessage", report);
      return report;
    },
    inspectLi(target) {
      return this.inspectMessage(_getMessageIdFromContextLi(target));
    },
    inspectLatest() {
      const target = document.querySelector("#chat-log :is(li.chat-message, li.message):last-of-type");
      return this.inspectLi(target);
    },
  };
}

export function registerCombatChatContextHandlers() {
  if (_chatContextHandlersRegistered) return;
  _chatContextHandlersRegistered = true;
  _registerContextMenuDebugApi();
}
