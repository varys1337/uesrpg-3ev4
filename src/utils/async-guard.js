/**
 * Async handler double-click guard utility.
 *
 * Prevents duplicate execution of async UI handlers caused by rapid
 * double-clicks.  Uses a WeakSet keyed on the event's `currentTarget`
 * (DOM element) so each button/link is independently guarded while
 * still allowing different elements to fire concurrently.
 *
 * Includes a built-in error boundary: if the wrapped handler throws,
 * the error is logged and the guard is released without propagating
 * an unhandled rejection.
 *
 * Usage:
 *   import { asyncGuard } from "../utils/async-guard.js";
 *
 *   // Wrap an existing handler
 *   const safePlusQty = asyncGuard(onPlusQty);
 *
 *   // Or inline
 *   el.addEventListener("click", asyncGuard(async (ev) => { ... }));
 *
 *   // For sheet-shared handlers that take (sheet, event, ...rest)
 *   const safeToggle = asyncGuardSheet(onToggle2H);
 *   // binds as:  safeToggle(sheet, event)
 */

/**
 * In-flight set: tracks DOM elements that currently have an async
 * handler executing.  WeakSet allows GC of detached elements.
 * @type {WeakSet<EventTarget>}
 */
const _inFlight = new WeakSet();

/**
 * Wrap an async event handler so it cannot fire twice concurrently
 * on the same DOM element.
 *
 * The returned wrapper:
 * 1. Checks `event.currentTarget` against the in-flight set
 * 2. If already in-flight → returns immediately (swallows the click)
 * 3. Adds the element to the set, optionally adds a CSS class
 * 4. Awaits the handler
 * 5. Releases the guard in a `finally` block
 * 6. Catches and logs any error (error boundary)
 *
 * @param {Function} handler  - `async (event, ...args) => void`
 * @param {object}   [opts]
 * @param {string}   [opts.busyClass="uesrpg-busy"] - CSS class added while busy (falsy to skip)
 * @returns {Function}  Guarded wrapper with the same signature
 */
export function asyncGuard(handler, { busyClass = "uesrpg-busy" } = {}) {
  return async function guardedHandler(event, ...args) {
    const target = event?.currentTarget ?? event?.target;
    if (!target || _inFlight.has(target)) return;

    _inFlight.add(target);
    if (busyClass && target.classList) target.classList.add(busyClass);

    try {
      return await handler.call(this, event, ...args);
    } catch (err) {
      console.error("UESRPG | Async handler error:", err);
    } finally {
      _inFlight.delete(target);
      if (busyClass && target.classList) target.classList.remove(busyClass);
    }
  };
}

/**
 * Variant for shared handler modules that are meant to be called from
 * AppV2 action maps with signature `(event, target)` and `this` bound
 * to the sheet instance.
 *
 * Guards on the resolved DOM element (prefers `target`, then
 * `event.currentTarget`).  Uses a named function expression so `this`
 * is forwarded faithfully from AppV2's `.call(sheet, event, target)`.
 *
 * @param {Function} handler  - `async function(event, target, ...rest) { this === sheet }`
 * @param {object}   [opts]
 * @param {string}   [opts.busyClass="uesrpg-busy"] - CSS class added while busy
 * @returns {Function}  Guarded wrapper with `(event, target, ...rest)` signature
 */
export function asyncGuardSheet(handler, { busyClass = "uesrpg-busy" } = {}) {
  return async function guardedSheetHandler(event, target, ...rest) {
    const el = target ?? event?.currentTarget ?? event?.target;
    if (!el || _inFlight.has(el)) return;

    _inFlight.add(el);
    if (busyClass && el.classList) el.classList.add(busyClass);

    try {
      return await handler.call(this, event, target, ...rest);
    } catch (err) {
      console.error("UESRPG | Async handler error:", err);
    } finally {
      _inFlight.delete(el);
      if (busyClass && el.classList) el.classList.remove(busyClass);
    }
  };
}
