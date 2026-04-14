/**
 * Sheet Cache Manager
 * 
 * Enhanced caching system for sheet rendering with dependency tracking
 * and smart invalidation.
 * 
 * @module ui/sheets/v2/cache-manager
 */

/**
 * Cache manager for sheet instances with dependency tracking
 */
export class SheetCacheManager {
  constructor(sheet) {
    this.sheet = sheet;
    this.caches = new Map();
    this.invalidationListeners = new Set();
    this.stats = {
      hits: 0,
      misses: 0,
      computations: 0,
      invalidations: 0
    };
  }
  
  /**
   * Register a cache with dependency tracking
   * @param {string} key - Cache key
   * @param {Function} computeFn - Function to compute the value
   * @param {Array<string>} dependencies - Path patterns this cache depends on
   * @param {Object} options - Cache options
   */
  registerCache(key, computeFn, dependencies = [], options = {}) {
    this.caches.set(key, {
      value: null,
      computeFn,
      dependencies,
      lastComputed: 0,
      options: {
        ttl: options.ttl || 0, // Time to live in ms (0 = infinite)
        maxAge: options.maxAge || 0, // Maximum age in ms (0 = no limit)
        ...options
      }
    });
  }
  
  /**
   * Get cached value or compute if not cached/invalid
   * @param {string} key - Cache key
   * @param {boolean} force - Force recomputation
   * @returns {*} Cached value
   */
  get(key, force = false) {
    const cache = this.caches.get(key);
    if (!cache) {
      this.stats.misses++;
      return null;
    }
    
    // Check if cache is valid
    const now = Date.now();
    const isExpired = cache.options.ttl > 0 && (now - cache.lastComputed) > cache.options.ttl;
    const isTooOld = cache.options.maxAge > 0 && (now - cache.lastComputed) > cache.options.maxAge;
    
    if (force || cache.value === null || isExpired || isTooOld) {
      this.stats.misses++;
      this.stats.computations++;
      cache.value = cache.computeFn();
      cache.lastComputed = now;
    } else {
      this.stats.hits++;
    }
    
    return cache.value;
  }
  
  /**
   * Set cache value directly
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   */
  set(key, value) {
    const cache = this.caches.get(key);
    if (cache) {
      cache.value = value;
      cache.lastComputed = Date.now();
    } else {
      this.caches.set(key, {
        value,
        computeFn: () => value,
        dependencies: [],
        lastComputed: Date.now(),
        options: {}
      });
    }
  }
  
  /**
   * Invalidate caches based on changed data paths
   * @param {Array<string>} changedPaths - Paths that changed
   */
  invalidateForChanges(changedPaths) {
    if (!changedPaths || changedPaths.length === 0) return;
    
    this.stats.invalidations++;
    
    for (const [key, cache] of this.caches) {
      if (this._dependsOnAny(cache.dependencies, changedPaths)) {
        cache.value = null;
        
        // Notify listeners
        for (const listener of this.invalidationListeners) {
          try {
            listener(key, changedPaths);
          } catch (err) {
            console.warn("UESRPG | Cache invalidation listener error", err);
          }
        }
      }
    }
  }
  
  /**
   * Invalidate specific cache by key
   * @param {string} key - Cache key to invalidate
   */
  invalidate(key) {
    const cache = this.caches.get(key);
    if (cache) {
      cache.value = null;
      this.stats.invalidations++;
    }
  }
  
  /**
   * Invalidate all caches
   */
  invalidateAll() {
    for (const [key, cache] of this.caches) {
      cache.value = null;
    }
    this.stats.invalidations++;
  }
  
  /**
   * Clear cache (remove from map)
   * @param {string} key - Cache key to clear
   */
  clear(key) {
    this.caches.delete(key);
  }
  
  /**
   * Clear all caches
   */
  clearAll() {
    this.caches.clear();
  }
  
  /**
   * Add invalidation listener
   * @param {Function} listener - Function called when cache is invalidated
   */
  addInvalidationListener(listener) {
    this.invalidationListeners.add(listener);
  }
  
  /**
   * Remove invalidation listener
   * @param {Function} listener - Listener to remove
   */
  removeInvalidationListener(listener) {
    this.invalidationListeners.delete(listener);
  }
  
  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    
    return {
      ...this.stats,
      hitRate: hitRate.toFixed(1),
      cacheCount: this.caches.size,
      listenerCount: this.invalidationListeners.size
    };
  }
  
  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      computations: 0,
      invalidations: 0
    };
  }
  
  /**
   * Check if cache depends on any of the changed paths
   * @private
   */
  _dependsOnAny(dependencies, changedPaths) {
    if (dependencies.length === 0) return false;
    
    for (const dependency of dependencies) {
      for (const changedPath of changedPaths) {
        if (this._pathMatches(dependency, changedPath)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Check if a path pattern matches a changed path
   * @private
   */
  _pathMatches(pattern, path) {
    // Simple pattern matching:
    // - Exact match: "system.attributes.strength"
    // - Wildcard suffix: "system.attributes.*"
    // - Wildcard segment: "system.*.strength"
    
    if (pattern === path) return true;
    if (pattern === "*") return true;
    
    const patternParts = pattern.split(".");
    const pathParts = path.split(".");
    
    if (patternParts.length !== pathParts.length && !pattern.includes("*")) {
      return false;
    }
    
    const maxLength = Math.max(patternParts.length, pathParts.length);
    for (let i = 0; i < maxLength; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];
      
      if (patternPart === "*") {
        // Wildcard matches anything
        continue;
      }
      
      if (patternPart !== pathPart) {
        return false;
      }
    }
    
    return true;
  }
}

/**
 * Shared cache for cross-sheet data
 * Uses WeakMap for automatic cleanup when actors are garbage collected
 */
const sharedSheetCache = new WeakMap();

/**
 * Get or create shared cache for an actor
 * @param {Actor} actor - Actor document
 * @returns {Object} Shared cache object
 */
export function getSharedCache(actor) {
  if (!actor) return null;
  
  if (!sharedSheetCache.has(actor)) {
    sharedSheetCache.set(actor, {
      // Immutable data that can be shared across sheet instances
      talentTree: null,
      skillCategories: null,
      itemTypes: null,
      effectCategories: null,
      preparedContext: null,
      
      // Metadata
      lastUpdated: 0,
      version: 1
    });
  }
  
  return sharedSheetCache.get(actor);
}

/**
 * Clear shared cache for an actor
 * @param {Actor} actor - Actor document
 */
export function clearSharedCache(actor) {
  if (actor) {
    sharedSheetCache.delete(actor);
  }
}

/**
 * Get cached value from shared cache with automatic recomputation
 * @param {Actor} actor - Actor document
 * @param {string} key - Cache key
 * @param {Function} computeFn - Function to compute value if not cached
 * @param {number} maxAge - Maximum age in ms before recomputation
 * @returns {*} Cached value
 */
export function getSharedCachedValue(actor, key, computeFn, maxAge = 5000) {
  const cache = getSharedCache(actor);
  if (!cache) return computeFn ? computeFn() : null;
  
  const now = Date.now();
  const needsUpdate = cache[key] === null || 
                     (maxAge > 0 && (now - cache.lastUpdated) > maxAge);
  
  if (needsUpdate && computeFn) {
    cache[key] = computeFn();
    cache.lastUpdated = now;
  }
  
  return cache[key];
}

/**
 * Set value in shared cache
 * @param {Actor} actor - Actor document
 * @param {string} key - Cache key
 * @param {*} value - Value to cache
 */
export function setSharedCachedValue(actor, key, value) {
  const cache = getSharedCache(actor);
  if (cache) {
    cache[key] = value;
    cache.lastUpdated = Date.now();
  }
}

/**
 * Simple LRU cache implementation
 */
export class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.accessOrder = [];
  }
  
  get(key) {
    if (!this.cache.has(key)) return null;
    
    // Update access order
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);
    
    return this.cache.get(key);
  }
  
  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      // Remove least recently used
      const lruKey = this.accessOrder.shift();
      this.cache.delete(lruKey);
    }
    
    this.cache.set(key, value);
    this.accessOrder.push(key);
  }
  
  delete(key) {
    this.cache.delete(key);
    this.accessOrder = this.accessOrder.filter(k => k !== key);
  }
  
  clear() {
    this.cache.clear();
    this.accessOrder = [];
  }
  
  size() {
    return this.cache.size;
  }
}

/**
 * Global cache metrics for monitoring
 */
const globalCacheMetrics = {
  hits: 0,
  misses: 0,
  computations: 0,
  invalidations: 0,
  startTime: Date.now()
};

/**
 * Get global cache metrics
 * @returns {Object} Global cache metrics
 */
export function getGlobalCacheMetrics() {
  const uptime = Date.now() - globalCacheMetrics.startTime;
  const total = globalCacheMetrics.hits + globalCacheMetrics.misses;
  const hitRate = total > 0 ? (globalCacheMetrics.hits / total) * 100 : 0;
  
  return {
    ...globalCacheMetrics,
    uptime,
    hitRate: hitRate.toFixed(1),
    requestsPerMinute: total > 0 ? (total / (uptime / 60000)).toFixed(1) : 0
  };
}

/**
 * Reset global cache metrics
 */
export function resetGlobalCacheMetrics() {
  globalCacheMetrics.hits = 0;
  globalCacheMetrics.misses = 0;
  globalCacheMetrics.computations = 0;
  globalCacheMetrics.invalidations = 0;
  globalCacheMetrics.startTime = Date.now();
}