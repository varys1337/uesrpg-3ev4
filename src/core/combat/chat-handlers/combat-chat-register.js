/**
 * src/core/combat/chat-handlers/combat-chat-register.js
 *
 * Thin registration hub — wires Hooks to the focused handler modules.
 * Replaces the monolithic initializeChatHandlers() in legacy.js.
 */

import { resolveHtmlRoot } from "./render/render-chat-message.js";
import { augmentChatMessageHTML } from "./combat-chat-render.js";
import { onCreateChatMessageOpposed, onUpdateChatMessageOpposed } from "./combat-chat-opposed.js";
import { registerCombatChatClickHandler } from "./combat-chat-actions.js";
import { registerCombatChatContextHandlers } from "./combat-chat-context.js";

let _chatHooksRegistered = false;
let _createHookRegistered = false;
let _updateHookRegistered = false;
let _renderHookRegistered = false;

/**
 * Register all combat chat handlers (v13).
 * Guards against double-registration across multiple calls from init.js.
 */
export function initializeChatHandlers() {
  if (_chatHooksRegistered && _createHookRegistered && _updateHookRegistered && _renderHookRegistered) {
    return;
  }

  registerCombatChatClickHandler();

  if (!_createHookRegistered) {
    Hooks.on("createChatMessage", (message) => {
      onCreateChatMessageOpposed(message);
    });
    _createHookRegistered = true;
  }

  if (!_updateHookRegistered) {
    Hooks.on("updateChatMessage", (message, changes, _options, _userId) => {
      onUpdateChatMessageOpposed(message, changes);
    });
    _updateHookRegistered = true;
  }

  if (!_renderHookRegistered) {
    Hooks.on("renderChatMessageHTML", (message, html) => {
      const root = resolveHtmlRoot(html);
      if (!root) return;
      augmentChatMessageHTML(message, root);
    });
    _renderHookRegistered = true;
  }

  registerCombatChatContextHandlers();

  _chatHooksRegistered = _createHookRegistered && _updateHookRegistered && _renderHookRegistered;
}
