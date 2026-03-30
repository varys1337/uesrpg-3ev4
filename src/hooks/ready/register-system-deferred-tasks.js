import { isPerfEnabled, monoMs, perfRecord } from "../../utils/perf-tracker.js";

function scheduleDeferredReadyTask(label, task) {
  setTimeout(async () => {
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
  }, 0);
}

export function registerSystemDeferredTasks() {
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
}
