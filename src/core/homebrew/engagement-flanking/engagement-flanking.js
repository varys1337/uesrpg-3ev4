import { measureTokenDistance, measureTokenDistanceChebyshev, measureTokenDistanceGridSpaces } from "../../combat/opposed/range.js";
import { getLongestEquippedMeleeWeapon } from "./equipped-weapons.js";
import {
  hasCondition,
  getConditionValue,
  setConditionValue,
  removeCondition,
} from "../../conditions/condition-engine.js";
import {
  isEngagementFlankingHomebrewEnabled,
  isEngagementFlankingOnlyInCombat,
} from "../../system/homebrew.js";
import { isDebugEnabled } from "../../../utils/debug.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../../utils/perf-tracker.js";
import { isWarfareUnitActorType } from "../../actors/types.js";
import { getReachVisualizerSettings } from "../settings.js";
import {
  COMBAT_STYLE_RANK_TO_ENGAGEMENT,
  DEFAULT_UNARMED_REACH,
  DISP_FRIENDLY,
  DISP_HOSTILE,
  DISP_NEUTRAL,
  DISP_SECRET,
  FLAG_HOOKS,
  NAMESPACE,
  SIZE_NUMERIC,
} from "./constants.js";
import {
  consumePendingRefreshContext,
  mergeDirtyPointList as _mergeDirtyPoints,
  mergeIdSet as _mergeIds,
  normalizeEngagementStringId as _normalizeStringId,
  queueRefreshContext as _queueRefreshContextState,
  resetEngagementRefreshContext as _resetPendingRefreshContext,
  snapshotRefreshContext as _snapshotRefreshContext,
} from "./refresh-context.js";

let _debouncedRefresh = null;
const _tokenPositionCache = new Map();
const _flankedTouchedTokenIds = new Set();
let _flankedTouchedSeeded = false;

function _isEFDebugEnabled() {
  return isDebugEnabled("homebrewEngagementFlanking") || isDebugEnabled("effectsProxyDebug");
}

function _isPerfOn() {
  return isPerfEnabled();
}

function _recordPerf(record) {
  if (!_isPerfOn()) return;
  perfRecord(record);
}

function _asFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _isCombatActive() {
  return Boolean(game?.combat?.started);
}

function _isEnabledNow() {
  return isEngagementFlankingHomebrewEnabled();
}

function _getPxPerUnit() {
  const grid = canvas?.grid;
  const size = Number(grid?.size ?? canvas?.scene?.grid?.size);
  const dist = Number(grid?.distance ?? canvas?.scene?.grid?.distance);
  if (!size || !dist) return 1;
  return size / dist;
}

function _reachUsesChebyshev() {
  const settings = getReachVisualizerSettings();
  return String(settings?.gridDiagonalMode ?? "chebyshev") !== "scene";
}

function _getDispositionClass(tokenDoc) {
  if (!tokenDoc) return "none";
  const d = Number(tokenDoc.disposition);
  if (d === DISP_SECRET) return "secret";
  if (d === DISP_HOSTILE) return "hostile";
  if (d === DISP_NEUTRAL) return "neutral";
  if (d === DISP_FRIENDLY) return "friendly";
  return "none";
}

function _isEnemyByDisposition(aDoc, bDoc) {
  if (!aDoc || !bDoc) return false;
  const aClass = _getDispositionClass(aDoc);
  const bClass = _getDispositionClass(bDoc);
  if (aClass === "secret" || bClass === "secret" || aClass === "none" || bClass === "none") return false;
  if (aClass === "hostile") return bClass === "friendly" || bClass === "neutral";
  if (aClass === "friendly" || aClass === "neutral") return bClass === "hostile";
  return false;
}

function _isAllyByDisposition(aDoc, bDoc) {
  if (!aDoc || !bDoc) return false;
  const aClass = _getDispositionClass(aDoc);
  const bClass = _getDispositionClass(bDoc);
  if (aClass === "secret" || bClass === "secret" || aClass === "none" || bClass === "none") return false;
  if (aClass === "hostile") return bClass === "hostile";
  if (aClass === "friendly" || aClass === "neutral") return bClass === "friendly" || bClass === "neutral";
  return false;
}

function _getBestCombatStyleEngagement(actor) {
  if (!actor) return 0;
  let best = 0;
  for (const item of (actor.items ?? [])) {
    if (!item || item.type !== "combatStyle") continue;
    const rankKey = String(item.system?.rank ?? item.system?.level ?? "").toLowerCase().trim();
    const score = Number(COMBAT_STYLE_RANK_TO_ENGAGEMENT[rankKey] ?? 0);
    if (score > best) best = score;
  }
  return best;
}

function _getNpcEngagementScore(actor) {
  try {
    const customES = actor?.flags?.[NAMESPACE]?.homebrew?.maxEngagementScore;
    if (typeof customES === "number" && Number.isFinite(customES) && customES >= 0) {
      return Math.max(0, Math.round(customES));
    }
  } catch (_e) {}
  const sizeStr = String(actor?.system?.size ?? "standard").toLowerCase().trim();
  const sizeNum = SIZE_NUMERIC[sizeStr] ?? 4;
  return Math.max(1, sizeNum - 2);
}

function _getEngagementScore(actor) {
  if (!actor) return 0;
  // Warfare Units don't participate in individual engagement/flanking.
  if (isWarfareUnitActorType(actor?.type)) return 0;
  if (String(actor.type ?? "").trim() === "NPC") return _getNpcEngagementScore(actor);
  return _getBestCombatStyleEngagement(actor);
}

function _getLongestEquippedMeleeReach(actor) {
  const longest = getLongestEquippedMeleeWeapon(actor);
  const bounds = longest?.bounds ?? null;
  if (bounds && Number.isFinite(bounds.max) && bounds.max > 0) {
    return {
      min: Math.max(0, _asFiniteNumber(bounds.min, 0)),
      max: Math.max(0, _asFiniteNumber(bounds.max, 0)),
    };
  }
  return { ...DEFAULT_UNARMED_REACH };
}
function _isActorFlankedPresent(actor) {
  if (!actor) return false;
  if (!hasCondition(actor, "flanked")) return false;
  return Number(getConditionValue(actor, "flanked") ?? 0) > 0;
}

function _trackTokenForFlankedCleanup(tokenId) {
  const id = _normalizeStringId(tokenId);
  if (!id) return;
  _flankedTouchedTokenIds.add(id);
}

function _untrackTokenIfNoFlanked(tokenId, actor) {
  const id = _normalizeStringId(tokenId);
  if (!id) return;
  if (!_isActorFlankedPresent(actor)) _flankedTouchedTokenIds.delete(id);
}

function _seedTouchedFlankedTokensIfNeeded() {
  if (_flankedTouchedSeeded) return;
  _flankedTouchedSeeded = true;
  if (!game.user?.isGM) return;
  for (const token of (canvas?.tokens?.placeables ?? [])) {
    const actor = token?.actor;
    if (!actor?.id) continue;
    if (!_isActorFlankedPresent(actor)) continue;
    _flankedTouchedTokenIds.add(token.id);
  }
}

function _resetTouchedFlankedState() {
  _flankedTouchedTokenIds.clear();
  _flankedTouchedSeeded = false;
}

function _distanceKey(aToken, bToken) {
  const aId = String(aToken?.id ?? "");
  const bId = String(bToken?.id ?? "");
  if (!aId || !bId) return "";
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

function _measureTokenDistanceCached(aToken, bToken, distanceCache, useChebyshev) {
  const key = _distanceKey(aToken, bToken);
  const _measure = () => {
    if (useChebyshev) {
      // Equal-cost diagonals — ignore the scene's diagonal movement rule.
      return measureTokenDistanceChebyshev(aToken, bToken) ?? measureTokenDistance(aToken, bToken);
    }
    // Scene-diagonal mode: use measurePath({ gridSpaces: true }) so 1/2/1 alternating etc. applies.
    return measureTokenDistanceGridSpaces(aToken, bToken) ?? measureTokenDistance(aToken, bToken);
  };
  if (!key) return _measure();
  if (distanceCache.has(key)) return distanceCache.get(key);
  const value = _measure();
  distanceCache.set(key, value);
  return value;
}

function _getEngagementScoreCached(actor, engagementScoreCache) {
  const actorId = _normalizeStringId(actor?.id);
  if (!actorId) return _getEngagementScore(actor);
  if (engagementScoreCache.has(actorId)) return engagementScoreCache.get(actorId);
  const score = _getEngagementScore(actor);
  engagementScoreCache.set(actorId, score);
  return score;
}

function _getLongestEquippedMeleeReachCached(actor, reachCache) {
  const actorId = _normalizeStringId(actor?.id);
  if (!actorId) {
    return { reach: _getLongestEquippedMeleeReach(actor), weaponUuid: null };
  }
  if (reachCache.has(actorId)) return reachCache.get(actorId);

  const longest = getLongestEquippedMeleeWeapon(actor);
  const bounds = longest?.bounds ?? null;
  const reach = (bounds && Number.isFinite(bounds.max) && bounds.max > 0)
    ? {
        min: Math.max(0, _asFiniteNumber(bounds.min, 0)),
        max: Math.max(0, _asFiniteNumber(bounds.max, 0)),
      }
    : { ...DEFAULT_UNARMED_REACH };
  const data = {
    reach,
    weaponUuid: _normalizeStringId(longest?.weapon?.uuid),
  };
  reachCache.set(actorId, data);
  return data;
}

function _isThreatDistance(distance, bounds) {
  const d = _asFiniteNumber(distance, NaN);
  if (!Number.isFinite(d)) return false;
  const min = Math.max(0, _asFiniteNumber(bounds?.min, 0));
  const max = Math.max(0, _asFiniteNumber(bounds?.max, 0));
  if (max <= 0) return false;
  if (d > max) return false;
  if (min > 0 && d < min) return false;
  return true;
}

function _actorTokensOnCanvas() {
  const placeables = canvas?.tokens?.placeables ?? [];
  return placeables.filter((token) => token?.actor && token?.document);
}

function _isDefeatedToken(token) {
  try {
    const c = token?.document?.combatant ?? token?.combatant ?? null;
    return Boolean(c?.isDefeated ?? c?.defeated ?? false);
  } catch (_e) {
    return false;
  }
}

function _getActiveCombatantTokenIdSet() {
  const out = new Set();
  const combat = game?.combat ?? null;
  if (!combat?.started) return out;

  for (const combatant of (combat.combatants ?? [])) {
    if (!combatant) continue;
    if (combatant.tokenId) out.add(String(combatant.tokenId));
  }
  return out;
}

function _collectEvaluableTokens() {
  const tokens = _actorTokensOnCanvas();
  const excludeDefeated = tokens.filter((token) => !_isDefeatedToken(token));

  if (isEngagementFlankingOnlyInCombat() && _isCombatActive()) {
    const combatantTokenIds = _getActiveCombatantTokenIdSet();
    return excludeDefeated.filter((token) => combatantTokenIds.has(String(token.id)));
  }
  return excludeDefeated;
}

function _sortedTokenIds(setLike) {
  return Array.from(setLike ?? []).sort((a, b) => String(a).localeCompare(String(b)));
}

function _drawDebugError(err) {
  try {
    console.warn("UESRPG | Engagement & Flanking refresh failed", err);
  } catch (_e) {}
}

function _computeThreatMaps(tokens, caches) {
  const threatenedBy = new Map();
  const threatens = new Map();

  for (const attacker of tokens) {
    const aId = attacker.id;
    const aBounds = _getLongestEquippedMeleeReachCached(attacker.actor, caches.reachCache).reach;
    const aThreatens = new Set();

    for (const defender of tokens) {
      if (!defender || defender.id === aId) continue;
      if (!_isEnemyByDisposition(attacker.document, defender.document)) continue;

      const distance = _measureTokenDistanceCached(attacker, defender, caches.distanceCache, caches.useChebyshev);
      if (!_isThreatDistance(distance, aBounds)) continue;

      aThreatens.add(defender.id);
      if (!threatenedBy.has(defender.id)) threatenedBy.set(defender.id, new Set());
      threatenedBy.get(defender.id).add(attacker.id);
    }

    threatens.set(aId, aThreatens);
  }

  return { threatenedBy, threatens };
}

function _collectSupportAllies(defender, tokens) {
  const out = [];
  for (const token of tokens) {
    if (!token || token.id === defender.id) continue;
    if (!_isAllyByDisposition(defender.document, token.document)) continue;
    out.push(token);
  }
  return out;
}

function _computeSupportCoverage({ defender, threats, threatens, tokens, caches }) {
  const allies = _collectSupportAllies(defender, tokens);
  if (!allies.length || !threats.size) return 0;

  const allyRows = allies.map((ally) => {
    const allyThreatens = threatens.get(ally.id) ?? new Set();
    const coverable = new Set(Array.from(threats).filter((enemyId) => allyThreatens.has(enemyId)));
    const capacity = Math.max(0, _asFiniteNumber(_getEngagementScoreCached(ally.actor, caches.engagementScoreCache), 0));
    const effectiveCapacity = Math.min(capacity, coverable.size);
    return { ally, effectiveCapacity, coverable };
  }).filter((row) => row.effectiveCapacity > 0 && row.coverable.size > 0);

  if (!allyRows.length) return 0;

  allyRows.sort((a, b) => String(a.ally?.id ?? "").localeCompare(String(b.ally?.id ?? "")));
  const enemyIds = _sortedTokenIds(threats);
  const enemyToSlots = new Map(enemyIds.map((enemyId) => [enemyId, []]));

  for (const row of allyRows) {
    const coverableEnemyIds = _sortedTokenIds(row.coverable);
    const slotIds = [];
    for (let i = 0; i < row.effectiveCapacity; i += 1) slotIds.push(`${row.ally.id}::${i}`);
    for (const enemyId of coverableEnemyIds) {
      const bucket = enemyToSlots.get(enemyId);
      if (!bucket) continue;
      for (const slotId of slotIds) bucket.push(slotId);
    }
  }

  const slotToEnemy = new Map();
  function assignEnemy(enemyId, seenSlots) {
    const slots = enemyToSlots.get(enemyId) ?? [];
    for (const slotId of slots) {
      if (seenSlots.has(slotId)) continue;
      seenSlots.add(slotId);
      const incumbentEnemy = slotToEnemy.get(slotId);
      if (!incumbentEnemy || assignEnemy(incumbentEnemy, seenSlots)) {
        slotToEnemy.set(slotId, enemyId);
        return true;
      }
    }
    return false;
  }

  let matched = 0;
  for (const enemyId of enemyIds) {
    if (assignEnemy(enemyId, new Set())) matched += 1;
  }
  return matched;
}
function _tokenCenterPx(tokenLike) {
  if (tokenLike?.center?.x != null && tokenLike?.center?.y != null) {
    return { x: Number(tokenLike.center.x), y: Number(tokenLike.center.y) };
  }
  const doc = tokenLike?.document ?? tokenLike;
  const x = Number(doc?.x ?? NaN);
  const y = Number(doc?.y ?? NaN);
  const width = Number(doc?.width ?? 1);
  const height = Number(doc?.height ?? 1);
  const gridSize = Number(canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: x + ((Number.isFinite(width) ? width : 1) * gridSize) / 2,
    y: y + ((Number.isFinite(height) ? height : 1) * gridSize) / 2,
  };
}

function _bucketKey(ix, iy) {
  return `${ix}:${iy}`;
}

function _buildSpatialIndex(tokens, caches) {
  const tokenById = new Map();
  const buckets = new Map();
  let globalMaxReach = 1;

  for (const token of tokens) {
    if (!token?.id) continue;
    tokenById.set(String(token.id), token);
    const reach = _getLongestEquippedMeleeReachCached(token.actor, caches.reachCache).reach;
    globalMaxReach = Math.max(globalMaxReach, Math.max(1, Number(reach?.max ?? 1) || 1));
  }

  const cellSizeUnits = Math.max(1, Math.ceil(globalMaxReach) + 1);
  const cellSizePx = Math.max(1, cellSizeUnits * _getPxPerUnit());

  for (const token of tokens) {
    const center = _tokenCenterPx(token);
    if (!center) continue;
    const ix = Math.floor(center.x / cellSizePx);
    const iy = Math.floor(center.y / cellSizePx);
    const key = _bucketKey(ix, iy);
    const bucket = buckets.get(key) ?? [];
    bucket.push(token);
    buckets.set(key, bucket);
  }

  return { tokenById, buckets, globalMaxReach, cellSizePx };
}

function _querySpatialIndex(index, center, radiusUnits) {
  const out = new Map();
  if (!index || !center) return out;
  const radiusPx = Math.max(0, Number(radiusUnits ?? 0) || 0) * _getPxPerUnit();
  const cellRadius = Math.max(0, Math.ceil(radiusPx / Math.max(1, index.cellSizePx)));
  const ix = Math.floor(center.x / index.cellSizePx);
  const iy = Math.floor(center.y / index.cellSizePx);

  for (let dx = -cellRadius; dx <= cellRadius; dx += 1) {
    for (let dy = -cellRadius; dy <= cellRadius; dy += 1) {
      const bucket = index.buckets.get(_bucketKey(ix + dx, iy + dy));
      if (!bucket) continue;
      for (const token of bucket) out.set(String(token.id), token);
    }
  }
  return out;
}

function _actorSceneTokenIds(actorId, tokens) {
  const out = new Set();
  const wanted = _normalizeStringId(actorId);
  if (!wanted) return out;
  for (const token of tokens) {
    if (_normalizeStringId(token?.actor?.id) === wanted) out.add(String(token.id));
  }
  return out;
}

function _resolveDirtyCenters(context, tokens, index) {
  const points = [];
  _mergeDirtyPoints(points, context?.dirtyPoints ?? []);

  for (const tokenId of (context?.dirtyTokenIds ?? [])) {
    const token = index.tokenById.get(String(tokenId)) ?? null;
    const center = token ? _tokenCenterPx(token) : null;
    if (center) points.push(center);
  }

  for (const actorId of (context?.dirtyActorIds ?? [])) {
    const actorTokenIds = _actorSceneTokenIds(actorId, tokens);
    for (const tokenId of actorTokenIds) {
      const token = index.tokenById.get(String(tokenId)) ?? null;
      const center = token ? _tokenCenterPx(token) : null;
      if (center) points.push(center);
    }
  }

  return points;
}

function _collectAffectedDefenderIds(tokens, index, context) {
  if (context.fullScene) return new Set(tokens.map((token) => String(token.id)));

  const affected = new Set();
  _mergeIds(affected, context.dirtyTokenIds);
  for (const actorId of context.dirtyActorIds) _mergeIds(affected, _actorSceneTokenIds(actorId, tokens));

  const influenceRadius = Math.max(1, (index.globalMaxReach * 2) + 1);
  const dirtyCenters = _resolveDirtyCenters(context, tokens, index);
  if (!dirtyCenters.length && !affected.size) {
    return new Set(tokens.map((token) => String(token.id)));
  }

  for (const point of dirtyCenters) {
    const nearby = _querySpatialIndex(index, point, influenceRadius);
    _mergeIds(affected, nearby.keys());
    for (const touchedId of _flankedTouchedTokenIds) {
      const touchedToken = index.tokenById.get(String(touchedId)) ?? null;
      if (!touchedToken) continue;
      const touchedCenter = _tokenCenterPx(touchedToken);
      if (!touchedCenter) continue;
      const dx = touchedCenter.x - point.x;
      const dy = touchedCenter.y - point.y;
      if (Math.hypot(dx, dy) <= (influenceRadius * _getPxPerUnit())) affected.add(String(touchedId));
    }
  }

  return affected;
}

function _collectLocalTokensForDefender(defender, index) {
  const center = _tokenCenterPx(defender);
  const radiusUnits = Math.max(1, (index.globalMaxReach * 2) + 1);
  return Array.from(_querySpatialIndex(index, center, radiusUnits).values());
}

function _computeFlankedForDefender(defender, index, caches) {
  const localTokens = _collectLocalTokensForDefender(defender, index);
  const { threatenedBy, threatens } = _computeThreatMaps(localTokens, caches);
  const threats = threatenedBy.get(defender.id) ?? new Set();
  const score = _getEngagementScoreCached(defender.actor, caches.engagementScoreCache);
  const allySupport = _computeSupportCoverage({
    defender,
    threats,
    threatens,
    tokens: localTokens,
    caches,
  });

  return {
    next: Math.max(0, threats.size - score - allySupport),
    diagnostics: {
      tokenId: defender.id,
      actorId: defender.actor?.id ?? null,
      threats: threats.size,
      score,
      allySupport,
    },
    candidateTokenIds: localTokens.map((token) => String(token.id)),
  };
}

export async function clearFlankedConditions({ activeSceneOnly = false } = {}) {
  if (!game.user?.isGM) return;

  const seen = new Set();
  const actors = [];

  for (const token of (canvas?.tokens?.placeables ?? [])) {
    const actor = token?.actor;
    if (!actor?.id) continue;
    const key = `${token.id}::${actor.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actors.push(actor);
  }

  if (!activeSceneOnly) {
    for (const actor of (game.actors ?? [])) {
      if (!actor?.id) continue;
      const key = `world::${actor.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      actors.push(actor);
    }
  }

  for (const actor of actors) {
    if (!actor) continue;
    if (!hasCondition(actor, "flanked")) continue;
    await removeCondition(actor, "flanked");
  }

  _resetTouchedFlankedState();
}

async function _syncTokenFlankedValue(tokenId, actor, next, { diagnostics = null } = {}) {
  const current = Number(getConditionValue(actor, "flanked") ?? 0);
  if (next === current) {
    if (next > 0) _trackTokenForFlankedCleanup(tokenId);
    else _untrackTokenIfNoFlanked(tokenId, actor);
    return false;
  }

  await setConditionValue(actor, "flanked", next);
  const readback = Number(getConditionValue(actor, "flanked") ?? 0);
  if (readback > 0) _trackTokenForFlankedCleanup(tokenId);
  else _untrackTokenIfNoFlanked(tokenId, actor);

  if (_isEFDebugEnabled()) {
    console.log("UESRPG | Engagement & Flanking | token write", {
      tokenId,
      actor: actor?.name ?? null,
      actorId: actor?.id ?? null,
      requested: next,
      readback,
      threats: diagnostics?.threats ?? null,
      score: diagnostics?.score ?? null,
      allySupport: diagnostics?.allySupport ?? null,
    });
  }
  return true;
}

async function _clearStaleTouchedTokenFlankedConditions(affectedTokenIds, computedByTokenId) {
  for (const tokenId of Array.from(_flankedTouchedTokenIds)) {
    if (affectedTokenIds && affectedTokenIds.size && !affectedTokenIds.has(String(tokenId))) continue;

    const token = canvas?.tokens?.get?.(tokenId) ?? null;
    if (!token) {
      _flankedTouchedTokenIds.delete(tokenId);
      continue;
    }
    const actor = token.actor;
    if (!actor) {
      _flankedTouchedTokenIds.delete(tokenId);
      continue;
    }
    const next = Number(computedByTokenId.get(tokenId) ?? 0);
    if (next > 0) continue;
    if (!hasCondition(actor, "flanked")) {
      _flankedTouchedTokenIds.delete(tokenId);
      continue;
    }
    await removeCondition(actor, "flanked");
    _untrackTokenIfNoFlanked(tokenId, actor);
  }
}
export async function refreshEngagementFlanking(options = {}) {
  if (!game.user?.isGM) return;

  const context = _snapshotRefreshContext(options);
  const _perf = _isPerfOn();
  const _t0 = _perf ? monoMs() : 0;

  if (!_isEnabledNow()) {
    await clearFlankedConditions();
    _resetTouchedFlankedState();
    return;
  }

  if (isEngagementFlankingOnlyInCombat() && !_isCombatActive()) {
    await clearFlankedConditions({ activeSceneOnly: true });
    return;
  }

  if (!canvas?.ready) return;
  _seedTouchedFlankedTokensIfNeeded();

  const caches = {
    distanceCache: new Map(),
    engagementScoreCache: new Map(),
    reachCache: new Map(),
    // Computed once per refresh so repeated settings reads are avoided during the hot loop.
    useChebyshev: _reachUsesChebyshev(),
  };
  const tokens = _collectEvaluableTokens();
  const index = _buildSpatialIndex(tokens, caches);
  const affectedTokenIds = _collectAffectedDefenderIds(tokens, index, context);
  const computedByTokenId = new Map();
  const candidateTokenIds = new Set();
  let writeCount = 0;

  if (_isEFDebugEnabled()) {
    console.log("UESRPG | Engagement & Flanking | refresh start", {
      tokenCount: tokens.length,
      fullScene: context.fullScene,
      reasons: Array.from(context.reasons),
      dirtyTokenIds: Array.from(context.dirtyTokenIds),
      dirtyActorIds: Array.from(context.dirtyActorIds),
      dirtyPointCount: context.dirtyPoints.length,
    });
  }

  for (const tokenId of affectedTokenIds) {
    const token = index.tokenById.get(String(tokenId)) ?? null;
    const actor = token?.actor ?? null;
    if (!token || !actor) continue;

    const result = _computeFlankedForDefender(token, index, caches);
    computedByTokenId.set(String(token.id), Number(result.next ?? 0));
    for (const candidateId of result.candidateTokenIds) candidateTokenIds.add(String(candidateId));

    const diagnostics = result.diagnostics ?? null;
    if (_isEFDebugEnabled()) {
      console.log("UESRPG | Engagement & Flanking | token eval", {
        tokenId: token.id,
        actor: actor?.name ?? null,
        actorId: actor?.id ?? null,
        current: Number(getConditionValue(actor, "flanked") ?? 0),
        next: result.next,
        threats: diagnostics?.threats ?? null,
        score: diagnostics?.score ?? null,
        allySupport: diagnostics?.allySupport ?? null,
      });
    }

    const wrote = await _syncTokenFlankedValue(token.id, actor, result.next, { diagnostics });
    if (wrote) writeCount += 1;
  }

  await _clearStaleTouchedTokenFlankedConditions(affectedTokenIds, computedByTokenId);

  _recordPerf({
    event: "engagementFlanking.refresh",
    reason: Array.from(context.reasons).join(","),
    fullScene: context.fullScene,
    dirtyTokenCount: context.dirtyTokenIds.size,
    dirtyActorCount: context.dirtyActorIds.size,
    dirtyPointCount: context.dirtyPoints.length,
    affectedTokenCount: affectedTokenIds.size,
    candidateTokenCount: candidateTokenIds.size,
    writeCount,
    durationMs: _perf ? (monoMs() - _t0) : null,
  });
}

export function scheduleEngagementFlankingRefresh(options = {}) {
  _queueRefreshContextState(options);
  if (!_debouncedRefresh) {
    const debounce = foundry?.utils?.debounce;
    _debouncedRefresh = (typeof debounce === "function")
      ? debounce(() => {
          const context = consumePendingRefreshContext();
          void refreshEngagementFlanking(context).catch(_drawDebugError);
        }, 80)
      : (() => {
          const context = consumePendingRefreshContext();
          void refreshEngagementFlanking(context).catch(_drawDebugError);
        });
  }
  _debouncedRefresh();
}

function _actorTokenIdsFromParent(parent) {
  const actorId = _normalizeStringId(parent?.id);
  if (!actorId) return [];
  return _actorTokensOnCanvas()
    .filter((token) => _normalizeStringId(token?.actor?.id) === actorId)
    .map((token) => String(token.id));
}

function _tokenCenterFromDoc(doc) {
  return _tokenCenterPx(doc);
}

function _shouldRefreshForItem(item, changed) {
  if (!item?.parent || item.parent.documentName !== "Actor") return false;
  if (![
    "weapon",
    "skill",
    "combatStyle",
  ].includes(String(item.type ?? "").toLowerCase())) return false;
  if (!changed || typeof changed !== "object" || !Object.keys(changed).length) return true;

  if (item.type === "weapon") {
    if (foundry.utils.hasProperty(changed, "system.equipped")) return true;
    if (foundry.utils.hasProperty(changed, "system.attackMode")) return true;
    if (foundry.utils.hasProperty(changed, "system.reach")) return true;
    if (foundry.utils.hasProperty(changed, "system.reachMin")) return true;
    if (foundry.utils.hasProperty(changed, `flags.${NAMESPACE}.homebrew.reachLength`)) return true;
    return false;
  }

  if (item.type === "skill") {
    const isEvade = String(item.name ?? "").trim().toLowerCase() === "evade";
    if (!isEvade) return false;
    if (foundry.utils.hasProperty(changed, "system.rank")) return true;
    if (foundry.utils.hasProperty(changed, "system.level")) return true;
    return false;
  }

  if (item.type === "combatStyle") {
    if (foundry.utils.hasProperty(changed, "system.rank")) return true;
    if (foundry.utils.hasProperty(changed, "system.level")) return true;
    return false;
  }

  return false;
}

function _shouldRefreshForToken(changed) {
  if (!changed || typeof changed !== "object") return false;
  if ("x" in changed || "y" in changed) return true;
  if ("disposition" in changed) return true;
  if ("elevation" in changed) return true;
  return false;
}

function _queueActorRefresh(actorOrParent, reason) {
  const tokenIds = _actorTokenIdsFromParent(actorOrParent);
  if (!tokenIds.length) return;
  scheduleEngagementFlankingRefresh({ reason, dirtyTokenIds: tokenIds });
}

export function registerEngagementFlanking() {
  game.uesrpg = game.uesrpg ?? {};
  if (game.uesrpg[FLAG_HOOKS]) return;
  game.uesrpg[FLAG_HOOKS] = true;

  Hooks.on("canvasReady", () => {
    scheduleEngagementFlankingRefresh({ reason: "canvasReady", fullScene: true });
  });

  Hooks.on("canvasTearDown", () => {
    _tokenPositionCache.clear();
    _resetPendingRefreshContext();
    _resetTouchedFlankedState();
  });

  Hooks.on("updateToken", (tokenDoc, changed) => {
    if (!_isEnabledNow()) return;
    if (!_shouldRefreshForToken(changed)) return;
    scheduleEngagementFlankingRefresh({ reason: "updateToken", dirtyTokenIds: [tokenDoc?.id] });
  });

  Hooks.on("refreshToken", (token) => {
    if (!_isEnabledNow()) return;
    const id = _normalizeStringId(token?.id ?? token?.document?.id);
    if (!id) return;
    const x = token?.document?.x;
    const y = token?.document?.y;
    if (x == null || y == null) return;
    const last = _tokenPositionCache.get(id);
    if (!last || last.x !== x || last.y !== y) {
      _tokenPositionCache.set(id, { x, y });
      scheduleEngagementFlankingRefresh({ reason: "refreshToken", dirtyTokenIds: [id] });
    }
  });
  Hooks.on("createToken", (tokenDoc) => {
    if (!_isEnabledNow()) return;
    const id = _normalizeStringId(tokenDoc?.id ?? tokenDoc?._id);
    if (id) {
      const x = _asFiniteNumber(tokenDoc?.x, NaN);
      const y = _asFiniteNumber(tokenDoc?.y, NaN);
      if (Number.isFinite(x) && Number.isFinite(y)) _tokenPositionCache.set(id, { x, y });
    }
    scheduleEngagementFlankingRefresh({
      reason: "createToken",
      dirtyTokenIds: id ? [id] : [],
      dirtyPoints: [_tokenCenterFromDoc(tokenDoc)].filter(Boolean),
    });
  });

  Hooks.on("deleteToken", (tokenDoc) => {
    if (!_isEnabledNow()) return;
    const id = _normalizeStringId(tokenDoc?.id ?? tokenDoc?._id);
    if (id) _tokenPositionCache.delete(id);
    scheduleEngagementFlankingRefresh({
      reason: "deleteToken",
      dirtyPoints: [_tokenCenterFromDoc(tokenDoc)].filter(Boolean),
    });
  });

  Hooks.on("updateItem", (item, changed) => {
    if (!_isEnabledNow()) return;
    if (!_shouldRefreshForItem(item, changed)) return;
    _queueActorRefresh(item.parent, "updateItem");
  });

  Hooks.on("createItem", (item) => {
    if (!_isEnabledNow()) return;
    if (!item?.parent || item.parent.documentName !== "Actor") return;
    if (!["weapon", "combatStyle", "skill"].includes(String(item.type ?? ""))) return;
    _queueActorRefresh(item.parent, "createItem");
  });

  Hooks.on("deleteItem", (item) => {
    if (!_isEnabledNow()) return;
    if (!item?.parent || item.parent.documentName !== "Actor") return;
    if (!["weapon", "combatStyle", "skill"].includes(String(item.type ?? ""))) return;
    _queueActorRefresh(item.parent, "deleteItem");
  });

  Hooks.on("updateCombat", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh({ reason: "updateCombat", fullScene: true });
  });

  Hooks.on("createCombat", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh({ reason: "createCombat", fullScene: true });
  });

  Hooks.on("deleteCombat", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh({ reason: "deleteCombat", fullScene: true });
  });

  Hooks.on("updateCombatant", (combatant) => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh({
      reason: "updateCombatant",
      dirtyTokenIds: [combatant?.tokenId].filter(Boolean),
    });
  });

  Hooks.on("createCombatant", (combatant) => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh({
      reason: "createCombatant",
      dirtyTokenIds: [combatant?.tokenId].filter(Boolean),
    });
  });

  Hooks.on("deleteCombatant", (combatant) => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh({
      reason: "deleteCombatant",
      dirtyTokenIds: [combatant?.tokenId].filter(Boolean),
    });
  });

  Hooks.on("updateActor", (actor, changed) => {
    if (!_isEnabledNow()) return;
    if (foundry.utils.hasProperty(changed, `flags.${NAMESPACE}.homebrew.maxEngagementScore`)) {
      _queueActorRefresh(actor, "updateActor.engagementScore");
    }
  });
}

export function getEngagementReachBounds(actor) {
  return _getLongestEquippedMeleeReach(actor);
}

export function getEngagementScore(actor) {
  return _getEngagementScore(actor);
}
