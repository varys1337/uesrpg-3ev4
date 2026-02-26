import { HomebrewSettingsAppV2 } from "./v2/homebrew-settings.js";

const NAMESPACE = "uesrpg-3ev4";

export function registerHomebrewSettingsMenu() {
  if (game.settings?.menus?.get(`${NAMESPACE}.homebrewSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "homebrewSettings", {
    name: "Homebrew",
    label: "Configure Homebrew",
    hint: "Optional house rules and system variants.",
    icon: "fas fa-flask",
    restricted: true,
    type: HomebrewSettingsAppV2,
  });
}
