import { isDebugEnabled } from "../../../../utils/debug.js";

/**
 * Report duplicate sheet sidebars only when client debugging is enabled.
 *
 * @param {ApplicationV2} sheet
 * @param {string} sheetLabel
 * @param {HTMLElement|null} rootEl
 * @param {object} options
 */
export function warnIfDuplicateSidebar(sheet, sheetLabel, rootEl, options) {
  if (!isDebugEnabled("debugClientEnabled")) return;

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
    // Diagnostic only.
  }
}
