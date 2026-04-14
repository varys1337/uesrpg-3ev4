import { InterfaceSettingsAppV2 } from "./v2/interface-settings.js";
import { localizeMenuConfig } from "../../utils/i18n.js";

const NAMESPACE = "uesrpg-3ev4";

export function registerInterfaceSettingsMenu() {
  if (game.settings?.menus?.get(`${NAMESPACE}.interfaceSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "interfaceSettings", localizeMenuConfig("Menus", "interfaceSettings", {
    name: "Interface",
    label: "Configure Interface",
    hint: "Interface and sheet presentation settings.",
    icon: "fas fa-desktop",
    restricted: true,
    type: InterfaceSettingsAppV2,
  }));
}
