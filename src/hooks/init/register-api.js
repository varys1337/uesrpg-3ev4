import * as damageApi from "../../core/combat/damage-automation.js";
import * as rollApi from "../../utils/degree-roll-helper.js";
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
  automationPolicyApi,
  tokenActionHudApi,
  applicationApi,
  authorityApi,
} = {}) {
  window.Uesrpg3e ??= {};
  Object.assign(window.Uesrpg3e.damage ??= {}, {
    DAMAGE_TYPES: damageApi.DAMAGE_TYPES,
    getDamageReduction: damageApi.getDamageReduction,
    calculateDamage: damageApi.calculateDamage,
    applyDamage: damageApi.applyDamage,
    applyHealing: damageApi.applyHealing,
  });
  Object.assign(window.Uesrpg3e.roll ??= {}, rollApi);
  registerInitRuntimeApi({
    isPredicate,
    evaluatePredicate,
    selfTestPredicate,
    normalizeRollOption,
    buildBaseRollOptions,
    buildRollContext,
    compileConditionsToPredicate,
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
    automationPolicyApi,
    tokenActionHudApi,
    applicationApi,
    authorityApi,
  });
}
