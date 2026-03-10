import { SYSTEM_ID, templatePath } from "../../constants.js";
import {
  getMigrationState,
  getSystemVersionString,
} from "../../../core/migrations/state.js";
import {
  isSystemMigrationRunning,
  runSystemMigrations,
} from "../../../core/migrations/runner.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = SYSTEM_ID;

function _stateSummary(state, key, currentVersion) {
  const value = String(state?.[key] ?? "").trim();
  return {
    version: value || "(none)",
    upToDate: value === currentVersion,
  };
}

export class MigrationSettingsAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-migration-settings",
    tag: "form",
    form: {
      handler: MigrationSettingsAppV2._onSubmit,
      closeOnSubmit: false,
      submitOnChange: false,
    },
    window: {
      title: "UESRPG - Migration",
    },
    position: {
      width: 560,
    },
    classes: ["uesrpg"],
    actions: {
      runMigrations: MigrationSettingsAppV2.prototype._onRunMigrations,
    },
  };

  static PARTS = {
    form: {
      template: templatePath("v2/apps/migration-settings.hbs"),
    },
  };

  async _prepareContext(options) {
    const currentVersion = getSystemVersionString();
    const state = getMigrationState();

    return {
      autoRunMigrationsOnStartup: game.settings.get(NAMESPACE, "autoRunMigrationsOnStartup") === true,
      isRunning: isSystemMigrationRunning(),
      currentVersion,
      status: {
        actors: _stateSummary(state, "actors", currentVersion),
        items: _stateSummary(state, "items", currentVersion),
        combatLegacy: _stateSummary(state, "combatLegacy", currentVersion),
      },
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object ?? {};
    const next = Boolean(data.autoRunMigrationsOnStartup);
    await game.settings.set(NAMESPACE, "autoRunMigrationsOnStartup", next);
    ui.notifications?.info?.("Migration startup setting saved.");
  }

  async _onRunMigrations(event, target) {
    event?.preventDefault?.();
    void target;

    if (!game.user?.isGM) {
      ui.notifications?.warn?.("Only a GM can run migrations.");
      return;
    }

    if (isSystemMigrationRunning()) {
      ui.notifications?.info?.("Migration pass is already running.");
      return;
    }

    const result = await runSystemMigrations({
      origin: "manual",
      notifyStart: true,
      notifySuccess: true,
      notifyFailure: true,
    });
    if (result?.ok) this.render(false);
  }
}
