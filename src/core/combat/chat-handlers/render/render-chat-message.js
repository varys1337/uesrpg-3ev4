/**
 * Normalize v13 `renderChatMessageHTML` payload to a DOM root element.
 */
export function getChatMessageRoot(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? null;
}
