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
} = {}) {
  if (!game.uesrpg) game.uesrpg = {};
  if (!game.uesrpg.rules) game.uesrpg.rules = {};

  game.uesrpg.rules.predicate = {
    isPredicate,
    evaluatePredicate,
    selfTest: selfTestPredicate,
  };
  game.uesrpg.rules.rollOptions = {
    normalize: normalizeRollOption,
    buildBase: buildBaseRollOptions,
  };
  game.uesrpg.rules.rollContext = {
    build: buildRollContext,
  };
  game.uesrpg.rules.conditions = {
    compileToPredicate: compileConditionsToPredicate,
  };
  game.uesrpg.rules.ruleElements = {
    getSupportMatrix: getRuleElementRuntimeSupport,
    selfTestRuntime: selfTestRuleElementRuntime,
  };

  if (!game.uesrpg.combat) game.uesrpg.combat = {};
  game.uesrpg.combat.applyDamage = applyDamage;
  game.uesrpg.combat.applyDamageResolved = applyDamageResolved;
  game.uesrpg.combat.DAMAGE_TYPES = DAMAGE_TYPES;
  game.uesrpg.combat.applyHealing = async (actor, amount, options = {}) => {
    const src = options?.source ?? "Healing";
    return applyHealing(actor, amount, { ...options, source: src });
  };
  game.uesrpg.combat.resolveSurpriseState = resolveSurpriseState;
  game.uesrpg.combat.setActorSurprised = setActorSurprised;
  game.uesrpg.combat.clearActorSurpriseState = clearActorSurpriseState;
  game.uesrpg.combat.markSurprisedFirstTurnPassed = markSurprisedFirstTurnPassed;
  game.uesrpg.combat.getInitiativeTieBreakTuple = getInitiativeTieBreakTuple;
  game.uesrpg.combat.getSizeToHitModifier = getSizeToHitModifier;
  game.uesrpg.combat.getActionEligibility = getActionEligibility;

  if (!game.uesrpg.characteristics) game.uesrpg.characteristics = {};
  game.uesrpg.characteristics.CharOpposedWorkflow = CharOpposedWorkflow;
}
