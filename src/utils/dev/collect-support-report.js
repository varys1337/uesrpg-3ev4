/** On-demand GM metadata collection; no settings writes, maintenance, recording or uploads. */
import { SYSTEM_ID } from "../../core/constants.js";
import { getTypeDataModelDiagnosticsReport } from "../../core/data-models/registry.js";
import { MIGRATION_REVISIONS } from "../../core/migrations/revisions.js";
import { getPendingMigrationKeys, readMigrationStateSnapshot } from "../../core/migrations/state.js";
import { readPerfEntries, exportPerfEntries } from "../perf-tracker-support.js";
import { projectSupportReport, SUPPORT_SETTING_KEYS } from "./support-report.js";

export function collectSupportReport({ includeModules = false } = {}) {
  if (game.user?.isGM !== true) throw new Error("Only a GM may collect a support report.");
  const safely = read => { try { return read(); } catch (_error) { return null; } };
  const settings = Object.fromEntries(SUPPORT_SETTING_KEYS.map(key => [key, safely(() => game.settings.get(SYSTEM_ID, key))]));
  const pendingMigrations = safely(() => {
    const { available, state } = readMigrationStateSnapshot();
    return available ? getPendingMigrationKeys(MIGRATION_REVISIONS, state) : null;
  });
  return projectSupportReport({
    environment: { foundry: game.version, system: game.system.version },
    settings, pendingMigrations, models: safely(getTypeDataModelDiagnosticsReport),
    records: safely(readPerfEntries),
    performanceOverwritten: safely(() => exportPerfEntries().overwritten),
    modules: includeModules === true ? safely(() => Array.from(game.modules.values(), entry => ({
      id: entry.id, version: entry.version, active: entry.active,
    }))) : null,
  }, { includeModules });
}

