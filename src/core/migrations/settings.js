import { AUTOMATION_DEFAULTS } from "../config/automation-policy.js";
import { SYSTEM_ID } from "../constants.js";
import { isActiveGMUser } from "../../utils/users.js";
import { MIGRATION_REVISIONS } from "./revisions.js";
import {
  getAppliedMigrationRevision,
  getMigrationState,
  isMigrationRevisionApplied,
  markMigrationRevisionApplied,
  setMigrationState,
} from "./state.js";

const TIME_SETTINGS_MIGRATION_KEY = "timeDefaultsCompositeOrchestratorV1";
const AUTOMATION_PROFILE_REMOVAL_V1_KEY = "automationProfileRemovalDefaultsV1";
const AUTOMATION_PROFILE_REMOVAL_V2_KEY = "automationProfileRemovalDefaultsV2";

function hasStoredWorldSetting(key) {
  const storage = game.settings?.storage?.get?.("world");
  return Boolean(storage?.has?.(`${SYSTEM_ID}.${String(key ?? "").trim()}`));
}

function assertSettingRegistered(key) {
  if (game.settings?.settings?.has?.(`${SYSTEM_ID}.${key}`) !== true) {
    throw new Error(`UESRPG | Cannot migrate unregistered setting ${key}`);
  }
}

async function migrateTimeDefaultsIfNeeded() {
  const revision = MIGRATION_REVISIONS[TIME_SETTINGS_MIGRATION_KEY];
  let state = getMigrationState();
  if (isMigrationRevisionApplied(TIME_SETTINGS_MIGRATION_KEY, revision, state)) {
    return { changedKeys: [], preservedKeys: [], skipped: true };
  }

  const changedKeys = [];
  const preservedKeys = [];
  for (const key of ["compositeBoundaryTickEnabled", "useCombatBoundaryOrchestrator"]) {
    assertSettingRegistered(key);
    if (hasStoredWorldSetting(key)) {
      preservedKeys.push(key);
      continue;
    }
    await game.settings.set(SYSTEM_ID, key, true);
    changedKeys.push(key);
  }

  state = getMigrationState();
  markMigrationRevisionApplied(state, TIME_SETTINGS_MIGRATION_KEY, revision, { changedKeys, preservedKeys });
  await setMigrationState(state);
  return { changedKeys, preservedKeys, skipped: false };
}

async function migrateAutomationProfileRemovalDefaultsIfNeeded() {
  const revision = MIGRATION_REVISIONS[AUTOMATION_PROFILE_REMOVAL_V2_KEY];
  let state = getMigrationState();
  if (isMigrationRevisionApplied(AUTOMATION_PROFILE_REMOVAL_V2_KEY, revision, state)) {
    const applied = state?.[AUTOMATION_PROFILE_REMOVAL_V2_KEY];
    return {
      changedKeys: [],
      preservedKeys: [],
      skipped: true,
      reviewRequired: Boolean(applied && typeof applied === "object" && applied.reviewRequired),
    };
  }

  const legacyV1Applied = getAppliedMigrationRevision(AUTOMATION_PROFILE_REMOVAL_V1_KEY, state) > 0;
  if (legacyV1Applied) {
    const preservedKeys = Object.keys(AUTOMATION_DEFAULTS);
    const timeRevision = MIGRATION_REVISIONS[TIME_SETTINGS_MIGRATION_KEY];
    if (!isMigrationRevisionApplied(TIME_SETTINGS_MIGRATION_KEY, timeRevision, state)) {
      markMigrationRevisionApplied(state, TIME_SETTINGS_MIGRATION_KEY, timeRevision, {
        changedKeys: [],
        preservedKeys: ["compositeBoundaryTickEnabled", "useCombatBoundaryOrchestrator"],
        skippedDueToLegacyRevision: AUTOMATION_PROFILE_REMOVAL_V1_KEY,
      });
    }
    markMigrationRevisionApplied(state, AUTOMATION_PROFILE_REMOVAL_V2_KEY, revision, {
      changedKeys: [],
      preservedKeys,
      reviewRequired: true,
      legacyRevisionDetected: AUTOMATION_PROFILE_REMOVAL_V1_KEY,
    });
    await setMigrationState(state);

    const message = game.i18n?.localize?.("UESRPG.Notifications.AutomationSettingsReview")
      ?? "Automation settings may have been reset by an earlier system version. Review them in System Settings.";
    console.warn(`UESRPG | ${message}`);
    ui.notifications?.warn?.(message, { permanent: true });
    return { changedKeys: [], preservedKeys, skipped: false, reviewRequired: true };
  }

  const changedKeys = [];
  const preservedKeys = [];
  for (const [key, value] of Object.entries(AUTOMATION_DEFAULTS)) {
    assertSettingRegistered(key);
    if (hasStoredWorldSetting(key)) {
      preservedKeys.push(key);
      continue;
    }
    await game.settings.set(SYSTEM_ID, key, value);
    changedKeys.push(key);
  }

  state = getMigrationState();
  markMigrationRevisionApplied(state, AUTOMATION_PROFILE_REMOVAL_V2_KEY, revision, {
    changedKeys,
    preservedKeys,
    reviewRequired: false,
  });
  await setMigrationState(state);
  return { changedKeys, preservedKeys, skipped: false, reviewRequired: false };
}

export async function migrateWorldSettingsIfNeeded() {
  if (!isActiveGMUser(game.user)) return { ok: false, reason: "not-active-gm" };
  const automation = await migrateAutomationProfileRemovalDefaultsIfNeeded();
  const time = automation.reviewRequired
    ? { changedKeys: [], preservedKeys: ["compositeBoundaryTickEnabled", "useCombatBoundaryOrchestrator"], skipped: true }
    : await migrateTimeDefaultsIfNeeded();
  return { ok: true, time, automation };
}
