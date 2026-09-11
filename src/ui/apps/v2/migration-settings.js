import { SYSTEM_ID, templatePath } from "../../constants.js";
import {
  getAppliedMigrationRevision,
  getMigrationState,
  getSystemVersionString,
  isMigrationRevisionApplied,
} from "../../../core/migrations/state.js";
import { MIGRATION_REVISIONS } from "../../../core/migrations/revisions.js";
import {
  isSystemMigrationRunning,
  runSystemMigrations,
} from "../../../core/migrations/runner.js";
import { t } from "../../../utils/i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function _stateSummary(state, key) {
  const requiredRevision = MIGRATION_REVISIONS[key] ?? 0;
  const appliedRevision = getAppliedMigrationRevision(key, state);
  const raw = state?.[key];
  let version = t("UESRPG.UI.None", "(none)");
  if (appliedRevision > 0) {
    version = (raw && typeof raw === "object" && Number.isFinite(Number(raw.revision)))
      ? `r${appliedRevision}`
      : "legacy";
  }
  return {
    key,
    label: t(`UESRPG.Apps.MigrationSettings.Migrations.${key}`, key),
    appliedRevision,
    requiredRevision,
    version,
    upToDate: isMigrationRevisionApplied(key, requiredRevision, state),
  };
}

export class MigrationSettingsAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-migration-settings",
    tag: "section",
    window: {
      title: "UESRPG - Migration",
    },
    position: {
      width: 560,
      height: 700,
    },
    classes: ["uesrpg"],
    actions: {
      runMigrations: MigrationSettingsAppV2.prototype._onRunMigrations,
    },
  };

  static PARTS = {
    form: {
      template: templatePath("v2/apps/migration-settings.hbs"),
      scrollable: [".uesrpg-migration-status-list"],
    },
  };

  get title() {
    return t("UESRPG.Apps.Menus.migrationSettings.Name", "Migration");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const currentVersion = getSystemVersionString();
    const state = getMigrationState();
    const statuses = Object.keys(MIGRATION_REVISIONS).map((key) => _stateSummary(state, key));

    return {
      ...context,
      isRunning: isSystemMigrationRunning(),
      canRun: Boolean(game.user?.isGM),
      currentVersion,
      statuses,
      pendingCount: statuses.filter((entry) => !entry.upToDate).length,
    };
  }

  async _onRunMigrations(event, target) {
    event?.preventDefault?.();
    void target;

    if (!game.user?.isGM) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.MigrationsOnlyGM", "Only a GM can run migrations."));
      return;
    }

    if (isSystemMigrationRunning()) {
      ui.notifications?.info?.(t("UESRPG.Notifications.MigrationsAlreadyRunning", "Migration pass is already running."));
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
