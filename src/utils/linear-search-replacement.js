/**
 * Demonstration of replacing linear searches with Map-based lookups.
 * 
 * This module shows examples of converting common linear search patterns
 * to use the indexed collection classes for O(1) lookups.
 * 
 * @module linear-search-replacement
 */

import { globalCollectionRegistry } from './indexed-collections.js';

/**
 * Example 1: Replacing talent scanning with indexed lookup
 * 
 * BEFORE: Linear scan through all items
 * function hasTalentLinear(actor, talentKey) {
 *   const items = actor.items ?? [];
 *   for (const item of items) {
 *     if (item.type === 'talent' && item.name.toLowerCase().includes(talentKey.toLowerCase())) {
 *       return true;
 *     }
 *   }
 *   return false;
 * }
 * 
 * AFTER: Map-based lookup
 */
export function hasTalentIndexed(actor, talentKey) {
  const manager = globalCollectionRegistry.getManager(actor);
  return manager.hasTalent(talentKey);
}

/**
 * Example 2: Replacing item type filtering with indexed lookup
 * 
 * BEFORE: Linear filter
 * function getWeaponsLinear(actor) {
 *   return (actor.items ?? []).filter(item => item.type === 'weapon');
 * }
 * 
 * AFTER: Map-based lookup
 */
export function getWeaponsIndexed(actor) {
  const manager = globalCollectionRegistry.getManager(actor);
  return manager.getItemsByType('weapon');
}

/**
 * Example 3: Replacing effect lookup by key
 * 
 * BEFORE: Linear scan
 * function getEffectByKeyLinear(actor, key) {
 *   const effects = actor.effects ?? [];
 *   for (const effect of effects) {
 *     if (effect.flags?.['uesrpg-3ev4']?.key === key) {
 *       return effect;
 *     }
 *   }
 *   return null;
 * }
 * 
 * AFTER: Map-based lookup
 */
export function getEffectByKeyIndexed(actor, key) {
  const manager = globalCollectionRegistry.getManager(actor);
  return manager.getEffectByKey(key);
}

/**
 * Example 4: Batch talent checking (checking multiple talents at once)
 * 
 * BEFORE: Multiple linear scans
 * function checkMultipleTalentsLinear(actor, talentKeys) {
 *   const results = {};
 *   for (const key of talentKeys) {
 *     results[key] = hasTalentLinear(actor, key);
 *   }
 *   return results;
 * }
 * 
 * AFTER: Single pass with indexed lookup
 */
export function checkMultipleTalentsIndexed(actor, talentKeys) {
  const manager = globalCollectionRegistry.getManager(actor);
  const results = {};
  
  for (const key of talentKeys) {
    results[key] = manager.hasTalent(key);
  }
  
  return results;
}

/**
 * Example 5: Finding equipped items with specific properties
 * 
 * BEFORE: Linear filter
 * function findEquippedWeaponsWithPropertyLinear(actor, property, value) {
 *   const items = actor.items ?? [];
 *   return items.filter(item => 
 *     item.type === 'weapon' && 
 *     item.system?.equipped === true &&
 *     item.system?.[property] === value
 *   );
 * }
 * 
 * AFTER: Pre-filter by type/equipped, then linear scan on smaller subset
 */
export function findEquippedWeaponsWithPropertyIndexed(actor, property, value) {
  const manager = globalCollectionRegistry.getManager(actor);
  const weapons = manager.getItemsByType('weapon');
  
  // Still need linear scan for property check, but on smaller subset
  return weapons.filter(weapon => 
    weapon.system?.equipped === true &&
    weapon.system?.[property] === value
  );
}

/**
 * Example 6: Getting all effects from a specific item
 * 
 * BEFORE: Linear filter
 * function getEffectsFromItemLinear(actor, itemId) {
 *   const effects = actor.effects ?? [];
 *   return effects.filter(effect => effect.sourceId === itemId);
 * }
 * 
 * AFTER: Map-based lookup
 */
export function getEffectsFromItemIndexed(actor, itemId) {
  const manager = globalCollectionRegistry.getManager(actor);
  return manager.effects.getBySourceId(itemId);
}

/**
 * Performance comparison helper
 */
export class SearchPerformance {
  constructor() {
    this.linearTimes = [];
    this.indexedTimes = [];
  }
  
  /**
   * Time a linear search operation
   * @param {Function} fn - Function to time
   * @param {...any} args - Arguments to pass
   * @returns {*} - Result of the function
   */
  timeLinear(fn, ...args) {
    const start = performance.now();
    const result = fn(...args);
    const end = performance.now();
    this.linearTimes.push(end - start);
    return result;
  }
  
  /**
   * Time an indexed search operation
   * @param {Function} fn - Function to time
   * @param {...any} args - Arguments to pass
   * @returns {*} - Result of the function
   */
  timeIndexed(fn, ...args) {
    const start = performance.now();
    const result = fn(...args);
    const end = performance.now();
    this.indexedTimes.push(end - start);
    return result;
  }
  
  /**
   * Get performance statistics
   * @returns {Object}
   */
  getStats() {
    const avgLinear = this.linearTimes.length > 0 
      ? this.linearTimes.reduce((a, b) => a + b, 0) / this.linearTimes.length 
      : 0;
    
    const avgIndexed = this.indexedTimes.length > 0
      ? this.indexedTimes.reduce((a, b) => a + b, 0) / this.indexedTimes.length
      : 0;
    
    return {
      linear: {
        count: this.linearTimes.length,
        totalMs: this.linearTimes.reduce((a, b) => a + b, 0),
        avgMs: avgLinear,
        minMs: Math.min(...this.linearTimes),
        maxMs: Math.max(...this.linearTimes)
      },
      indexed: {
        count: this.indexedTimes.length,
        totalMs: this.indexedTimes.reduce((a, b) => a + b, 0),
        avgMs: avgIndexed,
        minMs: Math.min(...this.indexedTimes),
        maxMs: Math.max(...this.indexedTimes)
      },
      improvement: avgLinear > 0 ? ((avgLinear - avgIndexed) / avgLinear * 100) : 0
    };
  }
  
  /**
   * Reset timing data
   */
  reset() {
    this.linearTimes = [];
    this.indexedTimes = [];
  }
}

/**
 * Migration guide for replacing linear searches
 */
export const migrationGuide = {
  /**
   * Pattern 1: Simple talent check
   * 
   * OLD:
   * import { hasTalent } from '../core/traits/talents-api.js';
   * const hasSwashbuckler = hasTalent(actor, 'swashbuckler');
   * 
   * NEW:
   * import { hasTalentIndexed } from '../utils/linear-search-replacement.js';
   * const hasSwashbuckler = hasTalentIndexed(actor, 'swashbuckler');
   * 
   * OR (for gradual migration):
   * import { globalCollectionRegistry } from '../utils/indexed-collections.js';
   * const manager = globalCollectionRegistry.getManager(actor);
   * const hasSwashbuckler = manager.hasTalent('swashbuckler');
   */
  
  /**
   * Pattern 2: Getting items by type
   * 
   * OLD:
   * const weapons = actor.items.filter(item => item.type === 'weapon');
   * 
   * NEW:
   * import { getWeaponsIndexed } from '../utils/linear-search-replacement.js';
   * const weapons = getWeaponsIndexed(actor);
   * 
   * OR:
   * import { globalCollectionRegistry } from '../utils/indexed-collections.js';
   * const manager = globalCollectionRegistry.getManager(actor);
   * const weapons = manager.getItemsByType('weapon');
   */
  
  /**
   * Pattern 3: Finding effect by key
   * 
   * OLD:
   * const aimEffect = actor.effects.find(e => e.flags?.['uesrpg-3ev4']?.key === 'aim');
   * 
   * NEW:
   * import { getEffectByKeyIndexed } from '../utils/linear-search-replacement.js';
   * const aimEffect = getEffectByKeyIndexed(actor, 'aim');
   */
  
  /**
   * Pattern 4: Batch operations
   * 
   * OLD:
   * const talentKeys = ['swashbuckler', 'dualwielder', 'pugilist'];
   * const results = {};
   * for (const key of talentKeys) {
   *   results[key] = hasTalent(actor, key);
   * }
   * 
   * NEW:
   * import { checkMultipleTalentsIndexed } from '../utils/linear-search-replacement.js';
   * const results = checkMultipleTalentsIndexed(actor, talentKeys);
   */
};

/**
 * Initialize the collection registry for an actor
 * Call this when actor data changes (create/update/delete items/effects)
 * 
 * @param {Actor} actor - The actor to initialize
 */
export function initializeActorCollections(actor) {
  globalCollectionRegistry.refresh(actor);
}

/**
 * Clean up collections for an actor
 * Call this when actor is no longer needed (sheet closed, etc.)
 * 
 * @param {string} actorId - Actor ID to clean up
 */
export function cleanupActorCollections(actorId) {
  globalCollectionRegistry.remove(actorId);
}

/**
 * Get performance statistics for the global registry
 * 
 * @returns {Object}
 */
export function getRegistryStats() {
  return globalCollectionRegistry.getStats();
}