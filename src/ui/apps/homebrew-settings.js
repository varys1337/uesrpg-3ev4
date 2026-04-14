import { HomebrewSettingsAppV2 } from "./v2/homebrew-settings.js";
import { localizeMenuConfig } from "../../utils/i18n.js";

const NAMESPACE = "uesrpg-3ev4";

export function registerHomebrewSettingsMenu() {
  if (game.settings?.menus?.get(`${NAMESPACE}.homebrewSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "homebrewSettings", localizeMenuConfig("Menus", "homebrewSettings", {
    name: "Homebrew",
    label: "Configure Homebrew",
    hint: "Optional house rules and system variants.",
    icon: "fas fa-flask",
    restricted: true,
    type: HomebrewSettingsAppV2,
  }));
}
