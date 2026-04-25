import { SYSTEM_ID } from "../system/namespace.js";

export const AUTOMATION_DEFAULTS = Object.freeze({
  aggregateRegenPrompts: false,
  aggregateSilencedChecks: false,
  deferNonCriticalRoundBoundaryWork: false,
  useRoundStartCandidateRegistry: true,
  skipAttackTrackerEagerReset: false,
  useCombatBoundaryOrchestrator: true,
  compositeBoundaryTickEnabled: true,
  damageAftermathBundlingEnabled: false,
});

function _readBooleanSetting(key, fallback = false) {
  try {
    const value = game?.settings?.get?.(SYSTEM_ID, key);
    return value === undefined ? Boolean(fallback) : Boolean(value);
  } catch (_e) {
    return Boolean(fallback);
  }
}

function _readPolicyFlag(key) {
  return _readBooleanSetting(key, AUTOMATION_DEFAULTS[key] ?? false);
}

export function isAggregateRegenPromptsEnabled() {
  return _readPolicyFlag("aggregateRegenPrompts") === true;
}

export function isAggregateSilencedChecksEnabled() {
  return _readPolicyFlag("aggregateSilencedChecks") === true;
}

export function isBoundaryWorkDeferEnabled() {
  return _readPolicyFlag("deferNonCriticalRoundBoundaryWork") === true;
}

export function isRoundStartCandidateRegistryEnabled() {
  return _readPolicyFlag("useRoundStartCandidateRegistry") === true;
}

export function isAttackTrackerEagerResetSkipped() {
  return _readPolicyFlag("skipAttackTrackerEagerReset") === true;
}

export function isCombatBoundaryOrchestratorPolicyEnabled() {
  return _readPolicyFlag("useCombatBoundaryOrchestrator") === true;
}

export function isCompositeBoundaryTickEnabled() {
  return _readPolicyFlag("compositeBoundaryTickEnabled") === true;
}

export function isDamageAftermathBundlingEnabled() {
  return _readPolicyFlag("damageAftermathBundlingEnabled") === true;
}
