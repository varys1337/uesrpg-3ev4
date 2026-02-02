/**
 * src/ui/apps/reach-visualizer-settings.js
 *
 * Foundry v13 (AppV1) settings submenu for the Reach Visualizer canvas overlay.
 */

import {
  DEFAULT_REACH_VISUALIZER_SETTINGS,
  REACH_VISUALIZER_NAMESPACE,
  REACH_VISUALIZER_SETTING_KEY,
  REACH_BEHAVIOUR,
  REACH_VISIBILITY,
  REACH_SHAPE,
  REACH_SOURCE,
  REACH_COLOR_MODE,
  getReachVisualizerSettings,
  setReachVisualizerSettings,
  normalizeReachVisualizerSettings,
} from "../canvas/reach-visualizer-config.js";

export class ReachVisualizerSettingsApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "uesrpg-reach-visualizer-settings",
      title: game.i18n.localize("UESRPG.ReachVisualizer.SettingsTitle") || "Reach Visualizer",
      template: "systems/uesrpg-3ev4/templates/apps/reach-visualizer-settings.hbs",
      width: 560,
      height: "auto",
      closeOnSubmit: true,
      submitOnChange: false,
      submitOnClose: false,
      classes: ["uesrpg", "reach-visualizer-settings"],
    });
  }

  getData(options = {}) {
    const settings = getReachVisualizerSettings();
    return {
      ...super.getData(options),
      settings,

      behaviourChoices: {
        [REACH_BEHAVIOUR.VISIBLE]: "Show on visible tokens (for the active user)",
        [REACH_BEHAVIOUR.EVERYONE]: "Show on everyone",
      },
      visibilityChoices: {
        [REACH_VISIBILITY.ALWAYS]: "Show always",
        [REACH_VISIBILITY.HOVER]: "Show on hover",
        [REACH_VISIBILITY.DYNAMIC]: "Dynamic (passive + hover highlight)",
      },
      reachSourceChoices: {
        [REACH_SOURCE.MAX_EQUIPPED]: "Max equipped melee reach",
        [REACH_SOURCE.LAST_USED]: "Last-used melee weapon (per user)",
      },
      shapeChoices: {
        [REACH_SHAPE.CIRCLE]: "Smooth rings",
        [REACH_SHAPE.GRID]: "Grid-aware (shape matches grid)",
      },
      colorModeChoices: {
        [REACH_COLOR_MODE.DISPOSITION]: "Color by token disposition",
        [REACH_COLOR_MODE.UNIFORM]: "Uniform color",
      },

      systemNamespace: REACH_VISUALIZER_NAMESPACE,
      settingKey: REACH_VISUALIZER_SETTING_KEY,
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    const updateRangeValue = (key, value) => {
      const out = html.find(`.range-value[data-range-value='${key}']`);
      if (out.length) out.text(String(value));
    };

    // Update slider value readouts live.
    html.find("input[type='range'][data-range-value]").on("input", (ev) => {
      const el = ev.currentTarget;
      const key = el.dataset.rangeValue;
      updateRangeValue(key, el.value);
    });

    const syncConditionalVisibility = () => {
      const visibility = String(html.find("select[name='visibility']").val() ?? "");
      const isDynamic = visibility === REACH_VISIBILITY.DYNAMIC;

      html.find(".rv-opacity-single").toggle(!isDynamic);
      html.find(".rv-opacity-dynamic").toggle(isDynamic);

      const colorMode = String(html.find("select[name='colorMode']").val() ?? "");
      const isUniform = colorMode === REACH_COLOR_MODE.UNIFORM;
      html.find(".rv-uniform-color-row").toggle(isUniform);
    };

    html.find("select[name='visibility']").on("change", syncConditionalVisibility);
    html.find("select[name='colorMode']").on("change", syncConditionalVisibility);

    syncConditionalVisibility();
  }

  async _updateObject(_event, formData) {
    const data = foundry.utils.expandObject(formData);

    // Coerce + clamp numeric fields.
    const opacity = Math.max(0.05, Math.min(1.0, Number(data.opacity ?? DEFAULT_REACH_VISUALIZER_SETTINGS.opacity)));
    const passiveOpacity = Math.max(0.05, Math.min(1.0, Number(data.passiveOpacity ?? DEFAULT_REACH_VISUALIZER_SETTINGS.passiveOpacity)));
    const activeOpacity = Math.max(0.05, Math.min(1.0, Number(data.activeOpacity ?? DEFAULT_REACH_VISUALIZER_SETTINGS.activeOpacity)));
    const lineWidth = Math.max(1, Math.min(12, Number(data.lineWidth ?? DEFAULT_REACH_VISUALIZER_SETTINGS.lineWidth)));

    const partial = normalizeReachVisualizerSettings({
      enabled: Boolean(data.enabled),
      behaviour: String(data.behaviour ?? DEFAULT_REACH_VISUALIZER_SETTINGS.behaviour),
      visibility: String(data.visibility ?? DEFAULT_REACH_VISUALIZER_SETTINGS.visibility),

      reachSource: String(data.reachSource ?? DEFAULT_REACH_VISUALIZER_SETTINGS.reachSource),

      shape: String(data.shape ?? DEFAULT_REACH_VISUALIZER_SETTINGS.shape),
      colorMode: String(data.colorMode ?? DEFAULT_REACH_VISUALIZER_SETTINGS.colorMode),
      uniformColor: String(data.uniformColor ?? DEFAULT_REACH_VISUALIZER_SETTINGS.uniformColor),

      opacity,
      passiveOpacity,
      activeOpacity,
      lineWidth,

      showLabel: Boolean(data.showLabel),
      showTargetDistance: Boolean(data.showTargetDistance),
      includeElevation: Boolean(data.includeElevation),
    });

    await setReachVisualizerSettings(partial);

    // Apply immediately if the overlay controller is present.
    try {
      game?.uesrpg?.reachVisualizer?.applySettings?.(partial);
    } catch (_e) {
      // no-op
    }

    // Refresh SceneControls button state without blocking submit/close.
    try {
      queueMicrotask(() => {
        try {
          if (ui?.controls?.render) void ui.controls.render({ reset: true });
        } catch (_e2) {
          // no-op
        }
      });
    } catch (_e) {
      // no-op
    }
  }
}

/**
 * Register the client-scoped settings storage.
 */
export function registerReachVisualizerSettingsStorage() {
  game.settings.register(REACH_VISUALIZER_NAMESPACE, REACH_VISUALIZER_SETTING_KEY, {
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
  });
}

/**
 * Register the submenu button in System Settings.
 */
export function registerReachVisualizerSettingsMenu() {
  game.settings.registerMenu(REACH_VISUALIZER_NAMESPACE, "reachVisualizerMenu", {
    name: "Reach Visualizer",
    label: "Configure",
    hint: "Configure the Reach Visualizer overlay.",
    icon: "fas fa-bullseye",
    type: ReachVisualizerSettingsApp,
    restricted: false,
  });
}
