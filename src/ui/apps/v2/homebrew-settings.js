/**
 * src/ui/apps/v2/homebrew-settings.js
 *
 * ApplicationV2 Homebrew settings panel.
 */

import { confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = SYSTEM_ID;

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
      title: "UESRPG - Homebrew",
    },
    position: {
      width: 520,
    },
    classes: ["uesrpg"],
  };

  static PARTS = {
    form: {
      template: templatePath("v2/apps/homebrew-settings.hbs"),
    },
  };

  async _prepareContext(options) {
    return {
      homebrewSpeedFormulaSBAB: game.settings.get(NAMESPACE, "homebrew.speedFormulaSBAB"),
      homebrew: {
        reachLengthEnabled: game.settings.get(NAMESPACE, "homebrew.reachLength.enabled"),
        reachLengthModel:   game.settings.get(NAMESPACE, "homebrew.reachLength.reachModel"),
        reachLengthAttackerAdvantageOnly: game.settings.get(NAMESPACE, "homebrew.reachLength.attackerAdvantageOnly"),
        engagementFlankingEnabled: game.settings.get(NAMESPACE, "homebrew.engagementFlanking.enabled"),
        engagementFlankingOnlyInCombat: game.settings.get(NAMESPACE, "homebrew.engagementFlanking.onlyInCombat"),
        massCombatEnabled: game.settings.get(NAMESPACE, "homebrew.massCombat.enabled"),
        religionWorshipEnabled: game.settings.get(NAMESPACE, "homebrew.religionWorship.enabled"),
      },
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object;
    let needsReload = false;

    // Speed Formula
    if ("homebrew.speedFormulaSBAB" in data) {
      const prev = game.settings.get(NAMESPACE, "homebrew.speedFormulaSBAB");
      const next = Boolean(data["homebrew.speedFormulaSBAB"]);
      await game.settings.set(NAMESPACE, "homebrew.speedFormulaSBAB", next);
      if (prev !== next) needsReload = true;
    }

    // Reach & Length Overhaul
    if ("homebrew.reachLength.enabled" in data) {
      const prev = game.settings.get(NAMESPACE, "homebrew.reachLength.enabled");
      const next = Boolean(data["homebrew.reachLength.enabled"]);
      await game.settings.set(NAMESPACE, "homebrew.reachLength.enabled", next);
      if (prev !== next) needsReload = true;
    }
    if ("homebrew.reachLength.reachModel" in data) {
      await game.settings.set(NAMESPACE, "homebrew.reachLength.reachModel", String(data["homebrew.reachLength.reachModel"] ?? "classic"));
    }
    if ("homebrew.reachLength.attackerAdvantageOnly" in data) {
      await game.settings.set(NAMESPACE, "homebrew.reachLength.attackerAdvantageOnly", Boolean(data["homebrew.reachLength.attackerAdvantageOnly"]));
    }

    // Engagement & Flanking
    if ("homebrew.engagementFlanking.enabled" in data) {
      await game.settings.set(NAMESPACE, "homebrew.engagementFlanking.enabled", Boolean(data["homebrew.engagementFlanking.enabled"]));
    }
    if ("homebrew.engagementFlanking.onlyInCombat" in data) {
      await game.settings.set(NAMESPACE, "homebrew.engagementFlanking.onlyInCombat", Boolean(data["homebrew.engagementFlanking.onlyInCombat"]));
    }

    // Mass Combat
    if ("homebrew.massCombat.enabled" in data) {
      await game.settings.set(NAMESPACE, "homebrew.massCombat.enabled", Boolean(data["homebrew.massCombat.enabled"]));
    }

    // Religion & Worship
    if ("homebrew.religionWorship.enabled" in data) {
      const prev = game.settings.get(NAMESPACE, "homebrew.religionWorship.enabled");
      const next = Boolean(data["homebrew.religionWorship.enabled"]);
      await game.settings.set(NAMESPACE, "homebrew.religionWorship.enabled", next);
      if (prev !== next) needsReload = true;
    }

    // Reload prompt
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
