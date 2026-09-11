import { perfRecord } from "../../utils/perf-tracker.js";

/**
 * Return currently rendered UESRPG ApplicationV2 sheets from Foundry's public
 * ApplicationV2 registry. Legacy ui.windows intentionally is not consulted.
 */
export function getRenderedSystemSheets({ classNames = [] } = {}) {
  const registry = foundry?.applications?.instances;
  if (typeof registry?.values !== "function") return [];

  const required = new Set(classNames.map((name) => String(name ?? "").trim()).filter(Boolean));
  const sheets = new Set();

  for (const app of registry.values()) {
    try {
      if (!app?.rendered) continue;
      const element = app?.element;
      const classes = element?.classList;
      if (!classes?.contains?.("uesrpg-sheet-root")) continue;
      if (required.size && !Array.from(required).some((name) => classes.contains(name))) continue;
      if (typeof app?.render !== "function") continue;
      sheets.add(app);
    } catch (_err) {
      // Ignore applications transitioning between render and close states.
    }
  }

  return Array.from(sheets);
}

export function renderSystemSheets({ classNames = [], beforeRender = null, reason = "settings" } = {}) {
  const sheets = getRenderedSystemSheets({ classNames });
  perfRecord({
    event: "settings.sheetRefresh",
    reason,
    renderCount: sheets.length,
    durationMs: 0,
  });

  for (const sheet of sheets) {
    try {
      beforeRender?.(sheet);
      Promise.resolve(sheet.render()).catch((error) => {
        console.warn("UESRPG | Failed to refresh an open system sheet.", error);
      });
    } catch (error) {
      console.warn("UESRPG | Failed to schedule an open system sheet refresh.", error);
    }
  }
  return sheets.length;
}
