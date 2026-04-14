import startupHandler from "../startup.js";
import { alertDialog } from "../../utils/dialog-v2-helper.js";
import { initSettingsCache } from "../../core/config/settings-cache.js";
import { SYSTEM_ID } from "../../core/system/namespace.js";
import { initializePerfApi } from "../../utils/perf-tracker.js";
import { runTokenHudStatusUpgradeMaintenance } from "../../core/conditions/status-hud.js";

const TIME_SETTINGS_MIGRATION_KEY = "timeDefaultsCompositeOrchestratorV1";

function hasStoredWorldSetting(key) {
  try {
    const storage = game?.settings?.storage?.get?.("world");
    if (!storage || typeof storage.has !== "function") return false;
    return storage.has(`${SYSTEM_ID}.${String(key ?? "").trim()}`);
  } catch (_e) {
    return false;
  }
}

async function migrateTimeDefaultsSafely() {
  if (!game.user?.isGM) return;

  let state = {};
  try {
    const raw = String(game.settings.get(SYSTEM_ID, "migrationState") ?? "{}");
    const parsed = JSON.parse(raw);
    state = (parsed && typeof parsed === "object") ? parsed : {};
  } catch (_e) {
    state = {};
  }

  if (state?.[TIME_SETTINGS_MIGRATION_KEY]) return;

  const changed = [];
  const targets = ["compositeBoundaryTickEnabled", "useCombatBoundaryOrchestrator"];
  for (const key of targets) {
    if (hasStoredWorldSetting(key)) continue;
    try {
      await game.settings.set(SYSTEM_ID, key, true);
      changed.push(key);
    } catch (err) {
      console.warn(`UESRPG | Failed setting migration for "${key}"`, err);
    }
  }

  state[TIME_SETTINGS_MIGRATION_KEY] = {
    appliedAt: Date.now(),
    changedKeys: changed
  };

  try {
    await game.settings.set(SYSTEM_ID, "migrationState", JSON.stringify(state));
  } catch (err) {
    console.warn("UESRPG | Failed to persist time settings migration state", err);
  }
}

async function ensureWorldVersionStamp() {
  const currentVersion = game.system?.version ?? "";
  const stampedVersion = game.settings.get(SYSTEM_ID, "worldDataVersion");

  if (!stampedVersion) {
    try {
      await game.settings.set(SYSTEM_ID, "worldDataVersion", currentVersion);
      console.log(`UESRPG | World data version stamped: ${currentVersion}`);
    } catch (err) {
      console.warn("UESRPG | Failed to stamp world data version", err);
    }
    return;
  }

  if (stampedVersion === currentVersion) return;

  if (game.user?.isGM) {
    ui.notifications.warn(
      `UESRPG | This world was created with system version ${stampedVersion} ` +
      `but the current system version is ${currentVersion}. ` +
      `Continuing with startup and available migrations.`,
      { permanent: true }
    );
    alertDialog({
      title: "UESRPG - Version Mismatch",
      content: `<p>This world was last used with system version <strong>${stampedVersion}</strong>, ` +
        `but the current system is <strong>${currentVersion}</strong>.</p>` +
        `<p>Automatic compatibility migrations will run where available.</p>`,
      buttonLabel: "Understood",
      buttonIcon: "fas fa-check",
    });
  }

  console.warn(`UESRPG | World version mismatch: stamped=${stampedVersion}, current=${currentVersion}. Continuing with migrations.`);
  if (!game.user?.isGM) return;

  try {
    await game.settings.set(SYSTEM_ID, "worldDataVersion", currentVersion);
    console.log(`UESRPG | World data version updated: ${stampedVersion} -> ${currentVersion}`);
  } catch (err) {
    console.warn("UESRPG | Failed to update world data version stamp", err);
  }
}

async function runStartupAuditIfEnabled() {
  try {
    if (!game.user?.isGM) return;
    const auditMode = String(game.settings.get(SYSTEM_ID, "chapter4AuditStartupMode") ?? "off");
    if (auditMode === "off") return;

    const { auditChapter4 } = await import("../../utils/dev/chapter4-audit.js");
    const includeEntries = auditMode === "full";
    const report = auditChapter4({ includeEntries, log: includeEntries });
    const gaps = report?.gaps ?? {};
    const gapCount =
      (Array.isArray(gaps.missingFromCatalog) ? gaps.missingFromCatalog.length : 0) +
      (Array.isArray(gaps.unknownAutomation) ? gaps.unknownAutomation.length : 0) +
      (Array.isArray(gaps.notAutomated) ? gaps.notAutomated.length : 0) +
      (Array.isArray(gaps.blocked) ? gaps.blocked.length : 0) +
      (Array.isArray(gaps.stubs) ? gaps.stubs.length : 0) +
      (gaps.traitsCatalogMissing ? 1 : 0) +
      (gaps.powersCatalogMissing ? 1 : 0);

    if (gapCount > 0) {
      ui.notifications?.warn?.(`Chapter 4 audit found ${gapCount} compliance gap(s). Use game.uesrpg.auditChapter4({ includeEntries: true, log: true }) for details.`);
    } else {
      ui.notifications?.info?.("Chapter 4 audit: no compliance gaps detected.");
    }
  } catch (err) {
    console.warn("UESRPG | Chapter 4 startup audit failed", err);
  }
}

export async function runWorldReadyMaintenance() {
  // Critical path - must complete before world is usable
  await ensureWorldVersionStamp();
  await migrateTimeDefaultsSafely();
  initSettingsCache();
  
  // Deferrable tasks are now scheduled via registerSystemDeferredTasks()
  // They will run after the critical path completes
}

// Keep the audit function export for deferred scheduling
export { runStartupAuditIfEnabled };
