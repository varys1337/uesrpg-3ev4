import { registerReadyRuntimeApi } from "../../api/runtime-registration.js";

function lazyModuleCall(importer, exportName, { bindTo = null } = {}) {
  return async (...args) => {
    const mod = await importer();
    const fn = mod?.[exportName];
    if (typeof fn !== "function") {
      throw new Error(`UESRPG | Lazy export '${exportName}' not available`);
    }
    return bindTo ? fn.bind(bindTo)(...args) : fn(...args);
  };
}

export function registerReadyRuntimeDevApi() {
  registerReadyRuntimeApi({
    magicApi: game.user?.isGM ? {
      rebuildZoneRegistry: lazyModuleCall(() => import("../../core/magic/spell-runtime.js"), "rebuildZoneRegistry"),
      rebuildRuneRegistry: lazyModuleCall(() => import("../../core/magic/services/rune-trigger-service.js"), "rebuildRuneRegistry"),
    } : null,
    combatApi: game.user?.isGM ? {
      flushBoundaryQueue: lazyModuleCall(() => import("../../core/time/boundary-work-scheduler.js"), "flushBoundaryWorkQueue"),
      getBoundaryQueueSize: lazyModuleCall(() => import("../../core/time/boundary-work-scheduler.js"), "getBoundaryWorkQueueSize"),
      rebuildRoundStartCandidateRegistry: lazyModuleCall(() => import("../../core/conditions/round-start-candidate-registry.js"), "rebuildRoundStartCandidateRegistry"),
    } : null,
  });
}
