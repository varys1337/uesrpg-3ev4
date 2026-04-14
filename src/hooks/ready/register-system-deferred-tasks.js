import { isPerfEnabled, monoMs, perfRecord } from "../../utils/perf-tracker.js";

function scheduleDeferredReadyTask(label, task, options = {}) {
  const scheduler = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb) => setTimeout(cb, 0);
  
  scheduler(async () => {
    const startedAt = isPerfEnabled() ? monoMs() : 0;
    try {
      await task();
      if (isPerfEnabled()) {
        perfRecord({ event: `system.ready.deferred.${label}`, ok: true, durationMs: monoMs() - startedAt });
      }
    } catch (err) {
      console.warn(`UESRPG | Deferred ready task failed: ${label}`, err);
      if (isPerfEnabled()) {
        perfRecord({ event: `system.ready.deferred.${label}`, ok: false, durationMs: monoMs() - startedAt });
      }
    }
  }, { timeout: options.timeout ?? 1000 });
}

export function registerSystemDeferredTasks() {
  // Existing deferred tasks (unchanged)
  scheduleDeferredReadyTask("utility-spells", async () => {
    const { initializeUtilitySpellsService } = await import("../../core/magic/services/utility-spells-service.js");
    initializeUtilitySpellsService();
  });

  scheduleDeferredReadyTask("characteristic-defense", async () => {
    const { initializeCharacteristicDefenseService } = await import("../../core/magic/characteristic-defense-service.js");
    initializeCharacteristicDefenseService();
  });

  scheduleDeferredReadyTask("alchemy-runtime", async () => {
    const { initializeAlchemyRuntime } = await import("../../core/alchemy/runtime.js");
    initializeAlchemyRuntime();
  });

  scheduleDeferredReadyTask("strike-runtime", async () => {
    const { initializeStrikeOnHitRuntime } = await import("../../core/enchanting/runtime/strike-on-hit.js");
    initializeStrikeOnHitRuntime();
  });

  // New deferred tasks from Patch 3: Ready-Path Deferral
  scheduleDeferredReadyTask("startup-dialog", async () => {
    const startupHandler = await import("../startup.js");
    await startupHandler.default();
  });

  scheduleDeferredReadyTask("token-hud-upgrade", async () => {
    const { runTokenHudStatusUpgradeMaintenance } = await import("../../core/conditions/status-hud.js");
    await runTokenHudStatusUpgradeMaintenance();
  });

  scheduleDeferredReadyTask("perf-api-init", async () => {
    const { initializePerfApi } = await import("../../utils/perf-tracker.js");
    initializePerfApi();
  });

  scheduleDeferredReadyTask("startup-audit", async () => {
    const { runStartupAuditIfEnabled } = await import("./run-world-ready-maintenance.js");
    await runStartupAuditIfEnabled();
  });
}
