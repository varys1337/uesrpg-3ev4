/**
 * src/utils/dialog-v2-helper.js
 *
 * Thin wrappers around Foundry v13 DialogV2 for common dialog patterns.
 * All helpers use `foundry.applications.api.DialogV2` internally.
 *
 * Usage:
 *   import { confirmDialog, alertDialog, promptDialog, customDialog } from "../../utils/dialog-v2-helper.js";
 */

const DialogV2 = foundry.applications.api.DialogV2;
const DEFAULT_DIALOG_CLASS = "uesrpg-dialog";
const _DIALOG_KEYBOARD_NS = "uesrpgDialogKeyboardEnhancements";
const _DIALOG_RESTORE_NS = "uesrpgDialogRestoreEnhancement";

function resolveDialogClasses({ classes = [], unstyled = false } = {}) {
  if (unstyled) return classes;
  const merged = Array.isArray(classes) ? [...classes] : [];
  if (!merged.includes(DEFAULT_DIALOG_CLASS)) merged.unshift(DEFAULT_DIALOG_CLASS);
  return merged;
}

function _isDialogKeyboardEnhancementsEnabled() {
  try {
    return Boolean(game?.settings?.get?.("uesrpg-3ev4", "dialogKeyboardEnhancements"));
  } catch (_e) {
    return false;
  }
}

function _resolveDialogRoot(dialogRef) {
  const base = dialogRef?.element ?? dialogRef;
  const root = base instanceof HTMLElement ? base : base?.[0];
  return root instanceof HTMLElement ? root : null;
}

function _resolveDialogAppRoot(dialogRef) {
  const root = _resolveDialogRoot(dialogRef);
  if (!root) return null;
  if (root.matches?.(".application, .app")) return root;
  return root.closest?.(".application, .app") ?? null;
}

function _isElementVisibleAndEnabled(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el.closest("[hidden], [aria-hidden='true']")) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (style.pointerEvents === "none") return false;
  return el.getClientRects().length > 0;
}

function _isRichTextContext(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("[contenteditable='true'], .editor, .tox, .prosemirror, .CodeMirror"));
}

function _resolveActionButton(rootEl, explicitSelector, fallbackSelectors = []) {
  if (!rootEl) return null;

  const selectors = [];
  if (explicitSelector) selectors.push(explicitSelector);
  selectors.push(...fallbackSelectors);

  for (const selector of selectors) {
    try {
      const button = rootEl.querySelector(selector);
      if (_isElementVisibleAndEnabled(button)) return button;
    } catch (_e) {
      // ignore invalid selectors
    }
  }
  return null;
}

function _resolveDefaultButton(rootEl, defaultActionSelector) {
  const fallback = [
    "[data-action='yes']",
    "[data-action='ok']",
    ".dialog-buttons [autofocus]",
    ".dialog-buttons button.default",
    ".dialog-buttons button:not([disabled])",
    "footer button:not([disabled])",
  ];
  return _resolveActionButton(rootEl, defaultActionSelector, fallback);
}

function _resolveCancelButton(rootEl, cancelActionSelector) {
  const fallback = [
    "[data-action='cancel']",
    "[data-action='no']",
    "[data-action='close']",
    ".dialog-buttons button[data-action='cancel']",
    ".dialog-buttons button[data-action='no']",
    ".window-header .header-button.close",
  ];
  return _resolveActionButton(rootEl, cancelActionSelector, fallback);
}

function _focusFirstMeaningfulControl(rootEl) {
  if (!rootEl) return;
  const selectors = [
    "[autofocus]",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "button",
  ];
  for (const selector of selectors) {
    const candidates = Array.from(rootEl.querySelectorAll(selector));
    const target = candidates.find(_isElementVisibleAndEnabled);
    if (!target) continue;
    try {
      target.focus({ preventScroll: true });
    } catch (_e) {
      try { target.focus(); } catch (_ignored) { /* no-op */ }
    }
    break;
  }
}

function _applyDialogKeyboardEnhancements(rootEl, { defaultActionSelector, cancelActionSelector } = {}) {
  if (!_isDialogKeyboardEnhancementsEnabled()) return;
  if (!(rootEl instanceof HTMLElement)) return;
  if (rootEl.dataset[_DIALOG_KEYBOARD_NS] === "1") return;
  rootEl.dataset[_DIALOG_KEYBOARD_NS] = "1";

  try {
    requestAnimationFrame(() => {
      try {
        _focusFirstMeaningfulControl(rootEl);
      } catch (_e) {
        // no-op
      }
    });
  } catch (_e) {
    // no-op
  }

  rootEl.addEventListener("keydown", (event) => {
    try {
      if (!(event instanceof KeyboardEvent)) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.key === "Escape") {
        const cancelBtn = _resolveCancelButton(rootEl, cancelActionSelector);
        if (!cancelBtn) return;
        event.preventDefault();
        event.stopPropagation();
        cancelBtn.click();
        return;
      }

      if (event.key !== "Enter") return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (active?.matches?.("textarea, select")) return;
      if (_isRichTextContext(active)) return;

      const defaultBtn = _resolveDefaultButton(rootEl, defaultActionSelector);
      if (!defaultBtn) return;
      event.preventDefault();
      event.stopPropagation();
      defaultBtn.click();
    } catch (_e) {
      // no-op
    }
  }, true);
}

function _applyDialogRestoreEnhancement(dialogRef) {
  const appEl = _resolveDialogAppRoot(dialogRef);
  if (!(appEl instanceof HTMLElement)) return;
  if (appEl.dataset[_DIALOG_RESTORE_NS] === "1") return;
  appEl.dataset[_DIALOG_RESTORE_NS] = "1";

  appEl.addEventListener("dblclick", (event) => {
    try {
      const windowEl = event?.currentTarget;
      const isMinimized = Boolean(dialogRef?.minimized) || windowEl?.classList?.contains("minimized");
      if (!isMinimized || typeof dialogRef?.maximize !== "function") return;

      const target = event?.target;
      if (target instanceof Element) {
        const controlHit = target.closest(".header-control, button, a, .controls-dropdown, .control-icon, [data-action]");
        if (controlHit) return;
      }

      event.preventDefault();
      event.stopPropagation();
      const result = dialogRef.maximize();
      result?.catch?.(() => {});
    } catch (_e) {
      // no-op
    }
  }, true);
}

function _renderWithEnhancements(callerRender, selectors) {
  return (event, dialog) => {
    try {
      callerRender?.(event, dialog);
    } catch (_e) {
      // no-op
    }
    try {
      const rootEl = _resolveDialogRoot(dialog);
      _applyDialogKeyboardEnhancements(rootEl, selectors);
      _applyDialogRestoreEnhancement(dialog);
    } catch (_e) {
      // no-op
    }
  };
}

/* ──────────────────────────────────────────────────────────────────────
 * confirmDialog — Yes/No confirmation prompt (returns boolean | null)
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Show a confirmation dialog.
 *
 * @param {object} options
 * @param {string} options.title       - Window title
 * @param {string} options.content     - HTML or plain text body
 * @param {string} [options.yesLabel="Confirm"]  - Affirmative button label
 * @param {string} [options.noLabel="Cancel"]    - Negative button label
 * @param {string} [options.yesIcon="fas fa-check"] - Affirmative button icon
 * @param {string} [options.noIcon="fas fa-times"]  - Negative button icon
 * @param {string[]} [options.classes=[]]        - Additional CSS classes for the dialog window
 * @param {boolean} [options.unstyled=false]     - If true, skip default UESRPG dialog class injection
 * @param {boolean} [options.rejectClose=false]  - If true, closing without choosing rejects the Promise
 * @returns {Promise<boolean|null>} true if confirmed, false if denied, null if closed without choosing (when rejectClose=false)
 */
export async function confirmDialog({
  title,
  content,
  yesLabel = "Confirm",
  noLabel = "Cancel",
  yesIcon = "fas fa-check",
  noIcon = "fas fa-times",
  classes = [],
  unstyled = false,
  rejectClose = false,
  render,
} = {}) {
  return DialogV2.confirm({
    window: { title },
    content,
    yes: { label: yesLabel, icon: yesIcon },
    no: { label: noLabel, icon: noIcon },
    classes: resolveDialogClasses({ classes, unstyled }),
    rejectClose,
    render: _renderWithEnhancements(render, {
      defaultActionSelector: "[data-action='yes']",
      cancelActionSelector: "[data-action='no']",
    }),
  });
}

/* ──────────────────────────────────────────────────────────────────────
 * alertDialog — Single-button informational / error / warning dialog
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Show a single-button informational dialog.
 *
 * @param {object} options
 * @param {string} options.title              - Window title
 * @param {string} options.content            - HTML body
 * @param {string} [options.buttonLabel="OK"] - Button label
 * @param {string} [options.buttonIcon="fas fa-check"] - Button icon
 * @param {string[]} [options.classes=[]]      - Additional CSS classes for the dialog window
 * @param {boolean} [options.unstyled=false]   - If true, skip default UESRPG dialog class injection
 * @returns {Promise<void>}
 */
export async function alertDialog({
  title,
  content,
  buttonLabel = "OK",
  buttonIcon = "fas fa-check",
  classes = [],
  unstyled = false,
  render,
} = {}) {
  return DialogV2.prompt({
    window: { title },
    content,
    ok: { label: buttonLabel, icon: buttonIcon, callback: () => {} },
    classes: resolveDialogClasses({ classes, unstyled }),
    rejectClose: false,
    render: _renderWithEnhancements(render, {
      defaultActionSelector: "[data-action='ok']",
      cancelActionSelector: "[data-action='close']",
    }),
  });
}

/* ──────────────────────────────────────────────────────────────────────
 * promptDialog — Single-button dialog that returns a callback result
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Show a prompt dialog with custom content and a callback on the OK button.
 * The callback receives the dialog's HTML element and should return the desired value.
 *
 * @param {object} options
 * @param {string} options.title                - Window title
 * @param {string} options.content              - HTML body (should contain form inputs)
 * @param {string} [options.okLabel="OK"]       - OK button label
 * @param {string} [options.okIcon="fas fa-check"] - OK button icon
 * @param {Function} options.callback           - `(html: HTMLElement) => any` — extracts data from the dialog
 * @param {string[]} [options.classes=[]]       - Additional CSS classes for the dialog window
 * @param {boolean} [options.unstyled=false]    - If true, skip default UESRPG dialog class injection
 * @param {boolean} [options.rejectClose=false] - If true, closing without clicking OK rejects
 * @returns {Promise<any>} The return value of the callback, or null if closed
 */
export async function promptDialog({
  title,
  content,
  okLabel = "OK",
  okIcon = "fas fa-check",
  callback,
  classes = [],
  unstyled = false,
  rejectClose = false,
  render,
} = {}) {
  // DialogV2 button callbacks receive (event, button, dialog).
  // Wrap the user's callback so it receives just the dialog HTMLElement,
  // matching the ergonomic (html) => ... pattern used by callers.
  //
  // DialogV2.prompt() may resolve with the action string rather than the
  // callback's return value (same behavior as DialogV2.wait()). Capture
  // the result ourselves to guarantee callers get the callback's value.
  let _callbackResult;
  let _callbackInvoked = false;

  const wrappedCb = callback
    ? (event, button, dialog) => {
        const el = dialog?.element ?? dialog;
        _callbackResult = callback(el);
        _callbackInvoked = true;
        return _callbackResult;
      }
    : () => null;

  const action = await DialogV2.prompt({
    window: { title },
    content,
    ok: { label: okLabel, icon: okIcon, callback: wrappedCb },
    classes: resolveDialogClasses({ classes, unstyled }),
    rejectClose,
    render: _renderWithEnhancements(render, {
      defaultActionSelector: "[data-action='ok']",
      cancelActionSelector: "[data-action='close']",
    }),
  });

  return _callbackInvoked ? _callbackResult : action;
}

/* ──────────────────────────────────────────────────────────────────────
 * customDialog — Multi-button dialog with arbitrary actions
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Show a dialog with custom buttons.
 *
 * Supports two calling conventions:
 *   1. `buttons: { id: { label, icon?, callback? }, ... }` — arbitrary button map
 *   2. `yes: { label, icon?, callback? }, no: { label, icon?, callback? }` — shorthand for two-button dialogs
 *
 * Button callbacks receive the dialog HTMLElement as their sole argument:
 *   `(html: HTMLElement) => any`
 * This abstracts away the underlying DialogV2 signature of `(event, button, dialog)`.
 *
 * @param {object} options
 * @param {string} options.title    - Window title
 * @param {string} options.content  - HTML body
 * @param {object} [options.buttons]  - Map of `{ buttonId: { label, icon?, callback? } }`
 * @param {object} [options.yes]      - Shorthand: affirmative button config
 * @param {object} [options.no]       - Shorthand: negative button config
 * @param {string} [options.default]  - The default button id (triggered by Enter)
 * @param {string} [options.defaultButton] - Alias for `default` (avoids reserved word awkwardness)
 * @param {boolean} [options.rejectClose=false]
 * @param {string[]} [options.classes=[]] - Additional CSS classes for the dialog window
 * @param {boolean} [options.unstyled=false] - If true, skip default UESRPG dialog class injection
 * @param {number} [options.width] - Dialog width in pixels
 * @param {number} [options.height] - Dialog height in pixels
 * @param {Function} [options.render] - Callback invoked after each render: `(event, dialog: HTMLElement) => void`
 * @returns {Promise<any>} The return value from the chosen button's callback, or the button action id if no callback is set
 */
export async function customDialog({
  title,
  content,
  buttons,
  yes,
  no,
  default: defaultButton,
  defaultButton: defaultButtonAlias,
  rejectClose = false,
  classes = [],
  unstyled = false,
  width,
  height,
  render,
} = {}) {
  // Support shorthand yes/no as top-level keys
  if (!buttons && (yes || no)) {
    buttons = {};
    if (yes) buttons.yes = yes;
    if (no) buttons.no = no;
  }

  const resolvedDefault = defaultButton ?? defaultButtonAlias;

  // Build buttons array for DialogV2.
  // DialogV2 expects [ { action, label, icon?, default?, callback? } ].
  // Button callbacks in DialogV2 receive (event, button, dialog).
  // We wrap user-supplied callbacks so they receive just (dialog: HTMLElement),
  // matching the ergonomic pattern callers expect.
  //
  // IMPORTANT: DialogV2.wait() resolves with the button **action string** (e.g. "continue"),
  // NOT the callback's return value. We capture the callback result ourselves so callers
  // receive the object they expect (weapon selection, form data, etc.).
  let _callbackResult;
  let _callbackInvoked = false;

  const dialogButtons = [];
  for (const [id, btn] of Object.entries(buttons ?? {})) {
    dialogButtons.push({
      action: id,
      label: btn.label,
      icon: btn.icon ?? undefined,
      default: id === resolvedDefault,
      callback: btn.callback
        ? (event, button, dialog) => {
            const el = dialog?.element ?? dialog;
            _callbackResult = btn.callback(el);
            _callbackInvoked = true;
            return _callbackResult;
          }
        : undefined,
    });
  }

  const position = {};
  if (width) position.width = width;
  if (height) position.height = height;

  const action = await DialogV2.wait({
    window: { title },
    content,
    buttons: dialogButtons,
    rejectClose,
    ...(Object.keys(position).length ? { position } : {}),
    classes: resolveDialogClasses({ classes, unstyled }),
    render: _renderWithEnhancements(render, {
      defaultActionSelector: resolvedDefault ? `[data-action='${resolvedDefault}']` : null,
      cancelActionSelector: (buttons?.cancel || buttons?.no) ? (buttons?.cancel ? "[data-action='cancel']" : "[data-action='no']") : "[data-action='close']",
    }),
  });

  // Return the callback's result when one was invoked; otherwise fall back to
  // the raw action value (null/undefined when closed without choosing a button).
  return _callbackInvoked ? _callbackResult : action;
}

/* ──────────────────────────────────────────────────────────────────────
 * renderDialogContent — Render a Handlebars template for dialog use
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Convenience wrapper for rendering Handlebars templates for dialog content.
 *
 * @param {string} templatePath - Path to the Handlebars template (relative to systems/)
 * @param {object} [data={}]    - Template context data
 * @returns {Promise<string>} Rendered HTML string
 */
export async function renderDialogContent(templatePath, data = {}) {
  return foundry.applications.handlebars.renderTemplate(templatePath, data);
}
