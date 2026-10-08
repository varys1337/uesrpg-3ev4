/**
 * Compatibility facade for ChatMessage persistence.
 *
 * Legacy broadcast socket mutation listeners were removed because socket
 * payloads do not provide an authenticated requester. Cross-owner workflow
 * updates now use requester-backed authority intents.
 */

import {
  registerAuthorityProxy,
  requestUpdateChatMessage,
  sanitizeChatMessageUpdatePayload,
} from "./authority-proxy.js";

export function registerChatMessageSocket() {
  registerAuthorityProxy();
}

export async function safeUpdateChatMessage(message, payload, options) {
  return requestUpdateChatMessage(message, payload, options);
}

export { sanitizeChatMessageUpdatePayload };
