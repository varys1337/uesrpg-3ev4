/**
 * src/core/time/index.js
 */

export { TimeService, initializeTimeService } from "./time-service.js";
export { buildEffectDuration } from "./effect-duration.js";
export { scheduleBoundaryWork, flushBoundaryWorkQueue, getBoundaryWorkQueueSize } from "./boundary-work-scheduler.js";
export { initializeCombatBoundaryOrchestrator, registerCombatBoundaryConsumer, isCombatBoundaryOrchestratorEnabled } from "./combat-boundary-orchestrator.js";
