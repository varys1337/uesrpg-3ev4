import { MigrationSettingsAppV2 } from "./v2/migration-settings.js";
import { registerSystemMenu } from "../../utils/settings-registration.js";

export function registerMigrationSettingsMenu() {
  registerSystemMenu("migrationSettings", {
    name: "Migration",
    label: "Configure Migration",
    hint: "Review migration status and run migrations manually.",
    icon: "fas fa-shuffle",
    restricted: true,
    type: MigrationSettingsAppV2,
  });
}
