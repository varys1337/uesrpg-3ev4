/**
 * src/ui/apps/reach-visualizer-settings.js
 *
 * Settings registration for the Reach Visualizer canvas overlay.
 * The V2 settings panel handles the UI; this file registers the
 * storage setting and the submenu entry.
 */

import {
  DEFAULT_REACH_VISUALIZER_SETTINGS,
  REACH_VISUALIZER_NAMESPACE,
  REACH_VISUALIZER_SETTING_KEY,
} from "../canvas/reach-visualizer-config.js";
import { ReachVisualizerSettingsAppV2 } from "./v2/reach-visualizer-settings.js";
import { localizeMenuConfig, localizeSettingConfig } from "../../utils/i18n.js";

/**
 * Register the client-scoped settings storage.
 */
export function registerReachVisualizerSettingsStorage() {
  game.settings.register(REACH_VISUALIZER_NAMESPACE, REACH_VISUALIZER_SETTING_KEY, localizeSettingConfig("ReachVisualizer", REACH_VISUALIZER_SETTING_KEY, {
    name: "Reach Visualizer Settings",
    hint: "Client-scoped settings backing the Reach Visualizer submenu.",
    scope: "client",
    config: false,
    type: Object,
    default: DEFAULT_REACH_VISUALIZER_SETTINGS,
    onChange: () => {
      try {
        game?.uesrpg?.reachVisualizer?.applySettings?.();
      } catch (_e) {
        // no-op
      }
    },
  }));
}

/**
 * Register the submenu button in System Settings.
 */
export function registerReachVisualizerSettingsMenu() {
  game.settings.registerMenu(REACH_VISUALIZER_NAMESPACE, "reachVisualizerMenu", localizeMenuConfig("Menus", "reachVisualizerMenu", {
    name: "Visualiser",
    label: "Configure Visualiser",
    hint: "Configure the visualiser overlay.",
    icon: "fas fa-bullseye",
    type: ReachVisualizerSettingsAppV2,
    restricted: false,
  }));
}
