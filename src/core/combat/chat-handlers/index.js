/**
 * src/core/combat/chat-handlers/index.js
 *
 * Public registration surface for combat chat handlers.
 */
import { initializeChatHandlers } from "./legacy.js";

export function registerCombatChatHandlers() {
  try {
    initializeChatHandlers();
  } catch (err) {
    console.error("UESRPG | registerCombatChatHandlers failed", err);
  }
}
