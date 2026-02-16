import { CombatSettingsAppV2 } from "./v2/combat-settings.js";

const NAMESPACE = "uesrpg-3ev4";

export function registerCombatSettingsMenu() {
  if (game.settings?.menus?.get(`${NAMESPACE}.combatSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "combatSettings", {
    name: "Combat",
    label: "Configure Combat",
    hint: "Combat UI settings.",
    icon: "fas fa-swords",
    restricted: true,
    type: CombatSettingsAppV2,
  });
}

