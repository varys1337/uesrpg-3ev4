import { CombatSettingsAppV2 } from "./v2/combat-settings.js";
import { registerSystemMenu } from "../../utils/settings-registration.js";

export function registerCombatSettingsMenu() {
  registerSystemMenu("combatSettings", {
    name: "Combat",
    label: "Configure Combat",
    hint: "Combat UI settings.",
    icon: "fas fa-swords",
    restricted: true,
    type: CombatSettingsAppV2,
  });
}
