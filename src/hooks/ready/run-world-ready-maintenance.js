import { initSettingsCache } from "../../core/config/settings-cache.js";
import { AUTOMATION_DEFAULTS } from "../../core/config/automation-policy.js";
import { STARTUP_PENDING_MIGRATION_KEYS } from "../../core/migrations/revisions.js";
import { getMigrationState, getPendingMigrationKeys } from "../../core/migrations/state.js";
import { migrateWorldSettingsIfNeeded } from "../../core/migrations/settings.js";
import { SYSTEM_ID } from "../../core/system/namespace.js";
import { isActiveGMUser } from "../../utils/users.js";
import { migrateNpcArmorCoverageDefaultsIfNeeded } from "../../core/migrations/items.js";

let _startupAttackTrackerPolicyLogged = false;

function readSettingIfRegistered(key, fallback = null) {
  try {
    const settingKey = `${SYSTEM_ID}.${String(key ?? "").trim()}`;
    if (game?.settings?.settings?.has?.(settingKey) !== true) return fallback;
    return game.settings.get(SYSTEM_ID, key);
  } catch (_e) {
    return fallback;
  }
}

function logAttackTrackerPolicyDiagnosticsOnce() {
  if (_startupAttackTrackerPolicyLogged) return;
  if (!game.user?.isGM) return;

  const debugEnabled = Boolean(readSettingIfRegistered("debugEnabled", false));
  const effectsProxyDebug = Boolean(readSettingIfRegistered("effectsProxyDebug", false));
  if (!debugEnabled || !effectsProxyDebug) return;

  const automationProfileRegistered = game?.settings?.settings?.has?.(`${SYSTEM_ID}.automationProfile`) === true;
  const enableActionEconomyUI = readSettingIfRegistered("enableActionEconomyUI", null);
  const actionPointAutomation = readSettingIfRegistered("actionPointAutomation", null);
  const dynamicInitiativeEnabled = readSettingIfRegistered("dynamicInitiativeEnabled", null);
  const skipAttackTrackerEagerReset = Boolean(
    readSettingIfRegistered("skipAttackTrackerEagerReset", AUTOMATION_DEFAULTS.skipAttackTrackerEagerReset)
  );
  const useCombatBoundaryOrchestrator = Boolean(
    readSettingIfRegistered("useCombatBoundaryOrchestrator", AUTOMATION_DEFAULTS.useCombatBoundaryOrchestrator)
  );
  const compositeBoundaryTickEnabled = Boolean(
    readSettingIfRegistered("compositeBoundaryTickEnabled", AUTOMATION_DEFAULTS.compositeBoundaryTickEnabled)
  );
  const deferNonCriticalRoundBoundaryWork = Boolean(
    readSettingIfRegistered("deferNonCriticalRoundBoundaryWork", AUTOMATION_DEFAULTS.deferNonCriticalRoundBoundaryWork)
  );
  const payload = {
    automationProfileRegistered,
    automationProfileStoredValue: automationProfileRegistered
      ? readSettingIfRegistered("automationProfile", null)
      : null,
    registeredSettings: {
      skipAttackTrackerEagerReset: game?.settings?.settings?.has?.(`${SYSTEM_ID}.skipAttackTrackerEagerReset`) === true,
      useCombatBoundaryOrchestrator: game?.settings?.settings?.has?.(`${SYSTEM_ID}.useCombatBoundaryOrchestrator`) === true,
      compositeBoundaryTickEnabled: game?.settings?.settings?.has?.(`${SYSTEM_ID}.compositeBoundaryTickEnabled`) === true,
      deferNonCriticalRoundBoundaryWork: game?.settings?.settings?.has?.(`${SYSTEM_ID}.deferNonCriticalRoundBoundaryWork`) === true,
      enableActionEconomyUI: game?.settings?.settings?.has?.(`${SYSTEM_ID}.enableActionEconomyUI`) === true,
      actionPointAutomation: game?.settings?.settings?.has?.(`${SYSTEM_ID}.actionPointAutomation`) === true,
      dynamicInitiativeEnabled: game?.settings?.settings?.has?.(`${SYSTEM_ID}.dynamicInitiativeEnabled`) === true,
    },
    enableActionEconomyUI,
    actionPointAutomation,
    dynamicInitiativeEnabled,
    skipAttackTrackerEagerReset,
    useCombatBoundaryOrchestrator,
    compositeBoundaryTickEnabled,
    deferNonCriticalRoundBoundaryWork,
    effectiveAttackTrackerPolicy: {
      eagerResetEnabled: !skipAttackTrackerEagerReset,
      boundaryOrchestratorEnabled: useCombatBoundaryOrchestrator,
      compositeBoundaryTickEnabled,
      deferNonCriticalRoundBoundaryWork,
    }
  };

  _startupAttackTrackerPolicyLogged = true;
  console.log("[UESRPG][AttackTracker][Policy] startup", payload);
}

async function ensureWorldVersionStamp() {
  if (!isActiveGMUser(game.user)) return;
  const currentVersion = game.system?.version ?? "";
  const stampedVersion = game.settings.get(SYSTEM_ID, "worldDataVersion");
  const debugEnabled = Boolean(readSettingIfRegistered("migrationDebug", false));

  if (!stampedVersion) {
    try {
      await game.settings.set(SYSTEM_ID, "worldDataVersion", currentVersion);
      if (debugEnabled) console.debug(`UESRPG | World data version stamped: ${currentVersion}`);
    } catch (err) {
      console.warn("UESRPG | Failed to stamp world data version", err);
    }
    return;
  }

  if (stampedVersion === currentVersion) return;

  try {
    await game.settings.set(SYSTEM_ID, "worldDataVersion", currentVersion);
    if (debugEnabled) console.debug(`UESRPG | World data version updated: ${stampedVersion} -> ${currentVersion}`);
  } catch (err) {
    console.warn("UESRPG | Failed to update world data version stamp", err);
  }
}

function notifyPendingMigrationsIfNeeded() {
  if (!game.user?.isGM) return;

  const pendingKeys = getPendingMigrationKeys(STARTUP_PENDING_MIGRATION_KEYS, getMigrationState());
  if (!pendingKeys.length) return;

  ui.notifications?.warn?.(
    `UESRPG | World has ${pendingKeys.length} pending targeted data migration(s). Review/run them from System Settings -> Migration.`,
    { permanent: true }
  );
}

export async function runWorldReadyMaintenance() {
  // Critical path - must complete before world is usable
  await ensureWorldVersionStamp();
  await migrateWorldSettingsIfNeeded();
  await migrateNpcArmorCoverageDefaultsIfNeeded();
  notifyPendingMigrationsIfNeeded();
  initSettingsCache();
  logAttackTrackerPolicyDiagnosticsOnce();
  
  // Deferrable tasks are now scheduled via registerSystemDeferredTasks()
  // They will run after the critical path completes
}
