/**
 * src/ui/apps/v2/reach-visualizer-settings.js
 *
 * ApplicationV2 reach-visualizer settings panel.
 * Uses native DOM event binding via _onRender.
 */

import { SYSTEM_ID, templatePath } from "../../constants.js";
import {
  DEFAULT_REACH_VISUALIZER_SETTINGS,
  REACH_GRID_DIAGONAL,
  REACH_VISIBILITY,
  getReachVisualizerSettings,
  setReachVisualizerSettings,
  normalizeReachVisualizerSettings,
} from "../../canvas/reach-visualizer-config.js";
import { scheduleEngagementFlankingRefresh } from "../../../core/homebrew/engagement-flanking/index.js";
import { isEngagementFlankingHomebrewEnabled } from "../../../core/system/homebrew.js";
import { localizeChoiceObject, t } from "../../../utils/i18n.js";
import {
  ARMOR_COVERAGE_MODE_SETTING,
  ARMOR_COVERAGE_SCALE_RANGE,
  ARMOR_COVERAGE_SCALE_SETTING,
  ARMOR_COVERAGE_TRANSPARENCY_SETTING,
  DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS,
  normalizeArmorCoverageOverlaySettings,
} from "../../canvas/armor-coverage-controller.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function _readSetting(key, fallback) {
  try {
    return game?.settings?.get?.(SYSTEM_ID, key) ?? fallback;
  } catch (_e) {
    return fallback;
  }
}

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
      title: "Configure Visualiser",
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

  get title() {
    return t("UESRPG.Apps.Menus.reachVisualizerMenu.Label", "Configure Visualiser");
  }

  async _prepareContext(options) {
    const settings = getReachVisualizerSettings();
    const armorCoverage = normalizeArmorCoverageOverlaySettings({
      mode: _readSetting(ARMOR_COVERAGE_MODE_SETTING, DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS.mode),
      transparency: _readSetting(ARMOR_COVERAGE_TRANSPARENCY_SETTING, DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS.transparency),
      scale: _readSetting(ARMOR_COVERAGE_SCALE_SETTING, DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS.scale),
    });
    return {
      settings,
      armorCoverageEnabled: armorCoverage.mode === "compact",
      armorCoverageTransparency: armorCoverage.transparency,
      armorCoverageScale: armorCoverage.scale,
      armorCoverageScaleRange: ARMOR_COVERAGE_SCALE_RANGE,
      canConfigureSharedArmorCoverage: Boolean(game.user?.isGM),
      visibilityChoices: localizeChoiceObject({
        [REACH_VISIBILITY.ALWAYS]: "Show always",
        [REACH_VISIBILITY.HOVER]: "Show on hover",
        [REACH_VISIBILITY.DYNAMIC]: "Dynamic (passive + hover highlight)",
      }, "UESRPG.Choices.ReachVisualizer.Visibility"),
      gridDiagonalChoices: localizeChoiceObject({
        [REACH_GRID_DIAGONAL.CHEBYSHEV]: "Ignore diagonal rule (equal-cost)",
        [REACH_GRID_DIAGONAL.SCENE]: "Respect scene diagonal rule",
      }, "UESRPG.Choices.ReachVisualizer.GridDiagonalMode"),
    };
  }

  /** @override - replaces jQuery activateListeners with native DOM */
  _onRender(context, options) {
    super._onRender(context, options);

    const el = this.element;

    // Range slider live readout.
    for (const range of el.querySelectorAll("input[type='range'][data-range-value]")) {
      const key = range.dataset.rangeValue;
      const out = el.querySelector(`.range-value[data-range-value='${key}']`);
      if (!out) continue;
      range.addEventListener("input", () => {
        out.textContent = `${range.value}${range.dataset.rangeSuffix ?? ""}`;
      });
    }

    // Conditional visibility for dynamic vs single opacity.
    const syncConditionalVisibility = () => {
      const visibilitySelect = el.querySelector("select[name='visibility']");

      const isDynamic = visibilitySelect?.value === REACH_VISIBILITY.DYNAMIC;

      const singleOpacity = el.querySelector(".rv-opacity-single");
      const dynamicOpacity = el.querySelector(".rv-opacity-dynamic");

      if (singleOpacity) singleOpacity.style.display = isDynamic ? "none" : "";
      if (dynamicOpacity) dynamicOpacity.style.display = isDynamic ? "" : "none";
    };

    el.querySelector("select[name='visibility']")?.addEventListener("change", syncConditionalVisibility);
    syncConditionalVisibility();
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object;

    const opacity = Math.max(0.05, Math.min(1.0, Number(data.opacity ?? DEFAULT_REACH_VISUALIZER_SETTINGS.opacity)));
    const passiveOpacity = Math.max(0.05, Math.min(1.0, Number(data.passiveOpacity ?? DEFAULT_REACH_VISUALIZER_SETTINGS.passiveOpacity)));
    const activeOpacity = Math.max(0.05, Math.min(1.0, Number(data.activeOpacity ?? DEFAULT_REACH_VISUALIZER_SETTINGS.activeOpacity)));
    const lineWidth = Math.max(1, Math.min(12, Number(data.lineWidth ?? DEFAULT_REACH_VISUALIZER_SETTINGS.lineWidth)));

    const partial = normalizeReachVisualizerSettings({
      enabled: getReachVisualizerSettings().enabled,
      visibility: String(data.visibility ?? DEFAULT_REACH_VISUALIZER_SETTINGS.visibility),
      gridDiagonalMode: String(data.gridDiagonalMode ?? DEFAULT_REACH_VISUALIZER_SETTINGS.gridDiagonalMode),
      opacity,
      passiveOpacity,
      activeOpacity,
      lineWidth,
    });

    await setReachVisualizerSettings(partial);

    if (game.user?.isGM && "armorCoverageEnabled" in data) {
      await game.settings.set(SYSTEM_ID, ARMOR_COVERAGE_MODE_SETTING, Boolean(data.armorCoverageEnabled) ? "compact" : "disabled");
    }

    if (game.user?.isGM && "armorCoverageTransparency" in data) {
      const rawTransparency = Number(data.armorCoverageTransparency);
      const transparency = normalizeArmorCoverageOverlaySettings({ transparency: rawTransparency }).transparency;
      await game.settings.set(SYSTEM_ID, ARMOR_COVERAGE_TRANSPARENCY_SETTING, transparency);
    }

    if ("armorCoverageScale" in data) {
      const scale = normalizeArmorCoverageOverlaySettings({ scale: data.armorCoverageScale }).scale;
      await game.settings.set(SYSTEM_ID, ARMOR_COVERAGE_SCALE_SETTING, scale);
    }

    // Apply immediately if the overlay controller is present.
    try {
      game?.uesrpg?.reachVisualizer?.applySettings?.(partial);
      game?.uesrpg?.armorCoverageOverlay?.applySettings?.();
    } catch (_e) {
      // no-op
    }

    // If diagonal mode changed, flanking reach checks use the same setting; refresh immediately.
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
