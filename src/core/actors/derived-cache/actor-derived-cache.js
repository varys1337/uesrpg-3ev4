const ALL_LANES = Object.freeze(["items", "ae", "prepare"]);

function _ensureState(actor) {
  if (!actor) return null;
  if (!actor._uesrpgDerivedCache) {
    actor._uesrpgDerivedCache = {
      itemAggregation: null,
      aeApplicable: null,
      aeTotals: null,
      prepareContext: null,
    };
  }
  return actor._uesrpgDerivedCache;
}

export function getCachedItemAggregation(actor, combatState) {
  const state = _ensureState(actor);
  const cached = state?.itemAggregation;
  if (cached?.agg && cached.combatState === combatState) return cached.agg;
  const legacy = actor?._aggCache;
  if (legacy?.agg && legacy.combatState === combatState) {
    if (state) state.itemAggregation = legacy;
    return legacy.agg;
  }
  return null;
}

export function setCachedItemAggregation(actor, agg, combatState) {
  const state = _ensureState(actor);
  const value = { agg, combatState };
  if (state) state.itemAggregation = value;
  if (actor) actor._aggCache = value;
  return agg;
}

export function getCachedApplicableEffects(actor) {
  const state = _ensureState(actor);
  if (state?.aeApplicable?.effects) return state.aeApplicable.effects;
  if (actor?._aeApplicableCache?.effects) {
    if (state) state.aeApplicable = actor._aeApplicableCache;
    return actor._aeApplicableCache.effects;
  }
  return null;
}

export function setCachedApplicableEffects(actor, effects) {
  const state = _ensureState(actor);
  const value = { effects };
  if (state) state.aeApplicable = value;
  if (actor) actor._aeApplicableCache = value;
  return effects;
}

export function getCachedAETotals(actor) {
  const state = _ensureState(actor);
  if (state?.aeTotals) return state.aeTotals;
  if (actor?._aeTotalsMap) {
    if (state) state.aeTotals = actor._aeTotalsMap;
    return actor._aeTotalsMap;
  }
  return null;
}

export function setCachedAETotals(actor, map) {
  const state = _ensureState(actor);
  if (state) state.aeTotals = map;
  if (actor) actor._aeTotalsMap = map;
  return map;
}

export function getCachedPrepareContext(actor) {
  const state = _ensureState(actor);
  if (state?.prepareContext) return state.prepareContext;
  if (actor?._uesrpgPrepareCtx) {
    if (state) state.prepareContext = actor._uesrpgPrepareCtx;
    return actor._uesrpgPrepareCtx;
  }
  return null;
}

export function setCachedPrepareContext(actor, context) {
  const state = _ensureState(actor);
  if (state) state.prepareContext = context;
  if (actor) actor._uesrpgPrepareCtx = context;
  return context;
}

export function invalidateActorDerivedCache(actor, { lanes = ALL_LANES } = {}) {
  if (!actor || actor.documentName !== "Actor") return;
  const laneSet = new Set(Array.isArray(lanes) && lanes.length ? lanes : ALL_LANES);
  const state = _ensureState(actor);

  if (laneSet.has("items")) {
    if (state) state.itemAggregation = null;
    actor._aggCache = null;
  }
  if (laneSet.has("ae")) {
    if (state) {
      state.aeApplicable = null;
      state.aeTotals = null;
    }
    actor._aeApplicableCache = null;
    actor._aeTotalsMap = null;
  }
  if (laneSet.has("prepare")) {
    if (state) state.prepareContext = null;
    actor._uesrpgPrepareCtx = null;
  }
}
