import { measureTokenDistance } from "../../combat/opposed/range.js";
import { getLongestEquippedMeleeWeapon } from "../../../ui/canvas/reach-visualizer-weapons.js";
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

const NAMESPACE = "uesrpg-3ev4";
const FLAG_HOOKS = "_engagementFlankingHooks";
const DEFAULT_UNARMED_REACH = Object.freeze({ min: 0, max: 1 });
const DISP_HOSTILE = Number(CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1);
const DISP_NEUTRAL = Number(CONST?.TOKEN_DISPOSITIONS?.NEUTRAL ?? 0);
const DISP_FRIENDLY = Number(CONST?.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1);
const DISP_SECRET = Number(CONST?.TOKEN_DISPOSITIONS?.SECRET ?? -2);
const COMBAT_STYLE_RANK_TO_NUMBER = Object.freeze({
  untrained: 0,
  novice: 0,
  apprentice: 1,
  journeyman: 2,
  adept: 3,
  expert: 4,
  master: 5,
});

// Numeric size categories for NPC Engagement Score: max(1, Size − 2)
const SIZE_NUMERIC = Object.freeze({
  puny: 1,
  tiny: 2,
  small: 3,
  standard: 4,
  large: 5,
  huge: 6,
  enormous: 7,
});

let _debouncedRefresh = null;
const _tokenPositionCache = new Map(); // tokenId → {x: number, y: number}

function _isEFDebugEnabled() {
  return isDebugEnabled("effectsProxyDebug");
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

  // Locked behavior:
  // - Hostile is enemy to Friendly and Neutral
  // - Friendly/Neutral are enemy to Hostile
  if (aClass === "hostile") return bClass === "friendly" || bClass === "neutral";
  if (aClass === "friendly" || aClass === "neutral") return bClass === "hostile";
  return false;
}

function _isAllyByDisposition(aDoc, bDoc) {
  if (!aDoc || !bDoc) return false;
  const aClass = _getDispositionClass(aDoc);
  const bClass = _getDispositionClass(bDoc);
  if (aClass === "secret" || bClass === "secret" || aClass === "none" || bClass === "none") return false;

  // Locked behavior:
  // - Hostile allies with Hostile only
  // - Friendly allies with Friendly + Neutral
  // - Neutral allies with Friendly + Neutral
  if (aClass === "hostile") return bClass === "hostile";
  if (aClass === "friendly" || aClass === "neutral") return bClass === "friendly" || bClass === "neutral";
  return false;
}

function _getBestCombatStyleRank(actor) {
  if (!actor) return 0;
  let best = 0;
  for (const item of (actor.items ?? [])) {
    if (!item || item.type !== "combatStyle") continue;
    const rankKey = String(item.system?.rank ?? item.system?.level ?? "").toLowerCase().trim();
    const rank = Number(COMBAT_STYLE_RANK_TO_NUMBER[rankKey] ?? 0);
    if (rank > best) best = rank;
  }
  return best;
}

function _getNpcEngagementScore(actor) {
  try {
    const customES = actor?.flags?.["uesrpg-3ev4"]?.homebrew?.maxEngagementScore;
    if (typeof customES === "number" && Number.isFinite(customES) && customES >= 0) {
      return Math.max(0, Math.round(customES));
    }
  } catch (_e) {}
  const sizeStr = String(actor?.system?.size ?? "standard").toLowerCase().trim();
  const sizeNum = SIZE_NUMERIC[sizeStr] ?? 4; // default: standard
  return Math.max(1, sizeNum - 2);
}

function _getEngagementScore(actor) {
  if (!actor) return 0;
  if (String(actor.type ?? "").trim() === "NPC") return _getNpcEngagementScore(actor);
  // Player Character (and Group fallback): ceil(best CS rank / 2)
  const styleRank = _getBestCombatStyleRank(actor);
  return Math.ceil(styleRank / 2);
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
  return placeables.filter(t => t?.actor && t?.document);
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
  const excludeDefeated = tokens.filter(t => !_isDefeatedToken(t));

  if (isEngagementFlankingOnlyInCombat() && _isCombatActive()) {
    const combatantTokenIds = _getActiveCombatantTokenIdSet();
    return excludeDefeated.filter(t => combatantTokenIds.has(String(t.id)));
  }
  return excludeDefeated;
}

function _allSceneActors() {
  const out = new Map();
  for (const token of _actorTokensOnCanvas()) {
    const actor = token?.actor;
    if (!actor?.id) continue;
    out.set(actor.id, actor);
  }
  return out;
}

function _tokenSortKey(token) {
  return String(token?.id ?? token?.document?.id ?? "");
}

function _sortedTokenIds(setLike) {
  return Array.from(setLike ?? []).sort((a, b) => String(a).localeCompare(String(b)));
}

function _drawDebugError(err) {
  try {
    console.warn("UESRPG | Engagement & Flanking refresh failed", err);
  } catch (_e) {
    // no-op
  }
}

function _computeThreatMaps(tokens) {
  const threatenedBy = new Map();
  const threatens = new Map();

  for (const attacker of tokens) {
    const aId = attacker.id;
    const aBounds = _getLongestEquippedMeleeReach(attacker.actor);
    const aThreatens = new Set();

    for (const defender of tokens) {
      if (!defender || defender.id === aId) continue;
      if (!_isEnemyByDisposition(attacker.document, defender.document)) continue;

      const distance = measureTokenDistance(attacker, defender);
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

function _computeSupportCoverage({ defender, threats, threatens, tokens }) {
  const allies = _collectSupportAllies(defender, tokens);
  if (!allies.length || !threats.size) return 0;

  const allyRows = allies.map((ally) => {
    const allyThreatens = threatens.get(ally.id) ?? new Set();
    const coverable = new Set(Array.from(threats).filter(enemyId => allyThreatens.has(enemyId)));
    const capacity = Math.max(0, _asFiniteNumber(_getEngagementScore(ally.actor), 0));
    const effectiveCapacity = Math.min(capacity, coverable.size);
    return {
      ally,
      effectiveCapacity,
      coverable,
    };
  }).filter(row => row.effectiveCapacity > 0 && row.coverable.size > 0);

  if (!allyRows.length) return 0;

  allyRows.sort((a, b) => _tokenSortKey(a.ally).localeCompare(_tokenSortKey(b.ally)));

  const enemyIds = _sortedTokenIds(threats);
  const enemyToSlots = new Map(enemyIds.map(enemyId => [enemyId, []]));

  for (const row of allyRows) {
    const coverableEnemyIds = _sortedTokenIds(row.coverable);
    const slotIds = [];
    for (let i = 0; i < row.effectiveCapacity; i += 1) {
      slotIds.push(`${row.ally.id}::${i}`);
    }

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

function _computeFlankedByActor(tokens) {
  const { threatenedBy, threatens } = _computeThreatMaps(tokens);
  const perToken = new Map();
  const perTokenDiagnostics = new Map();

  for (const defender of tokens) {
    const threats = threatenedBy.get(defender.id) ?? new Set();
    const score = _getEngagementScore(defender.actor);
    const allySupport = _computeSupportCoverage({
      defender,
      threats,
      threatens,
      tokens,
    });

    const x = Math.max(0, threats.size - score - allySupport);
    perToken.set(defender.id, x);
    perTokenDiagnostics.set(defender.id, {
      tokenId: defender.id,
      actorId: defender.actor?.id ?? null,
      threats: threats.size,
      score,
      allySupport,
      flanked: x,
    });
  }

  const byActorId = new Map();
  const byActorDiagnostics = new Map();
  for (const token of tokens) {
    const actor = token?.actor;
    if (!actor?.id) continue;
    const x = Number(perToken.get(token.id) ?? 0);
    const prev = Number(byActorId.get(actor.id) ?? 0);
    if (x > prev) {
      byActorId.set(actor.id, x);
      byActorDiagnostics.set(actor.id, perTokenDiagnostics.get(token.id) ?? null);
    }
  }

  return { byActorId, byActorDiagnostics };
}

function _sceneActors(tokens) {
  const out = new Map();
  for (const t of tokens) {
    const actor = t?.actor;
    if (!actor?.id) continue;
    out.set(actor.id, actor);
  }
  return out;
}

export async function clearFlankedConditions({ activeSceneOnly = false } = {}) {
  if (!game.user?.isGM) return;

  const actors = [];
  if (activeSceneOnly) {
    for (const actor of _allSceneActors().values()) actors.push(actor);
  } else {
    for (const actor of (game.actors ?? [])) actors.push(actor);
  }

  for (const actor of actors) {
    if (!actor) continue;
    if (!hasCondition(actor, "flanked")) continue;
    await removeCondition(actor, "flanked");
  }
}

export async function refreshEngagementFlanking() {
  if (!game.user?.isGM) return;

  if (!_isEnabledNow()) {
    await clearFlankedConditions();
    return;
  }

  if (isEngagementFlankingOnlyInCombat() && !_isCombatActive()) {
    await clearFlankedConditions({ activeSceneOnly: true });
    return;
  }

  if (!canvas?.ready) return;
  const tokens = _collectEvaluableTokens();
  const { byActorId, byActorDiagnostics } = _computeFlankedByActor(tokens);
  const sceneActorMap = _sceneActors(tokens);

  if (_isEFDebugEnabled()) {
    console.log("UESRPG | Engagement & Flanking | refresh start", {
      tokenCount: tokens.length,
      actorCount: sceneActorMap.size,
      homebrewEnabled: _isEnabledNow(),
      onlyInCombat: isEngagementFlankingOnlyInCombat(),
      combatActive: _isCombatActive(),
    });
  }

  for (const actor of sceneActorMap.values()) {
    const next = Number(byActorId.get(actor.id) ?? 0);
    const current = Number(getConditionValue(actor, "flanked") ?? 0);
    const diag = byActorDiagnostics.get(actor.id) ?? null;
    if (_isEFDebugEnabled()) {
      console.log("UESRPG | Engagement & Flanking | actor eval", {
        actor: actor?.name ?? null,
        actorId: actor?.id ?? null,
        current,
        next,
        threats: diag?.threats ?? null,
        score: diag?.score ?? null,
        allySupport: diag?.allySupport ?? null,
      });
    }
    if (next === current) continue;
    await setConditionValue(actor, "flanked", next);
    if (_isEFDebugEnabled()) {
      const readback = Number(getConditionValue(actor, "flanked") ?? 0);
      console.log("UESRPG | Engagement & Flanking | actor write", {
        actor: actor?.name ?? null,
        actorId: actor?.id ?? null,
        requested: next,
        readback,
      });
    }
  }

  for (const actor of (game.actors ?? [])) {
    if (!actor || sceneActorMap.has(actor.id)) continue;
    if (!hasCondition(actor, "flanked")) continue;
    await removeCondition(actor, "flanked");
  }
}

export function scheduleEngagementFlankingRefresh() {
  if (!_debouncedRefresh) {
    const debounce = foundry?.utils?.debounce;
    _debouncedRefresh = (typeof debounce === "function")
      ? debounce(() => void refreshEngagementFlanking().catch(_drawDebugError), 80)
      : (() => void refreshEngagementFlanking().catch(_drawDebugError));
  }
  _debouncedRefresh();
}

function _shouldRefreshForItem(item, changed) {
  if (!item?.parent || item.parent.documentName !== "Actor") return false;
  if (!["weapon", "skill", "combatStyle"].includes(String(item.type ?? "").toLowerCase())) return false;
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

export function registerEngagementFlanking() {
  game.uesrpg = game.uesrpg ?? {};
  if (game.uesrpg[FLAG_HOOKS]) return;
  game.uesrpg[FLAG_HOOKS] = true;

  Hooks.on("canvasReady", () => {
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("canvasTearDown", () => {
    _tokenPositionCache.clear();
  });

  Hooks.on("updateToken", (_tokenDoc, changed) => {
    if (!_isEnabledNow()) return;
    if (!_shouldRefreshForToken(changed)) return;
    scheduleEngagementFlankingRefresh();
  });

  // Supplementary movement detector: catches position changes that may not
  // produce an x/y diff in updateToken (e.g. drag-back-to-origin in v13.351).
  // token.document.x/y reflects the committed DB position, so the cache check
  // fires once per position commit and is silent for all animation frames.
  Hooks.on("refreshToken", (token) => {
    if (!_isEnabledNow()) return;
    const id = token.id ?? token.document?.id;
    if (!id) return;
    const x = token.document?.x;
    const y = token.document?.y;
    if (x == null || y == null) return;
    const last = _tokenPositionCache.get(id);
    if (!last || last.x !== x || last.y !== y) {
      _tokenPositionCache.set(id, { x, y });
      scheduleEngagementFlankingRefresh();
    }
  });

  Hooks.on("createToken", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("deleteToken", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("updateItem", (item, changed) => {
    if (!_isEnabledNow()) return;
    if (!_shouldRefreshForItem(item, changed)) return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("createItem", (item) => {
    if (!_isEnabledNow()) return;
    if (!item?.parent || item.parent.documentName !== "Actor") return;
    if (item.type !== "weapon" && item.type !== "combatStyle" && item.type !== "skill") return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("deleteItem", (item) => {
    if (!_isEnabledNow()) return;
    if (!item?.parent || item.parent.documentName !== "Actor") return;
    if (item.type !== "weapon" && item.type !== "combatStyle" && item.type !== "skill") return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("updateCombat", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("createCombat", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("deleteCombat", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("updateCombatant", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("createCombatant", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("deleteCombatant", () => {
    if (!_isEnabledNow()) return;
    scheduleEngagementFlankingRefresh();
  });

  Hooks.on("updateActor", (_actor, changed) => {
    if (!_isEnabledNow()) return;
    if (foundry.utils.hasProperty(changed, "flags.uesrpg-3ev4.homebrew.maxEngagementScore")) {
      scheduleEngagementFlankingRefresh();
    }
  });
}

export function getEngagementReachBounds(actor) {
  return _getLongestEquippedMeleeReach(actor);
}

export function getEngagementScore(actor) {
  return _getEngagementScore(actor);
}
