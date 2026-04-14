/**
 * Optimized talent scanning utilities with early exit patterns and size-based thresholds.
 * 
 * This module provides performance-optimized alternatives to linear talent/item scanning
 * for large datasets (100+ items). It implements:
 * - Early exit patterns (return on first match)
 * - Size-based algorithm selection
 * - Batched scanning for multiple talent checks
 * 
 * @module optimized-talent-scanner
 */

import { resolveTalentSlug, normalizeTalentKey, TALENT_NAME_ALIASES } from "../core/traits/talents-api.js";

/**
 * Optimized talent scanner with early exit.
 * 
 * @param {Actor} actor - The actor to scan
 * @param {string|string[]} talentKeys - Single talent key or array of keys to check
 * @param {Object} options - Scanner options
 * @param {boolean} options.returnFirst - Return first matching talent item (default: false, returns boolean)
 * @param {number} options.maxScanItems - Maximum items to scan before early exit (default: all items)
 * @returns {boolean|Item|null} - If returnFirst=true, returns matching Item or null; otherwise returns boolean
 */
export function scanForTalent(actor, talentKeys, options = {}) {
  const { returnFirst = false, maxScanItems = Infinity } = options;
  
  if (!actor?.items?.length) {
    return returnFirst ? null : false;
  }
  
  const items = actor.items;
  const keys = Array.isArray(talentKeys) ? talentKeys : [talentKeys];
  
  // Pre-normalize all keys for faster comparison
  const normalizedKeys = new Set();
  const slugToKeyMap = new Map();
  
  for (const key of keys) {
    const slug = resolveTalentSlug(key);
    normalizedKeys.add(slug);
    slugToKeyMap.set(slug, key);
    
    // Also add aliases
    const aliases = TALENT_NAME_ALIASES[slug] || [];
    for (const alias of aliases) {
      const normalizedAlias = normalizeTalentKey(alias);
      normalizedKeys.add(normalizedAlias);
      slugToKeyMap.set(normalizedAlias, key);
    }
  }
  
  // Early exit for empty key set
  if (normalizedKeys.size === 0) {
    return returnFirst ? null : false;
  }
  
  // Size-based optimization: for small datasets, linear scan is fine
  // For large datasets, we could use indexed lookup but we need to keep it simple
  const itemCount = items.length;
  const scannedItems = Math.min(itemCount, maxScanItems);
  
  for (let i = 0; i < scannedItems; i++) {
    const item = items[i];
    if (!item || item.type !== "talent") continue;
    
    const normalizedName = normalizeTalentKey(item.name);
    if (normalizedName && normalizedKeys.has(normalizedName)) {
      if (returnFirst) {
        return item;
      }
      return true;
    }
  }
  
  return returnFirst ? null : false;
}

/**
 * Batch scan for multiple talents with single pass through items.
 * Returns a Map of talentKey -> boolean.
 * 
 * @param {Actor} actor - The actor to scan
 * @param {string[]} talentKeys - Array of talent keys to check
 * @returns {Map<string, boolean>} - Map of talent existence
 */
export function batchScanTalents(actor, talentKeys) {
  const result = new Map();
  
  if (!actor?.items?.length || !talentKeys?.length) {
    for (const key of talentKeys) {
      result.set(key, false);
    }
    return result;
  }
  
  // Initialize all results to false
  for (const key of talentKeys) {
    result.set(key, false);
  }
  
  // Pre-normalize keys
  const keyToSlug = new Map();
  const slugToKeys = new Map();
  
  for (const key of talentKeys) {
    const slug = resolveTalentSlug(key);
    keyToSlug.set(key, slug);
    
    if (!slugToKeys.has(slug)) {
      slugToKeys.set(slug, new Set());
    }
    slugToKeys.get(slug).add(key);
    
    // Also map aliases
    const aliases = TALENT_NAME_ALIASES[slug] || [];
    for (const alias of aliases) {
      const normalizedAlias = normalizeTalentKey(alias);
      if (!slugToKeys.has(normalizedAlias)) {
        slugToKeys.set(normalizedAlias, new Set());
      }
      slugToKeys.get(normalizedAlias).add(key);
    }
  }
  
  // Single pass through items
  const items = actor.items;
  let remainingKeys = talentKeys.length;
  
  for (const item of items) {
    if (!item || item.type !== "talent") continue;
    
    const normalizedName = normalizeTalentKey(item.name);
    if (!normalizedName) continue;
    
    const matchingKeys = slugToKeys.get(normalizedName);
    if (matchingKeys) {
      for (const key of matchingKeys) {
        if (!result.get(key)) {
          result.set(key, true);
          remainingKeys--;
        }
      }
    }
    
    // Early exit: if we've found all requested talents
    if (remainingKeys <= 0) {
      break;
    }
  }
  
  return result;
}

/**
 * Optimized hasTalent with early exit and caching support.
 * 
 * @param {Actor} actor - The actor to check
 * @param {string} talentKey - Talent key to check
 * @param {Object} options - Options
 * @param {boolean} options.useCache - Use prepare context cache if available (default: true)
 * @returns {boolean} - Whether actor has the talent
 */
export function hasTalentOptimized(actor, talentKey, options = {}) {
  const { useCache = true } = options;
  
  if (!actor || !talentKey) {
    return false;
  }
  
  // Try cache first if available
  if (useCache) {
    try {
      const k = String(talentKey ?? "").trim().toLowerCase();
      if (!k) return false;
      const normalized = k.replace(/\s+/g, "");
      const set = actor?._getPrepareCtx?.()?.talentSlugSet;
      if (set instanceof Set && (set.has(k) || set.has(normalized))) {
        return true;
      }
    } catch (_e) {
      // Fall through to scanning
    }
  }
  
  // Use optimized scanner
  return scanForTalent(actor, talentKey, { returnFirst: false });
}

/**
 * Size-based algorithm selector for item scanning.
 * 
 * @param {Actor} actor - The actor
 * @param {Function} smallDatasetFn - Function to call for small datasets
 * @param {Function} largeDatasetFn - Function to call for large datasets
 * @param {Object} options - Options
 * @param {number} options.threshold - Item count threshold (default: 50)
 * @returns {*} - Result of selected function
 */
export function withSizeBasedSelection(actor, smallDatasetFn, largeDatasetFn, options = {}) {
  const { threshold = 50 } = options;
  const itemCount = actor?.items?.length || 0;
  
  if (itemCount <= threshold) {
    return smallDatasetFn(actor);
  } else {
    return largeDatasetFn(actor);
  }
}

/**
 * Early exit item scanner for specific item types.
 * 
 * @param {Actor} actor - The actor
 * @param {string|string[]} itemTypes - Item type(s) to scan for
 * @param {Function} predicate - Optional predicate function(item) -> boolean
 * @param {Object} options - Options
 * @param {number} options.maxItems - Maximum items to scan (default: all)
 * @param {boolean} options.returnFirst - Return first match (default: false)
 * @returns {Array|Item|null} - Matching items or first match
 */
export function scanItemsByType(actor, itemTypes, predicate = null, options = {}) {
  const { maxItems = Infinity, returnFirst = false } = options;
  
  if (!actor?.items?.length) {
    return returnFirst ? null : [];
  }
  
  const types = new Set(Array.isArray(itemTypes) ? itemTypes : [itemTypes]);
  const items = actor.items;
  const result = returnFirst ? null : [];
  const scannedItems = Math.min(items.length, maxItems);
  
  for (let i = 0; i < scannedItems; i++) {
    const item = items[i];
    if (!item) continue;
    
    if (types.has(item.type)) {
      if (predicate && !predicate(item)) {
        continue;
      }
      
      if (returnFirst) {
        return item;
      }
      result.push(item);
    }
  }
  
  return result;
}

/**
 * Check if actor has any item matching criteria with early exit.
 * 
 * @param {Actor} actor - The actor
 * @param {Function} predicate - Function(item) -> boolean
 * @param {Object} options - Options
 * @param {number} options.maxScan - Maximum items to scan (default: 100)
 * @returns {boolean} - Whether any item matches
 */
export function hasAnyItemMatching(actor, predicate, options = {}) {
  const { maxScan = 100 } = options;
  
  if (!actor?.items?.length || typeof predicate !== "function") {
    return false;
  }
  
  const items = actor.items;
  const scannedItems = Math.min(items.length, maxScan);
  
  for (let i = 0; i < scannedItems; i++) {
    const item = items[i];
    if (item && predicate(item)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Performance statistics for talent scanning.
 */
export const talentScanStats = {
  scans: 0,
  itemsScanned: 0,
  earlyExits: 0,
  cacheHits: 0,
  
  reset() {
    this.scans = 0;
    this.itemsScanned = 0;
    this.earlyExits = 0;
    this.cacheHits = 0;
  },
  
  getStats() {
    return {
      scans: this.scans,
      itemsScanned: this.itemsScanned,
      earlyExits: this.earlyExits,
      cacheHits: this.cacheHits,
      avgItemsPerScan: this.scans > 0 ? this.itemsScanned / this.scans : 0
    };
  }
};