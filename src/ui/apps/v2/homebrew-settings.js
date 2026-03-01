/**
 * src/ui/apps/v2/homebrew-settings.js
 *
 * ApplicationV2 Homebrew settings panel.
 */

import { confirmDialog } from "../../../utils/dialog-v2-helper.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = "uesrpg-3ev4";

export class HomebrewSettingsAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-homebrew-settings",
    tag: "form",
    form: {
      handler: HomebrewSettingsAppV2._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
    window: {
      title: "UESRPG — Homebrew",
    },
    position: {
      width: 520,
    },
    classes: ["uesrpg"],
  };

  static PARTS = {
    form: {
      template: "systems/uesrpg-3ev4/templates/v2/apps/homebrew-settings.hbs",
    },
  };

  async _prepareContext(options) {
    return {
      homebrewSpeedFormulaSBAB: game.settings.get(NAMESPACE, "homebrew.speedFormulaSBAB"),
      homebrew: {
        reachLengthEnabled: game.settings.get(NAMESPACE, "homebrew.reachLength.enabled"),
        reachLengthModel:   game.settings.get(NAMESPACE, "homebrew.reachLength.reachModel"),
        engagementFlankingEnabled: game.settings.get(NAMESPACE, "homebrew.engagementFlanking.enabled"),
        engagementFlankingOnlyInCombat: game.settings.get(NAMESPACE, "homebrew.engagementFlanking.onlyInCombat"),
      },
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object;
    let needsReload = false;

    // ── Speed Formula ──────────────────────────────────────────────────────────
    if ("homebrew.speedFormulaSBAB" in data) {
      const prev = game.settings.get(NAMESPACE, "homebrew.speedFormulaSBAB");
      const next = Boolean(data["homebrew.speedFormulaSBAB"]);
      await game.settings.set(NAMESPACE, "homebrew.speedFormulaSBAB", next);
      if (prev !== next) needsReload = true;
    }

    // ── Reach & Length Overhaul ────────────────────────────────────────────────
    if ("homebrew.reachLength.enabled" in data) {
      const prev = game.settings.get(NAMESPACE, "homebrew.reachLength.enabled");
      const next = Boolean(data["homebrew.reachLength.enabled"]);
      await game.settings.set(NAMESPACE, "homebrew.reachLength.enabled", next);
      if (prev !== next) needsReload = true;
    }
    if ("homebrew.reachLength.reachModel" in data) {
      await game.settings.set(NAMESPACE, "homebrew.reachLength.reachModel", String(data["homebrew.reachLength.reachModel"] ?? "classic"));
    }

    // ── Engagement & Flanking ───────────────────────────────────────────────
    if ("homebrew.engagementFlanking.enabled" in data) {
      await game.settings.set(NAMESPACE, "homebrew.engagementFlanking.enabled", Boolean(data["homebrew.engagementFlanking.enabled"]));
    }
    if ("homebrew.engagementFlanking.onlyInCombat" in data) {
      await game.settings.set(NAMESPACE, "homebrew.engagementFlanking.onlyInCombat", Boolean(data["homebrew.engagementFlanking.onlyInCombat"]));
    }
    // ── Reload prompt ──────────────────────────────────────────────────────────
    if (needsReload) {
      const reload = await confirmDialog({
        title: "Reload Required",
        content: "<p>One or more changed settings require a world reload to apply consistently.</p><p>Reload now?</p>",
        yesLabel: "Reload Now",
        noLabel: "Later",
        yesIcon: "fas fa-sync",
        noIcon: "fas fa-clock",
      });
      if (reload) window.location.reload();
    }
  }
}
