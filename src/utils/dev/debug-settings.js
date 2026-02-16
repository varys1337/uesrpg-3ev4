/**
 * src/utils/dev/debug-settings.js
 *
 * Debug settings menu registration.
 * The V2 panel handles the UI; this file registers the submenu entry.
 */

import { DebugSettingsAppV2 } from "../../ui/apps/v2/debug-settings.js";

const NAMESPACE = "uesrpg-3ev4";

export function registerDebugSettingsMenu() {
  // Register once.
  if (game.settings?.menus?.get(`${NAMESPACE}.debugSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "debugSettings", {
    name: "Debugging",
    label: "Configure Debugging",
    hint: "Diagnostics and development-only toggles for UESRPG.",
    icon: "fas fa-bug",
    restricted: true,
    type: DebugSettingsAppV2,
  });
}
