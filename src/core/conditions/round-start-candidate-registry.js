/**
 * src/core/conditions/round-start-candidate-registry.js
 *
 * Authoritative registry for round-start candidate discovery.
 *
 * Maintains two candidate maps keyed by actor id:
 *  - actorsWithRegeneration
 *  - actorsSilencedInCombat
 *
 * Also maintains a lightweight combat membership cache keyed by combat id
 * so query helpers can intersect candidates with combat participants without
 * broad combatant scans on each round boundary.
 */

import { getActorTraitValue } from "../traits/trait-registry.js";
import { hasCondition } from "./condition-engine.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { getActorCapabilityFlag } from "../active-effects/modifier-evaluator.js";
import { resolveUuidSync } from "../../utils/uuid-cache.js";

/** @typedef {{ actorId: string, actorUuid: string, regenValue: number }} CandidateEntry */

/** @type {Map<string, CandidateEntry>} */
const _actorsWithRegeneration = new Map();
/** @type {Map<string, CandidateEntry>} */
const _actorsSilencedInCombat = new Map();
/** @type {Map<string, Set<string>>} */
const _combatActorIds = new Map();

let _registered = false;

function _toCollectionArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  return Array.from(collection);
}

function _isRegistryEnabled() {
  try {
    const value = game?.settings?.get?.(SYSTEM_ID, "useRoundStartCandidateRegistry");
    return value !== false;
  } catch (_e) {
    // Fail-open to preserve optimized path when setting registration is unavailable.
    return true;
  }
}

function _makeEntry(actor, regenValue = 0) {
  const actorId = String(actor?.id ?? "");
  const actorUuid = String(actor?.uuid ?? "");
  if (!actorId || !actorUuid) return null;
  return {
    actorId,
    actorUuid,
    regenValue: Math.max(0, Number(regenValue) || 0)
  };
}

function _resolveActor(entry, { cache } = {}) {
  if (!entry) return null;

  const fromUuid = resolveUuidSync(entry.actorUuid, { cache });
  if (fromUuid?.documentName === "Actor") return fromUuid;

  return game?.actors?.get?.(entry.actorId) ?? null;
}

function _hasRegeneration(actor) {
  const value = Number(getActorTraitValue(actor, "regeneration", { mode: "max" })) || 0;
  return value > 0 ? value : 0;
}

function _hasRegenerationFlag(actor) {
  return getActorCapabilityFlag(actor, "flags.uesrpg-3ev4.healing.regenerationRoundStart") ? 1 : 0;
}

function _refreshActorCandidates(actor) {
  const actorId = String(actor?.id ?? "");
  if (!actorId) return;

  const regenValue = _hasRegeneration(actor) || _hasRegenerationFlag(actor);
  if (regenValue > 0) {
    const entry = _makeEntry(actor, regenValue);
    if (entry) _actorsWithRegeneration.set(actorId, entry);
  } else {
    _actorsWithRegeneration.delete(actorId);
  }

  const silenced = hasCondition(actor, "silenced");
  if (silenced) {
    const entry = _makeEntry(actor, regenValue);
    if (entry) _actorsSilencedInCombat.set(actorId, entry);
  } else {
    _actorsSilencedInCombat.delete(actorId);
  }
}

function _removeActorEverywhere(actorId) {
  const id = String(actorId ?? "");
  if (!id) return;

  _actorsWithRegeneration.delete(id);
  _actorsSilencedInCombat.delete(id);
  for (const actorIdSet of _combatActorIds.values()) {
    actorIdSet.delete(id);
  }
}

function _rebuildActorCandidates() {
  _actorsWithRegeneration.clear();
  _actorsSilencedInCombat.clear();

  for (const actor of (game?.actors?.contents ?? [])) {
    _refreshActorCandidates(actor);
  }
}

function _buildCombatActorIdSet(combat) {
  const ids = new Set();
  for (const combatant of _toCollectionArray(combat?.combatants)) {
    const actorId = String(combatant?.actor?.id ?? combatant?.actorId ?? "");
    if (actorId) ids.add(actorId);
  }
  return ids;
}

function _setCombatCache(combat) {
  const combatId = String(combat?.id ?? "");
  if (!combatId) return;
  _combatActorIds.set(combatId, _buildCombatActorIdSet(combat));
}

function _rebuildCombatMembershipCaches() {
  _combatActorIds.clear();
  for (const combat of (game?.combats?.contents ?? [])) {
    _setCombatCache(combat);
  }
  if (game?.combat?.id) _setCombatCache(game.combat);
}

function _shouldRefreshActorOnUpdate(changed) {
  if (!changed || typeof changed !== "object") return false;
  if ("system" in changed || "items" in changed || "effects" in changed) return true;
  if ("flags" in changed) return true;
  return false;
}

function _isTraitBearingItem(item) {
  const type = String(item?.type ?? "");
  return type === "trait" || type === "talent" || type === "power";
}

function _queryCandidates(mapRef, combat, type) {
  if (!_isRegistryEnabled()) {
    return {
      candidates: [],
      candidateCount: 0,
      usedFallback: true,
      fallbackReason: "registryDisabled",
      type
    };
  }

  const combatId = String(combat?.id ?? "");
  if (!combatId) {
    return {
      candidates: [],
      candidateCount: 0,
      usedFallback: true,
      fallbackReason: "invalidCombat",
      type
    };
  }

  const actorIdSet = _combatActorIds.get(combatId);
  if (!(actorIdSet instanceof Set)) {
    return {
      candidates: [],
      candidateCount: 0,
      usedFallback: true,
      fallbackReason: "missingCombatCache",
      type
    };
  }

  const resolveCache = new Map();
  const candidates = [];
  for (const [actorId, entry] of mapRef) {
    if (!actorIdSet.has(actorId)) continue;
    const actor = _resolveActor(entry, { cache: resolveCache });
    if (!actor) {
      return {
        candidates: [],
        candidateCount: 0,
        usedFallback: true,
        fallbackReason: "unresolvedActor",
        type
      };
    }
    candidates.push({
      actor,
      traitValue: Number(entry.regenValue ?? 0) || 0
    });
  }

  return {
    candidates,
    candidateCount: candidates.length,
    usedFallback: false,
    fallbackReason: null,
    type
  };
}

export function initializeRoundStartCandidateRegistry() {
  if (_registered) return;
  _registered = true;

  const _seed = () => {
    _rebuildActorCandidates();
    _rebuildCombatMembershipCaches();
  };

  _seed();
  Hooks.once("ready", _seed);

  Hooks.on("createActor", (actor) => {
    _refreshActorCandidates(actor);
  });

  Hooks.on("updateActor", (actor, changed) => {
    if (!_shouldRefreshActorOnUpdate(changed)) return;
    _refreshActorCandidates(actor);
  });

  Hooks.on("deleteActor", (actor) => {
    _removeActorEverywhere(actor?.id);
  });

  Hooks.on("createItem", (item) => {
    if (!_isTraitBearingItem(item)) return;
    const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
    if (actor) _refreshActorCandidates(actor);
  });

  Hooks.on("updateItem", (item) => {
    if (!_isTraitBearingItem(item)) return;
    const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
    if (actor) _refreshActorCandidates(actor);
  });

  Hooks.on("deleteItem", (item) => {
    if (!_isTraitBearingItem(item)) return;
    const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
    if (actor) _refreshActorCandidates(actor);
  });

  Hooks.on("createActiveEffect", (effect) => {
    const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
    if (!actor) return;
    _refreshActorCandidates(actor);
  });

  Hooks.on("updateActiveEffect", (effect, _changed) => {
    const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
    if (!actor) return;
    _refreshActorCandidates(actor);
  });

  Hooks.on("deleteActiveEffect", (effect) => {
    const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
    if (actor) _refreshActorCandidates(actor);
  });

  Hooks.on("createCombat", (combat) => {
    _setCombatCache(combat);
  });

  Hooks.on("deleteCombat", (combat) => {
    _combatActorIds.delete(String(combat?.id ?? ""));
  });

  Hooks.on("createCombatant", (combatant) => {
    const combat = combatant?.parent;
    if (combat?.documentName === "Combat") _setCombatCache(combat);
  });

  Hooks.on("updateCombatant", (combatant) => {
    const combat = combatant?.parent;
    if (combat?.documentName === "Combat") _setCombatCache(combat);
  });

  Hooks.on("deleteCombatant", (combatant) => {
    const combat = combatant?.parent;
    if (combat?.documentName === "Combat") _setCombatCache(combat);
  });
}

export function rebuildRoundStartCandidateRegistry() {
  _rebuildActorCandidates();
  _rebuildCombatMembershipCaches();
}

export function getRegenerationCandidatesForCombat(combat) {
  return _queryCandidates(_actorsWithRegeneration, combat, "regeneration");
}

export function getSilencedCandidatesForCombat(combat) {
  return _queryCandidates(_actorsSilencedInCombat, combat, "silenced");
}

export function getRoundStartCandidateRegistryState() {
  return {
    actorsWithRegeneration: _actorsWithRegeneration,
    actorsSilencedInCombat: _actorsSilencedInCombat,
    combatActorIds: _combatActorIds
  };
}
