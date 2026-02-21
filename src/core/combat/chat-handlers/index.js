/**
 * src/core/combat/chat-handlers/index.js
 *
 * Public registration surface for combat chat handlers.
 * Keeps historical exports stable while exposing a canonical
 * `registerCombatChatHandlers()` entry point.
 */
import { initializeChatHandlers, registerCombatChatHooks } from "./legacy.js";

export function registerCombatChatHandlers() {
  initializeChatHandlers();
}

export { initializeChatHandlers, registerCombatChatHooks };
