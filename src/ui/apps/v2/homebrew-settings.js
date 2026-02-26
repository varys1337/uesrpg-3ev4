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
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object;

    if ("homebrew.speedFormulaSBAB" in data) {
      const prev = game.settings.get(NAMESPACE, "homebrew.speedFormulaSBAB");
      const next = Boolean(data["homebrew.speedFormulaSBAB"]);
      await game.settings.set(NAMESPACE, "homebrew.speedFormulaSBAB", next);

      if (prev !== next) {
        const reload = await confirmDialog({
          title: "Reload Required",
          content: "<p>The Speed Formula setting has changed and requires a world reload to apply consistently.</p><p>Reload now?</p>",
          yesLabel: "Reload Now",
          noLabel: "Later",
          yesIcon: "fas fa-sync",
          noIcon: "fas fa-clock",
        });
        if (reload) window.location.reload();
      }
    }
  }
}
