import { TalentsSettingsAppV2 } from "./v2/talents-settings.js";

const NAMESPACE = "uesrpg-3ev4";

export function registerTalentsSettingsMenu() {
  if (game.settings?.menus?.get(`${NAMESPACE}.talentsSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "talentsSettings", {
    name: "Talents",
    label: "Configure Talents",
    hint: "Talent automation and Chapter 4 RAW compliance settings.",
    icon: "fas fa-user-ninja",
    restricted: true,
    type: TalentsSettingsAppV2,
  });
}
