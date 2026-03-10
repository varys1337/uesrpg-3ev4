/**
 * src/core/combat/chat-handlers/index.js
 *
 * Public registration surface for combat chat handlers.
 */
import { initializeChatHandlers } from "./combat-chat-register.js";

export function registerCombatChatHandlers() {
  try {
    initializeChatHandlers();
  } catch (err) {
    console.error("UESRPG | registerCombatChatHandlers failed", err);
  }
}
