/**
 * src/ui/sheets/v2/shared/window-restore-guard.js
 *
 * Shared window-restore guard for AppV2 actor-type sheets.
 * Extracted from PCActorSheetV2, NpcSheetV2, and GroupSheetV2 to eliminate
 * the three byte-for-byte identical inline implementations.
 *
 * Requires the sheet instance to expose two instance fields (already declared
 * on each class):
 *   _uesrpgRestoreDblClickHandler {Function|null}
 *   _uesrpgRestoreDblClickEl      {HTMLElement|null}
 */

/**
 * Wire up the double-click maximize guard on the application window element.
 * Call from _onRender / _bindWindowRestoreGuard after resolving rootEl.
 *
 * @param {ApplicationV2} sheet - The sheet instance (replaces `this`).
 * @param {HTMLElement|null} rootEl - The rendered root element of the sheet part.
 */
export function bindWindowRestoreGuard(sheet, rootEl) {
  if (!rootEl) return;
  const appEl = rootEl.closest(".application, .app");
  if (!(appEl instanceof HTMLElement)) return;

  if (sheet._uesrpgRestoreDblClickEl && sheet._uesrpgRestoreDblClickEl !== appEl && sheet._uesrpgRestoreDblClickHandler) {
    sheet._uesrpgRestoreDblClickEl.removeEventListener("dblclick", sheet._uesrpgRestoreDblClickHandler, true);
  }

  if (!sheet._uesrpgRestoreDblClickHandler) {
    sheet._uesrpgRestoreDblClickHandler = (event) => {
      try {
        const windowEl = event?.currentTarget;
        const isMinimized = Boolean(sheet.minimized) || windowEl?.classList?.contains("minimized");
        if (!isMinimized || typeof sheet.maximize !== "function") return;

        const target = event?.target;
        if (target instanceof Element) {
          const controlHit = target.closest(".header-control, button, a, .controls-dropdown, .control-icon, [data-action]");
          if (controlHit) return;
        }

        event.preventDefault();
        event.stopPropagation();
        const result = sheet.maximize();
        result?.catch?.(() => {});
      } catch (_err) {
        // no-op
      }
    };
  }

  if (sheet._uesrpgRestoreDblClickEl !== appEl) {
    appEl.addEventListener("dblclick", sheet._uesrpgRestoreDblClickHandler, true);
    sheet._uesrpgRestoreDblClickEl = appEl;
  }
}

/**
 * Log a warning if multiple sidebars (.sheet-fixed-container) are detected in
 * the rendered application — indicates a duplicate-part render anomaly.
 *
 * @param {ApplicationV2} sheet - The sheet instance.
 * @param {string} sheetLabel - Class name string for the log payload (e.g. "PCActorSheetV2").
 * @param {HTMLElement|null} rootEl - The rendered root element.
 * @param {object} options - AppV2 render options (used to read options.parts).
 */
export function warnIfDuplicateSidebar(sheet, sheetLabel, rootEl, options) {
  try {
    const appRoot = rootEl?.closest?.(".application, .app") ?? rootEl;
    if (!(appRoot instanceof HTMLElement)) return;
    const sidebars = appRoot.querySelectorAll(".sheet-fixed-container");
    if ((sidebars?.length ?? 0) <= 1) return;

    const renderedParts = Array.isArray(options?.parts) && options.parts.length
      ? options.parts
      : ["all"];
    const payload = {
      sheet: sheetLabel,
      actorId: sheet.document?.id ?? null,
      actorName: sheet.document?.name ?? null,
      sidebarCount: sidebars.length,
      renderedParts,
    };
    console.warn(`UESRPG | duplicate-sidebar ${JSON.stringify(payload)}`);
  } catch (_err) {
    // no-op
  }
}
