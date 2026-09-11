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
import {
  ARMOR_COVERAGE_SCALE_RANGE,
  ARMOR_COVERAGE_SCALE_SETTING,
  DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS,
} from "../canvas/armor-coverage-controller.js";
import { ReachVisualizerSettingsAppV2 } from "./v2/reach-visualizer-settings.js";
import { registerSystemMenu, registerSystemSetting } from "../../utils/settings-registration.js";

/**
 * Register the client-scoped settings storage.
 */
export function registerReachVisualizerSettingsStorage() {
  registerSystemSetting("ReachVisualizer", REACH_VISUALIZER_SETTING_KEY, {
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
  }, { namespace: REACH_VISUALIZER_NAMESPACE });

  registerSystemSetting("Homebrew", ARMOR_COVERAGE_SCALE_SETTING, {
    name: "Armor Coverage Scale",
    hint: "Sets the armor coverage badge size for this client. The final size is normalized to the scene UI scale and follows canvas zoom.",
    scope: "client",
    config: false,
    type: Number,
    default: DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS.scale,
    range: ARMOR_COVERAGE_SCALE_RANGE,
    onChange: () => {
      try {
        game?.uesrpg?.armorCoverageOverlay?.applySettings?.();
      } catch (_e) {
        // no-op
      }
    },
  }, { namespace: REACH_VISUALIZER_NAMESPACE });
}

/**
 * Register the submenu button in System Settings.
 */
export function registerReachVisualizerSettingsMenu() {
  registerSystemMenu("reachVisualizerMenu", {
    name: "Visualiser",
    label: "Configure Visualiser",
    hint: "Configure the visualiser overlay.",
    icon: "fas fa-bullseye",
    type: ReachVisualizerSettingsAppV2,
    restricted: false,
  }, { namespace: REACH_VISUALIZER_NAMESPACE });
}
