import { InterfaceSettingsAppV2 } from "./v2/interface-settings.js";
import { registerSystemMenu } from "../../utils/settings-registration.js";

export function registerInterfaceSettingsMenu() {
  registerSystemMenu("interfaceSettings", {
    name: "Interface",
    label: "Configure Interface",
    hint: "Interface and sheet presentation settings.",
    icon: "fas fa-desktop",
    restricted: true,
    type: InterfaceSettingsAppV2,
  });
}
