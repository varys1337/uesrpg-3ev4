import { MigrationSettingsAppV2 } from "./v2/migration-settings.js";
import { localizeMenuConfig } from "../../utils/i18n.js";

const NAMESPACE = "uesrpg-3ev4";

export function registerMigrationSettingsMenu() {
  if (game.settings?.menus?.get(`${NAMESPACE}.migrationSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "migrationSettings", localizeMenuConfig("Menus", "migrationSettings", {
    name: "Migration",
    label: "Configure Migration",
    hint: "Migration controls and startup gating.",
    icon: "fas fa-shuffle",
    restricted: true,
    type: MigrationSettingsAppV2,
  }));
}
