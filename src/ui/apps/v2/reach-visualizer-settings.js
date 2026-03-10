/**
 * src/ui/apps/v2/reach-visualizer-settings.js
 *
 * ApplicationV2 reach-visualizer settings panel.
 * Uses native DOM event binding via _onRender.
 */

import { templatePath } from "../../constants.js";
import {
  DEFAULT_REACH_VISUALIZER_SETTINGS,
  REACH_BEHAVIOUR,
  REACH_GRID_DIAGONAL,
  REACH_VISIBILITY,
  REACH_SHAPE,
  REACH_SOURCE,
  REACH_COLOR_MODE,
  getReachVisualizerSettings,
  setReachVisualizerSettings,
  normalizeReachVisualizerSettings,
} from "../../canvas/reach-visualizer-config.js";
import { scheduleEngagementFlankingRefresh } from "../../../core/homebrew/engagement-flanking/index.js";
import { isEngagementFlankingHomebrewEnabled } from "../../../core/system/homebrew.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ReachVisualizerSettingsAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-reach-visualizer-settings",
    tag: "form",
    form: {
      handler: ReachVisualizerSettingsAppV2._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
    window: {
      title: "Reach Visualizer",
    },
    position: {
      width: 560,
    },
    classes: ["uesrpg", "reach-visualizer-settings"],
  };

  static PARTS = {
    form: {
      template: templatePath("v2/apps/reach-visualizer-settings.hbs"),
    },
  };

  async _prepareContext(options) {
    const settings = getReachVisualizerSettings();
    return {
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
      gridDiagonalChoices: {
        [REACH_GRID_DIAGONAL.CHEBYSHEV]: "Ignore diagonal rule (equal-cost)",
        [REACH_GRID_DIAGONAL.SCENE]: "Respect scene diagonal rule",
      },
    };
  }

  /** @override вЂ” replaces jQuery activateListeners with native DOM */
  _onRender(context, options) {
    super._onRender(context, options);

    const el = this.element;

    // Range slider live readout.
    for (const range of el.querySelectorAll("input[type='range'][data-range-value]")) {
      const key = range.dataset.rangeValue;
      const out = el.querySelector(`.range-value[data-range-value='${key}']`);
      if (!out) continue;
      range.addEventListener("input", () => { out.textContent = range.value; });
    }

    // Conditional visibility for dynamic vs single opacity and uniform color.
    const syncConditionalVisibility = () => {
      const visibilitySelect = el.querySelector("select[name='visibility']");
      const colorModeSelect = el.querySelector("select[name='colorMode']");

      const isDynamic = visibilitySelect?.value === REACH_VISIBILITY.DYNAMIC;
      const isUniform = colorModeSelect?.value === REACH_COLOR_MODE.UNIFORM;

      const singleOpacity = el.querySelector(".rv-opacity-single");
      const dynamicOpacity = el.querySelector(".rv-opacity-dynamic");
      const uniformColor = el.querySelector(".rv-uniform-color-row");

      if (singleOpacity) singleOpacity.style.display = isDynamic ? "none" : "";
      if (dynamicOpacity) dynamicOpacity.style.display = isDynamic ? "" : "none";
      if (uniformColor) uniformColor.style.display = isUniform ? "" : "none";
    };

    el.querySelector("select[name='visibility']")?.addEventListener("change", syncConditionalVisibility);
    el.querySelector("select[name='colorMode']")?.addEventListener("change", syncConditionalVisibility);
    syncConditionalVisibility();
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object;

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
      gridDiagonalMode: String(data.gridDiagonalMode ?? DEFAULT_REACH_VISUALIZER_SETTINGS.gridDiagonalMode),
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

    // If diagonal mode changed, flanking reach checks use the same setting — refresh immediately.
    try {
      if (isEngagementFlankingHomebrewEnabled()) {
        scheduleEngagementFlankingRefresh({ reason: "reachDiagonalModeChange", fullScene: true });
      }
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

