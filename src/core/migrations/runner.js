import { SYSTEM_ID } from "../constants.js";
import { migrateActiveEffectsIfNeeded } from "./active-effects.js";
import { migrateActorsIfNeeded, migrateNpcThreatTemplateKeysIfNeeded, migrateNpcThreatTemplateOptionsIfNeeded, migrateWarfareUnitNeutralLanesIfNeeded } from "./actors.js";
import { migrateItemsIfNeeded, migrateItemSheetCompatibilityIfNeeded, migrateNpcArmorCoverageDefaultsIfNeeded } from "./items.js";
import { migrateCombatLegacyIfNeeded } from "./combat-legacy.js";
import { migrateWarfareFlagDocumentsIfNeeded } from "./warfare-flags.js";
import { migrateAoeRegionLinksIfNeeded } from "./aoe-region-links.js";
import { migrateWorldSettingsIfNeeded } from "./settings.js";
import { migrateSystemTemplateDirectivesIfNeeded } from "./system-template-directives.js";
import { isActiveGMUser } from "../../utils/users.js";
import { t, tf } from "../../utils/i18n.js";
import { getMigrationFailureCount, getMigrationState, getPendingMigrationKeys } from "./state.js";
import { MIGRATION_REVISIONS } from "./revisions.js";
import { createMigrationCoordinator, executeMigrationPasses } from "./execution.js";

const _coordinator = createMigrationCoordinator();
const _settingsPass = {
  name: "migrateWorldSettingsIfNeeded", run: migrateWorldSettingsIfNeeded,
  keys: ["timeDefaultsCompositeOrchestratorV1", "automationProfileRemovalDefaultsV2"],
};
const _armorPass = {
  name: "migrateNpcArmorCoverageDefaultsIfNeeded", run: migrateNpcArmorCoverageDefaultsIfNeeded,
  keys: ["npcArmorCoverageDefaultsV1"],
};
const _startupPasses = [_settingsPass, _armorPass];
const _manualPasses = [
  _settingsPass,
  ...[
    migrateActiveEffectsIfNeeded,
    migrateSystemTemplateDirectivesIfNeeded,
    // Repair known Item shapes before older passes validate complete models.
    migrateItemSheetCompatibilityIfNeeded,
    migrateActorsIfNeeded,
    migrateItemsIfNeeded,
  ].map(run => ({ name: run.name, run })),
  _armorPass,
  ...[
    migrateCombatLegacyIfNeeded,
    migrateAoeRegionLinksIfNeeded,
    migrateNpcThreatTemplateKeysIfNeeded,
    migrateNpcThreatTemplateOptionsIfNeeded,
    migrateWarfareUnitNeutralLanesIfNeeded,
    migrateWarfareFlagDocumentsIfNeeded,
  ].map(run => ({ name: run.name, run })),
];

function _isGM() {
  return isActiveGMUser(game.user);
}

/**
 * Run the full manual sequence. Same-scope calls join; startup is a separate
 * queued scope so a manual request never receives a startup-only result.
 *
 * @param {object} options
 * @param {"startup"|"manual"} [options.origin]
 * @param {boolean} [options.notifyStart]
 * @param {boolean} [options.notifySuccess]
 * @param {boolean} [options.notifyFailure]
 */
export async function runSystemMigrations({
  origin = "manual",
  notifyStart = false,
  notifySuccess = false,
  notifyFailure = true,
} = {}) {
  return _runMigrations("manual", { origin, notifyStart, notifySuccess, notifyFailure });
}

/** Only the settings and NPC armor maintenance that already ran at startup. */
export async function runStartupMigrationMaintenance() {
  return _runMigrations("startup", { origin: "startup", notifyFailure: true });
}

function _runMigrations(scope, { origin, notifyStart = false, notifySuccess = false, notifyFailure = true }) {
  const required = scope === "startup" ? _startupPasses.flatMap(pass => pass.keys) : MIGRATION_REVISIONS;
  const getPendingKeys = () => getPendingMigrationKeys(required, getMigrationState());
  if (!_isGM()) return Promise.resolve({ ok: false, reason: "not-active-gm", pendingKeys: getPendingKeys(), failedPass: null });

  return _coordinator.run(scope, async () => {
    const startedAt = Date.now();
    if (notifyStart && _isGM()) {
      ui.notifications?.info?.(t("UESRPG.Notifications.MigrationsStarted", "UESRPG migration pass started."));
    }
    const result = await executeMigrationPasses({
      passes: scope === "startup" ? _startupPasses : _manualPasses,
      canRun: _isGM,
      getPendingKeys,
      // Historical failures require an explicit manual retry. Do not clear them
      // or expand startup coverage to make the status look complete.
      shouldRun: pass => scope !== "startup" || !pass.keys.some(key => getMigrationFailureCount(getMigrationState()?.[key]) > 0),
    });
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    if (result.ok) {
      console.log(`${SYSTEM_ID} | ${scope === "startup" ? "Startup migration maintenance" : "Migration pass"} complete`, { origin, elapsedMs });
      if (notifySuccess && _isGM()) {
        const elapsedSec = (elapsedMs / 1000).toFixed(2);
        ui.notifications?.info?.(tf("UESRPG.Notifications.MigrationsComplete", { elapsed: elapsedSec }, `UESRPG migrations complete (${elapsedSec}s).`));
      }
    } else {
      console.error(`${SYSTEM_ID} | Migration pass incomplete`, { origin, ...result });
      if (notifyFailure && _isGM()) {
        ui.notifications?.warn?.(t("UESRPG.Notifications.MigrationsFailed", "UESRPG migration pass failed; check console for details."));
      }
    }
    return { ...result, elapsedMs };
  });
}

export function isSystemMigrationRunning() {
  return _coordinator.isRunning();
}
