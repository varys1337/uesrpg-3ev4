/**
 * Resolve a chat message id from a context-menu list item reference.
 * Supports plain HTMLElements and jQuery-like wrappers used by Foundry hooks.
 *
 * @param {HTMLElement|object|null} li
 * @returns {string|null}
 */
export function getMessageIdFromContextLi(li) {
  if (!li) return null;

  const el = li instanceof HTMLElement ? li : li?.[0];
  if (el?.dataset?.messageId) return String(el.dataset.messageId);

  if (el?.getAttribute) {
    const attrId = String(el.getAttribute("data-message-id") ?? "").trim();
    if (attrId) return attrId;

    const elId = String(el.id ?? "").trim();
    const m = /^chat-message-(.+)$/.exec(elId);
    if (m?.[1]) return String(m[1]);
  }

  if (typeof li?.data === "function") {
    const id = li.data("messageId");
    if (id != null) return String(id);
  }

  if (typeof li?.attr === "function") {
    const attrId = String(li.attr("data-message-id") ?? "").trim();
    if (attrId) return attrId;

    const elId = String(li.attr("id") ?? "").trim();
    const m = /^chat-message-(.+)$/.exec(elId);
    if (m?.[1]) return String(m[1]);
  }

  return null;
}
