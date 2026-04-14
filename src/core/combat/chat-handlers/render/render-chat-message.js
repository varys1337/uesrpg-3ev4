/**
 * Normalize `renderChatMessageHTML` payloads to a DOM root element.
 */
export function resolveHtmlRoot(html) {
  if (html instanceof HTMLElement) return html;
  if (html instanceof DocumentFragment) return html.firstElementChild ?? null;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

export function getChatMessageRoot(html) {
  return resolveHtmlRoot(html);
}
