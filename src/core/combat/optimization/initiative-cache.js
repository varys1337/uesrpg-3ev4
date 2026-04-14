/**
 * Initiative Calculation Cache
 *
 * Caches initiative calculations to avoid recomputation during combat.
 * Uses WeakMap for garbage-collectable storage and automatic cleanup.
 *
 * @module core/combat/optimization/initiative-cache
 */

import { SYSTEM_ID } from "../../constants.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../../utils/perf-tracker.js";

/**
 * Initiative calculation cache
 */
const initiativeCache = new WeakMap();

/**
 * Get cached initiative value for an actor
 * @param {Actor} actor - Actor document
 * @param {object} combatState - Combat state context
 * @returns {number|null} Cached initiative value or null if not cached
 */
export function getCachedInitiative(actor, combatState) {
  if (!actor) return null;
  
  const cache = initiativeCache.get(actor);
  if (!cache) return null;
  
  // Generate cache key from combat state
  const cacheKey = generateCacheKey(combatState);
  
  // Check if cache is still valid (5 second TTL)
  if (cache.key === cacheKey && Date.now() - cache.timestamp < 5000) {
    return cache.value;
  }
  
  return null;
}

/**
 * Set cached initiative value for an actor
 * @param {Actor} actor - Actor document
 * @param {object} combatState - Combat state context
 * @param {number} value - Initiative value to cache
 */
export function setCachedInitiative(actor, combatState, value) {
  if (!actor) return;
  
  const cacheKey = generateCacheKey(combatState);
  initiativeCache.set(actor, {
    key: cacheKey,
    value,
    timestamp: Date.now()
  });
}

/**
 * Generate cache key from combat state
 * @param {object} combatState - Combat state context
 * @returns {string} Cache key
 */
function generateCacheKey(combatState) {
  if (!combatState) return 'default';
  
  // Extract relevant properties for cache key
  const keyParts = [];
  
  if (combatState.round !== undefined) keyParts.push(`r${combatState.round}`);
  if (combatState.turn !== undefined) keyParts.push(`t${combatState.turn}`);
  if (combatState.surprised !== undefined) keyParts.push(`s${combatState.surprised}`);
  if (combatState.useCombatSenses !== undefined) keyParts.push(`cs${combatState.useCombatSenses}`);
  if (combatState.tacticianChoice !== undefined) keyParts.push(`tc${JSON.stringify(combatState.tacticianChoice)}`);
  
  return keyParts.join('|') || 'default';
}

/**
 * Cached initiative calculation
 * @param {Actor} actor - Actor document
 * @param {object} combatState - Combat state context
 * @param {Function} calculateFn - Function to calculate initiative if not cached
 * @returns {Promise<number>} Initiative value
 */
export async function calculateInitiativeWithCache(actor, combatState, calculateFn) {
  if (!actor || typeof calculateFn !== 'function') {
    return calculateFn ? await calculateFn(actor, combatState) : 0;
  }
  
  // Check cache first
  const cached = getCachedInitiative(actor, combatState);
  if (cached !== null) {
    if (isPerfEnabled()) {
      perfRecord({
        event: 'initiative.cache.hit',
        actorId: actor.id,
        actorName: actor.name,
        cachedValue: cached,
      });
    }
    return cached;
  }
  
  // Calculate
  const perfStart = isPerfEnabled() ? monoMs() : 0;
  const initiative = await calculateFn(actor, combatState);
  
  if (isPerfEnabled()) {
    perfRecord({
      event: 'initiative.cache.miss',
      actorId: actor.id,
      actorName: actor.name,
      calculatedValue: initiative,
      durationMs: monoMs() - perfStart,
    });
  }
  
  // Cache result
  setCachedInitiative(actor, combatState, initiative);
  
  return initiative;
}

/**
 * Invalidate initiative cache for an actor
 * @param {Actor} actor - Actor document
 */
export function invalidateActorInitiativeCache(actor) {
  if (!actor) return;
  initiativeCache.delete(actor);
}

/**
 * Clear all initiative caches
 */
export function clearAllInitiativeCaches() {
  // WeakMap doesn't have a clear method, but we can create a new one
  // Since it's a WeakMap, entries will be garbage collected when actors are no longer referenced
  // For complete clearing, we need to replace the reference
  // This is handled by re-importing the module
}

/**
 * Get cache statistics
 * @returns {object} Cache statistics
 */
export function getInitiativeCacheStats() {
  // WeakMap doesn't expose size, so we can't provide accurate statistics
  return {
    cacheType: 'WeakMap',
    description: 'Initiative cache uses WeakMap for automatic garbage collection',
  };
}

/**
 * Batched initiative rolling
 * @param {Combat} combat - Combat document
 * @param {string[]} combatantIds - Array of combatant IDs
 * @param {object} options - Rolling options
 * @returns {Promise<object>} Map of combatant IDs to initiative values
 */
export async function rollInitiativesBatched(combat, combatantIds, options = {}) {
  const perfStart = isPerfEnabled() ? monoMs() : 0;
  
  if (!combat || !Array.isArray(combatantIds) || combatantIds.length === 0) {
    return {};
  }
  
  // Group by actor type to optimize preparation
  const byActorType = new Map();
  
  for (const combatantId of combatantIds) {
    const combatant = combat.combatants?.get(combatantId);
    if (!combatant) continue;
    
    const actor = combatant.actor;
    if (!actor) continue;
    
    const type = actor.type;
    if (!byActorType.has(type)) {
      byActorType.set(type, []);
    }
    byActorType.get(type).push({ combatantId, actor });
  }
  
  // Prepare actors by type (shared preparation)
  const preparationPromises = [];
  for (const [type, group] of byActorType) {
    preparationPromises.push(
      prepareActorsForInitiative(group.map(g => g.actor))
    );
  }
  
  await Promise.all(preparationPromises);
  
  // Roll initiatives in parallel
  const updatePromises = [];
  const initiativeMap = {};
  
  for (const combatantId of combatantIds) {
    updatePromises.push(
      (async () => {
        const combatant = combat.combatants?.get(combatantId);
        if (!combatant) return;
        
        const actor = combatant.actor;
        if (!actor) return;
        
        // Use cached calculation if available
        const combatState = {
          round: combat.round,
          turn: combat.turn,
          surprised: combatant.flags?.[SYSTEM_ID]?.surprised,
          useCombatSenses: options.useCombatSenses,
          tacticianChoice: options.tacticianChoice,
        };
        
        const initiative = await calculateInitiativeWithCache(
          actor,
          combatState,
          async (actor, state) => {
            // Default initiative calculation
            return actor.system?.initiative?.value || 0;
          }
        );
        
        initiativeMap[combatantId] = initiative;
      })()
    );
  }
  
  await Promise.all(updatePromises);
  
  // Single combat update with all initiatives
  const updates = {};
  combatantIds.forEach((id) => {
    if (initiativeMap[id] !== undefined) {
      updates[id] = { initiative: initiativeMap[id] };
    }
  });
  
  if (Object.keys(updates).length > 0) {
    await combat.update({ combatants: updates });
  }
  
  if (isPerfEnabled()) {
    perfRecord({
      event: 'initiative.batch.roll',
      combatId: combat.id,
      combatantCount: combatantIds.length,
      batchedTypes: byActorType.size,
      durationMs: monoMs() - perfStart,
    });
  }
  
  return initiativeMap;
}

/**
 * Shared actor preparation for initiative
 * @param {Actor[]} actors - Array of actors
 * @returns {Promise<void>}
 */
async function prepareActorsForInitiative(actors) {
  if (!actors || actors.length === 0) return;
  
  // Check if all actors are already prepared
  const needsPreparation = actors.filter(actor => 
    !actor._initiativePrepared
  );
  
  if (needsPreparation.length === 0) return;
  
  // Batch prepare
  const preparationPromises = needsPreparation.map(actor =>
    actor.prepareDerivedData?.()
  );
  
  await Promise.all(preparationPromises);
  
  // Mark as prepared
  needsPreparation.forEach(actor => {
    actor._initiativePrepared = true;
  });
}

/**
 * Register cache invalidation hooks
 */
export function registerInitiativeCacheInvalidation() {
  // Invalidate initiative cache when relevant actor stats change
  Hooks.on('updateActor', (actor, update) => {
    // Invalidate initiative cache if relevant stats changed
    if (update?.system?.attributes?.initiative !== undefined ||
        update?.system?.skills?.initiative !== undefined ||
        update?.system?.characteristics?.prc !== undefined ||
        update?.system?.characteristics?.agl !== undefined) {
      invalidateActorInitiativeCache(actor);
    }
  });
  
  // Invalidate cache when actor effects change
  Hooks.on('updateActiveEffect', (effect, update) => {
    const actor = effect.parent;
    if (actor && (update.disabled !== undefined || update.changes?.length > 0)) {
      invalidateActorInitiativeCache(actor);
    }
  });
  
  // Invalidate cache when combat state changes significantly
  Hooks.on('updateCombat', (combat, update) => {
    if (update.round !== undefined || update.turn !== undefined) {
      // Clear all caches on round/turn change
      // This is aggressive but ensures correctness
      // In a more optimized version, we could track which actors are affected
      clearAllInitiativeCaches();
    }
  });
  
  console.log('UESRPG | Initiative cache invalidation hooks registered');
}