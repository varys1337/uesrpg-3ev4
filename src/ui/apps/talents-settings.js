import { TalentsSettingsAppV2 } from "./v2/talents-settings.js";
import { registerSystemMenu } from "../../utils/settings-registration.js";

export function registerTalentsSettingsMenu() {
  registerSystemMenu("talentsSettings", {
    name: "Talents",
    label: "Configure Talents",
    hint: "Talent automation and Chapter 4 RAW compliance settings.",
    icon: "fas fa-user-ninja",
    restricted: true,
    type: TalentsSettingsAppV2,
  });
}
