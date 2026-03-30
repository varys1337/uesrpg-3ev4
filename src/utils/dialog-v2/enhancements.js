const _DIALOG_KEYBOARD_NS = "uesrpgDialogKeyboardEnhancements";
const _DIALOG_RESTORE_NS = "uesrpgDialogRestoreEnhancement";

function isDialogKeyboardEnhancementsEnabled() {
  try {
    return Boolean(game?.settings?.get?.("uesrpg-3ev4", "dialogKeyboardEnhancements"));
  } catch (_e) {
    return false;
  }
}

function resolveDialogRoot(dialogRef) {
  const base = dialogRef?.element ?? dialogRef;
  const root = base instanceof HTMLElement ? base : base?.[0];
  return root instanceof HTMLElement ? root : null;
}

function resolveDialogAppRoot(dialogRef) {
  const root = resolveDialogRoot(dialogRef);
  if (!root) return null;
  if (root.matches?.(".application, .app")) return root;
  return root.closest?.(".application, .app") ?? null;
}

function isElementVisibleAndEnabled(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el.closest("[hidden], [aria-hidden='true']")) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (style.pointerEvents === "none") return false;
  return el.getClientRects().length > 0;
}

function isRichTextContext(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("[contenteditable='true'], .editor, .tox, .prosemirror, .CodeMirror"));
}

function resolveActionButton(rootEl, explicitSelector, fallbackSelectors = []) {
  if (!rootEl) return null;

  const selectors = [];
  if (explicitSelector) selectors.push(explicitSelector);
  selectors.push(...fallbackSelectors);

  for (const selector of selectors) {
    try {
      const button = rootEl.querySelector(selector);
      if (isElementVisibleAndEnabled(button)) return button;
    } catch (_e) {
      // ignore invalid selectors
    }
  }
  return null;
}

function resolveDefaultButton(rootEl, defaultActionSelector) {
  const fallback = [
    "[data-action='yes']",
    "[data-action='ok']",
    ".dialog-buttons [autofocus]",
    ".dialog-buttons button.default",
    ".dialog-buttons button:not([disabled])",
    "footer button:not([disabled])",
  ];
  return resolveActionButton(rootEl, defaultActionSelector, fallback);
}

function resolveCancelButton(rootEl, cancelActionSelector) {
  const fallback = [
    "[data-action='cancel']",
    "[data-action='no']",
    "[data-action='close']",
    ".dialog-buttons button[data-action='cancel']",
    ".dialog-buttons button[data-action='no']",
    ".window-header .header-button.close",
  ];
  return resolveActionButton(rootEl, cancelActionSelector, fallback);
}

function focusFirstMeaningfulControl(rootEl) {
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
    const target = candidates.find(isElementVisibleAndEnabled);
    if (!target) continue;
    try {
      target.focus({ preventScroll: true });
    } catch (_e) {
      try { target.focus(); } catch (_ignored) { /* no-op */ }
    }
    break;
  }
}

function applyDialogKeyboardEnhancements(rootEl, { defaultActionSelector, cancelActionSelector } = {}) {
  if (!isDialogKeyboardEnhancementsEnabled()) return;
  if (!(rootEl instanceof HTMLElement)) return;
  if (rootEl.dataset[_DIALOG_KEYBOARD_NS] === "1") return;
  rootEl.dataset[_DIALOG_KEYBOARD_NS] = "1";

  try {
    requestAnimationFrame(() => {
      try {
        focusFirstMeaningfulControl(rootEl);
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
        const cancelBtn = resolveCancelButton(rootEl, cancelActionSelector);
        if (!cancelBtn) return;
        event.preventDefault();
        event.stopPropagation();
        cancelBtn.click();
        return;
      }

      if (event.key !== "Enter") return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (active?.matches?.("textarea, select")) return;
      if (isRichTextContext(active)) return;

      const defaultBtn = resolveDefaultButton(rootEl, defaultActionSelector);
      if (!defaultBtn) return;
      event.preventDefault();
      event.stopPropagation();
      defaultBtn.click();
    } catch (_e) {
      // no-op
    }
  }, true);
}

function applyDialogRestoreEnhancement(dialogRef) {
  const appEl = resolveDialogAppRoot(dialogRef);
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

export function renderWithDialogEnhancements(callerRender, selectors) {
  return (event, dialog) => {
    try {
      callerRender?.(event, dialog);
    } catch (_e) {
      // no-op
    }
    try {
      const rootEl = resolveDialogRoot(dialog);
      applyDialogKeyboardEnhancements(rootEl, selectors);
      applyDialogRestoreEnhancement(dialog);
    } catch (_e) {
      // no-op
    }
  };
}
