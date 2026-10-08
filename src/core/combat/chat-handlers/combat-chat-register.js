/**
 * src/core/combat/chat-handlers/combat-chat-register.js
 *
 * Thin registration hub — wires Hooks to the focused handler modules.
 * Replaces the monolithic initializeChatHandlers() in legacy.js.
 */

import { resolveHtmlRoot } from "./render/render-chat-message.js";
import { augmentChatMessageHTML } from "./combat-chat-render.js";
import { onCreateChatMessageOpposed, onUpdateChatMessageOpposed, onUpdateActorOpposedDefenses } from "./combat-chat-opposed.js";
import { registerCombatChatClickHandler } from "./combat-chat-actions.js";
import { registerCombatChatContextHandlers } from "./combat-chat-context.js";
import { registerCombatOutcomeAuthorityIntent } from "./combat-chat-apply.js";
import { ChatOutcomeApplicationService, refreshChatOutcomeMessages } from "../../../application/combat/chat-outcome-application-service.js";
import { hasDamageReceiptUpdate } from "../damage/receipt-metadata.js";

let _chatHooksRegistered = false;
let _createHookRegistered = false;
let _updateHookRegistered = false;
let _deleteHookRegistered = false;
let _renderHookRegistered = false;
let _actorHookRegistered = false;
let _recoveryHooksRegistered = false;

/**
 * Register all combat chat handlers (v14).
 * Guards against double-registration across multiple calls from init.js.
 */
export function initializeChatHandlers() {
  if (_chatHooksRegistered && _createHookRegistered && _updateHookRegistered && _deleteHookRegistered
    && _renderHookRegistered && _actorHookRegistered && _recoveryHooksRegistered) {
    return;
  }

  registerCombatChatClickHandler();
  registerCombatOutcomeAuthorityIntent();

  if (!_createHookRegistered) {
    Hooks.on("createChatMessage", (message) => {
      onCreateChatMessageOpposed(message);
      void ChatOutcomeApplicationService.onMessagePersisted(message);
    });
    _createHookRegistered = true;
  }

  if (!_updateHookRegistered) {
    Hooks.on("updateChatMessage", (message, changes, _options, _userId) => {
      onUpdateChatMessageOpposed(message, changes);
      void ChatOutcomeApplicationService.onMessagePersisted(message, changes);
    });
    _updateHookRegistered = true;
  }

  if (!_deleteHookRegistered) {
    Hooks.on("deleteChatMessage", message => ChatOutcomeApplicationService.forgetMessage(message));
    _deleteHookRegistered = true;
  }

  if (!_renderHookRegistered) {
    Hooks.on("renderChatMessageHTML", (message, html) => {
      const root = resolveHtmlRoot(html);
      if (!root) return;
      augmentChatMessageHTML(message, root);
      ChatOutcomeApplicationService.augment(message, root);
    });
    _renderHookRegistered = true;
  }

  if (!_actorHookRegistered) {
    Hooks.on("updateActor", (actor, changed) => {
      onUpdateActorOpposedDefenses(actor, changed).catch(err => console.error("UESRPG | AP defense reconciliation failed", err));
      if (hasDamageReceiptUpdate(changed)) refreshChatOutcomeMessages(actor);
      if (changed.ownership) refreshChatOutcomeMessages();
    });
    _actorHookRegistered = true;
  }

  if (!_recoveryHooksRegistered) {
    const recover = () => { void ChatOutcomeApplicationService.reconcile()
      .catch(error => console.error("UESRPG | Outcome reconciliation failed", error)); };
    Hooks.once("ready", recover);
    Hooks.on("userConnected", recover);
    _recoveryHooksRegistered = true;
  }

  registerCombatChatContextHandlers();

  _chatHooksRegistered = _createHookRegistered && _updateHookRegistered && _deleteHookRegistered
    && _renderHookRegistered && _actorHookRegistered && _recoveryHooksRegistered;
}
