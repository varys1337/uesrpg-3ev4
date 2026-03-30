/**
 * Internal runtime registration helpers for the `game.uesrpg` namespace.
 *
 * This file is intentionally not re-exported from src/api/index.js. The static
 * import barrel remains the public ESM surface; these helpers only centralize
 * runtime namespace ownership for init/ready startup flows.
 */

function ensureRootNamespace() {
  game.uesrpg = game.uesrpg ?? {};
  return game.uesrpg;
}

function ensureChildNamespace(root, key) {
  root[key] = root[key] ?? {};
  return root[key];
}

export function registerInitRuntimeApi({
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
  const root = ensureRootNamespace();
  const rules = ensureChildNamespace(root, "rules");
  const combat = ensureChildNamespace(root, "combat");
  const characteristics = ensureChildNamespace(root, "characteristics");
  const api = ensureChildNamespace(root, "api");

  rules.predicate = {
    isPredicate,
    evaluatePredicate,
    selfTest: selfTestPredicate,
  };
  rules.rollOptions = {
    normalize: normalizeRollOption,
    buildBase: buildBaseRollOptions,
  };
  rules.rollContext = {
    build: buildRollContext,
  };
  rules.conditions = {
    compileToPredicate: compileConditionsToPredicate,
  };
  rules.ruleElements = {
    getSupportMatrix: getRuleElementRuntimeSupport,
    selfTestRuntime: selfTestRuleElementRuntime,
  };

  combat.applyDamage = applyDamage;
  combat.applyDamageResolved = applyDamageResolved;
  combat.DAMAGE_TYPES = DAMAGE_TYPES;
  combat.applyHealing = async (actor, amount, options = {}) => {
    const source = options?.source ?? "Healing";
    return applyHealing(actor, amount, { ...options, source });
  };
  combat.resolveSurpriseState = resolveSurpriseState;
  combat.setActorSurprised = setActorSurprised;
  combat.clearActorSurpriseState = clearActorSurpriseState;
  combat.markSurprisedFirstTurnPassed = markSurprisedFirstTurnPassed;
  combat.getInitiativeTieBreakTuple = getInitiativeTieBreakTuple;
  combat.getSizeToHitModifier = getSizeToHitModifier;
  combat.getActionEligibility = getActionEligibility;
  combat.scanLegacyReadiness = runCombatLegacyReadinessScan;

  characteristics.CharOpposedWorkflow = CharOpposedWorkflow;

  if (tokenActionHudApi) {
    api.tokenActionHud = tokenActionHudApi;
  }

  return root;
}

export function registerReadyRuntimeApi({
  aoe = null,
  luck = null,
  staminaApi = null,
  attackTracker = null,
  magicApi = null,
  combatApi = null,
  conditionsApi = null,
  talentsApi = null,
  modifierRegistry = null,
  dumpAEKeys = null,
  rootApi = null,
} = {}) {
  const root = ensureRootNamespace();

  if (aoe) root.aoe = aoe;
  if (luck) root.luck = luck;
  if (staminaApi && typeof staminaApi === "object") root.stamina = staminaApi;
  if (attackTracker) root.AttackTracker = attackTracker;
  if (modifierRegistry) root.modifierRegistry = modifierRegistry;
  if (typeof dumpAEKeys === "function") root.dumpAEKeys = dumpAEKeys;
  if (rootApi && typeof rootApi === "object") Object.assign(root, rootApi);

  if (magicApi && typeof magicApi === "object") {
    Object.assign(ensureChildNamespace(root, "magic"), magicApi);
  }

  if (combatApi && typeof combatApi === "object") {
    Object.assign(ensureChildNamespace(root, "combat"), combatApi);
  }

  if (conditionsApi && typeof conditionsApi === "object") {
    Object.assign(ensureChildNamespace(root, "conditions"), conditionsApi);
  }

  if (talentsApi && typeof talentsApi === "object") {
    Object.assign(ensureChildNamespace(root, "talents"), talentsApi);
  }

  return root;
}
