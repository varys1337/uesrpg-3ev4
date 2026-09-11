/**
 * src/utils/dev/debug-settings.js
 *
 * Debug settings menu registration.
 * The V2 panel handles the UI; this file registers the submenu entry.
 */

import { DebugSettingsAppV2 } from "../../ui/apps/v2/debug-settings.js";
import { registerSystemMenu } from "../settings-registration.js";

export function registerDebugSettingsMenu() {
  registerSystemMenu("debugSettings", {
    name: "Debugging",
    label: "Configure Debugging",
    hint: "Diagnostics and development-only toggles for UESRPG.",
    icon: "fas fa-bug",
    restricted: true,
    type: DebugSettingsAppV2,
  });
}
