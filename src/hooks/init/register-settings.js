import { registerDebugSettingsMenu } from "../../utils/dev/debug-settings.js";
import { registerInterfaceSettingsMenu } from "../../ui/apps/interface-settings.js";
import { registerTalentsSettingsMenu } from "../../ui/apps/talents-settings.js";
import { registerCombatSettingsMenu } from "../../ui/apps/combat-settings.js";
import {
  registerReachVisualizerSettingsMenu,
  registerReachVisualizerSettingsStorage
} from "../../ui/apps/reach-visualizer-settings.js";
import { registerHomebrewSettingsMenu } from "../../ui/apps/homebrew-settings.js";
import { registerMigrationSettingsMenu } from "../../ui/apps/migration-settings.js";

import { registerUiSettings } from "./settings/ui.js";
import { registerCombatSettings } from "./settings/combat.js";
import { registerTalentsSettings } from "./settings/talents.js";
import { registerCraftingSettings } from "./settings/crafting.js";
import { registerHomebrewSettings } from "./settings/homebrew.js";
import { registerDebugSettings } from "./settings/debug.js";
import { registerInternalSettings } from "./settings/internal.js";

export async function registerSettings() {
  registerUiSettings();
  registerCombatSettings();
  registerTalentsSettings();
  registerCraftingSettings();
  registerHomebrewSettings();
  registerDebugSettings();
  registerInternalSettings();

  // Register a dedicated Debugging menu to avoid clutter in System Settings.
  registerDebugSettingsMenu();

  // Subcategory menus to keep System Settings uncluttered.
  registerInterfaceSettingsMenu();
  registerTalentsSettingsMenu();
  registerCombatSettingsMenu();

  // Reach Visualizer submenu (client scoped)
  registerReachVisualizerSettingsStorage();
  registerReachVisualizerSettingsMenu();

  // Homebrew submenu (GM-restricted, world-scoped house rules)
  registerHomebrewSettingsMenu();

  // Migration submenu (GM-restricted, manual migration controls)
  registerMigrationSettingsMenu();
}
