import { HomebrewSettingsAppV2 } from "./v2/homebrew-settings.js";
import { registerSystemMenu } from "../../utils/settings-registration.js";

export function registerHomebrewSettingsMenu() {
  registerSystemMenu("homebrewSettings", {
    name: "Homebrew",
    label: "Configure Homebrew",
    hint: "Optional house rules and system variants.",
    icon: "fas fa-flask",
    restricted: true,
    type: HomebrewSettingsAppV2,
  });
}
