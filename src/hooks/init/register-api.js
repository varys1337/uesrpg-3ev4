import { registerInitRuntimeApi } from "../../api/runtime-registration.js";

/**
 * Register stable API surfaces on `game.uesrpg`.
 * Keeps macro/downstream integrations independent from local import paths.
 */
export function registerApi({
  isPredicate,
  evaluatePredicate,
  selfTestPredicate,
  normalizeRollOption,
  buildBaseRollOptions,
  buildRollContext,
  compileConditionsToPredicate,
  getRuleElementRuntimeSupport,
  selfTestRuleElementRuntime,
  applyDamage,
  applyHealing,
  applyDamageResolved,
  DAMAGE_TYPES,
  resolveSurpriseState,
  setActorSurprised,
  clearActorSurpriseState,
  markSurprisedFirstTurnPassed,
  getInitiativeTieBreakTuple,
  getSizeToHitModifier,
  getActionEligibility,
  CharOpposedWorkflow,
  runCombatLegacyReadinessScan,
  tokenActionHudApi,
} = {}) {
  registerInitRuntimeApi({
    isPredicate,
    evaluatePredicate,
    selfTestPredicate,
    normalizeRollOption,
    buildBaseRollOptions,
    buildRollContext,
    compileConditionsToPredicate,
    getRuleElementRuntimeSupport,
    selfTestRuleElementRuntime,
    applyDamage,
    applyHealing,
    applyDamageResolved,
    DAMAGE_TYPES,
    resolveSurpriseState,
    setActorSurprised,
    clearActorSurpriseState,
    markSurprisedFirstTurnPassed,
    getInitiativeTieBreakTuple,
    getSizeToHitModifier,
    getActionEligibility,
    CharOpposedWorkflow,
    runCombatLegacyReadinessScan,
    tokenActionHudApi,
  });
}
