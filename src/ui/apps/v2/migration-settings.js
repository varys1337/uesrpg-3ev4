import { templatePath } from "../../constants.js";
import {
  getAppliedMigrationRevision,
  getMigrationFailureCount,
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
import { isActiveGMUser } from "../../../utils/users.js";

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
    failureCount: getMigrationFailureCount(raw),
    reviewRequired: Boolean(raw?.reviewRequired),
  };
}

export class MigrationSettingsAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-migration-settings",
    tag: "section",
    window: {
      resizable: true,
      title: "UESRPG - Migration",
    },
    position: {
      width: 560,
      height: 700,
    },
    classes: ["standard-form", "uesrpg-settings-app"],
    actions: {
      runMigrations: MigrationSettingsAppV2.prototype._onRunMigrations,
    },
  };

  static PARTS = {
    form: {
      template: templatePath("v2/apps/migration-settings.hbs"),
      scrollable: [".uesrpg-settings__body"],
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
      canRun: isActiveGMUser(game.user),
      currentVersion,
      statuses,
      pendingCount: statuses.filter((entry) => !entry.upToDate).length,
    };
  }

  async _onRunMigrations(event, target) {
    event?.preventDefault?.();
    void target;

    if (!isActiveGMUser(game.user)) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.MigrationsOnlyActiveGM", "Only the selected active GM can run migrations."));
      return;
    }

    const request = runSystemMigrations({
      origin: "manual",
      notifyStart: true,
      notifySuccess: true,
      notifyFailure: true,
    });
    try {
      await this.render({ force: false });
    } finally {
      // A presentation failure must not detach the in-flight migration. Refresh
      // from persisted revisions after either a successful or failed pass.
      try { await request; } finally { await this.render({ force: false }); }
    }
  }
}
