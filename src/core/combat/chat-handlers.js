/**
 * src/core/combat/chat-handlers.js
 *
 * Backward-compatible shim.
 * Existing imports should continue to work while the implementation lives under ./chat-handlers/.
 */
export {
  initializeChatHandlers,
  registerCombatChatHooks,
  registerCombatChatHandlers
} from "./chat-handlers/index.js";
