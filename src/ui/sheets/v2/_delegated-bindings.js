/**
 * src/ui/sheets/v2/_delegated-bindings.js
 *
 * Tiny event delegation helper for ApplicationV2 sheets.
 *
 * We prefer delegation over per-element listeners to reduce `_onRender`
 * overhead for large lists (recipes and other repeated controls).
 */

/**
 * Attach a delegated DOM event listener.
 *
 * @template {Event} E
 * @param {HTMLElement} root          The element that owns the listener.
 * @param {string} eventType          Event type (e.g. "change", "click").
 * @param {string} selector           CSS selector to match via `closest`.
 * @param {(event: E, matched: HTMLElement) => (void|Promise<void>)} handler
 * @param {AddEventListenerOptions|boolean} [options]
 */
export function bindDelegated(root, eventType, selector, handler, options) {
  root.addEventListener(eventType, async (event) => {
    /** @type {HTMLElement|null} */
    const target = /** @type {any} */ (event.target);
    if (!target) return;

    const matched = target.closest?.(selector);
    if (!matched || !root.contains(matched)) return;

    try {
      await handler(/** @type {any} */ (event), /** @type {any} */ (matched));
    } catch (err) {
      console.warn(`UESRPG | Delegated handler failed for ${eventType} ${selector}`, err);
    }
  }, options);
}
