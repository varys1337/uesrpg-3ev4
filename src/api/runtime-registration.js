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
  automationPolicyApi = null,
  tokenActionHudApi,
  applicationApi = null,
  alchemyApi = null,
  travelApi = null,
  fearApi = null,
  woundsApi = null,
  timeApi = null,
  reachVisualizerApi = null,
  armorCoverageOverlayApi = null,
  conditionsApi = null,
} = {}) {
  const root = ensureRootNamespace();
  const rules = ensureChildNamespace(root, "rules");
  const combat = ensureChildNamespace(root, "combat");
  const characteristics = ensureChildNamespace(root, "characteristics");
  const api = ensureChildNamespace(root, "api");

  if (isPredicate || evaluatePredicate || selfTestPredicate) {
    rules.predicate = {
      isPredicate,
      evaluatePredicate,
      selfTest: selfTestPredicate,
    };
  }
  if (normalizeRollOption || buildBaseRollOptions) {
    rules.rollOptions = {
      normalize: normalizeRollOption,
      buildBase: buildBaseRollOptions,
    };
  }
  if (buildRollContext) {
    rules.rollContext = {
      build: buildRollContext,
    };
  }
  if (compileConditionsToPredicate) {
    rules.conditions = {
      compileToPredicate: compileConditionsToPredicate,
    };
  }

  if (applyDamage) combat.applyDamage = applyDamage;
  if (applyDamageResolved) combat.applyDamageResolved = applyDamageResolved;
  if (DAMAGE_TYPES) combat.DAMAGE_TYPES = DAMAGE_TYPES;
  if (applyHealing) {
    combat.applyHealing = async (actor, amount, options = {}) => {
      const source = options?.source ?? "Healing";
      return applyHealing(actor, amount, { ...options, source });
    };
  }
  if (resolveSurpriseState) combat.resolveSurpriseState = resolveSurpriseState;
  if (setActorSurprised) combat.setActorSurprised = setActorSurprised;
  if (clearActorSurpriseState) combat.clearActorSurpriseState = clearActorSurpriseState;
  if (markSurprisedFirstTurnPassed) combat.markSurprisedFirstTurnPassed = markSurprisedFirstTurnPassed;
  if (getInitiativeTieBreakTuple) combat.getInitiativeTieBreakTuple = getInitiativeTieBreakTuple;
  if (getSizeToHitModifier) combat.getSizeToHitModifier = getSizeToHitModifier;
  if (getActionEligibility) combat.getActionEligibility = getActionEligibility;
  if (runCombatLegacyReadinessScan) combat.scanLegacyReadiness = runCombatLegacyReadinessScan;
  if (automationPolicyApi && typeof automationPolicyApi === "object") {
    combat.automationPolicy = automationPolicyApi;
  }

  if (CharOpposedWorkflow) characteristics.CharOpposedWorkflow = CharOpposedWorkflow;

  if (tokenActionHudApi) {
    api.tokenActionHud = tokenActionHudApi;
  }

  if (applicationApi && typeof applicationApi === "object") {
    Object.assign(ensureChildNamespace(root, "application"), applicationApi);
  }

  if (alchemyApi && typeof alchemyApi === "object") root.alchemy = alchemyApi;
  if (travelApi && typeof travelApi === "object") root.travel = travelApi;
  if (fearApi && typeof fearApi === "object") root.fear = fearApi;
  if (woundsApi && typeof woundsApi === "object") root.wounds = woundsApi;
  if (timeApi && typeof timeApi === "object") root.time = timeApi;
  if (reachVisualizerApi && typeof reachVisualizerApi === "object") root.reachVisualizer = reachVisualizerApi;
  if (armorCoverageOverlayApi && typeof armorCoverageOverlayApi === "object") root.armorCoverageOverlay = armorCoverageOverlayApi;
  if (conditionsApi && typeof conditionsApi === "object") {
    Object.assign(ensureChildNamespace(root, "conditions"), conditionsApi);
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
  applicationApi = null,
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

  if (applicationApi && typeof applicationApi === "object") {
    Object.assign(ensureChildNamespace(root, "application"), applicationApi);
  }

  return root;
}
