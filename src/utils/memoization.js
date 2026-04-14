/**
 * Memoization utilities for expensive computations.
 * 
 * This module provides memoization functions with configurable caching strategies
 * including TTL, size limits, and custom key generation.
 * 
 * @module memoization
 */

/**
 * Default cache configuration.
 */
const DEFAULT_CACHE_CONFIG = {
  maxSize: 100,           // Maximum number of entries
  ttl: 5 * 60 * 1000,     // Time to live in milliseconds (5 minutes)
  useWeakMap: false,      // Use WeakMap for garbage-collectable keys
  keyGenerator: JSON.stringify, // Default key generator
};

/**
 * Memoization cache entry.
 */
class CacheEntry {
  constructor(value, timestamp = Date.now()) {
    this.value = value;
    this.timestamp = timestamp;
    this.hits = 0;
  }
  
  isExpired(ttl) {
    return ttl > 0 && (Date.now() - this.timestamp) > ttl;
  }
  
  hit() {
    this.hits++;
    this.timestamp = Date.now();
  }
}

/**
 * Memoization cache with configurable limits.
 */
class MemoizationCache {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.cache = this.config.useWeakMap ? new WeakMap() : new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
    };
  }
  
  /**
   * Get cached value for key.
   * @param {*} key - Cache key
   * @returns {*} - Cached value or undefined
   */
  get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    
    // Check expiration
    if (entry.isExpired(this.config.ttl)) {
      this.cache.delete(key);
      this.stats.evictions++;
      this.stats.size--;
      this.stats.misses++;
      return undefined;
    }
    
    // Update entry
    entry.hit();
    this.stats.hits++;
    return entry.value;
  }
  
  /**
   * Set cached value for key.
   * @param {*} key - Cache key
   * @param {*} value - Value to cache
   */
  set(key, value) {
    // Check size limit
    if (this.config.maxSize > 0 && this.stats.size >= this.config.maxSize) {
      this._evictOldest();
    }
    
    const entry = new CacheEntry(value);
    
    if (this.cache.has(key)) {
      // Update existing entry
      this.cache.set(key, entry);
    } else {
      // Add new entry
      this.cache.set(key, entry);
      this.stats.size++;
    }
  }
  
  /**
   * Delete cached value for key.
   * @param {*} key - Cache key
   */
  delete(key) {
    if (this.cache.delete(key)) {
      this.stats.size--;
    }
  }
  
  /**
   * Clear entire cache.
   */
  clear() {
    this.cache.clear();
    this.stats.size = 0;
    this.stats.evictions = 0;
  }
  
  /**
   * Get cache statistics.
   * @returns {Object} - Cache statistics
   */
  getStats() {
    return { ...this.stats };
  }
  
  /**
   * Evict oldest entry (LRU approximation).
   * @private
   */
  _evictOldest() {
    if (this.cache.size === 0) return;
    
    let oldestKey = null;
    let oldestTimestamp = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey !== null) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      this.stats.size--;
    }
  }
  
  /**
   * Clean up expired entries.
   * @returns {number} - Number of entries removed
   */
  cleanup() {
    if (this.config.ttl <= 0) return 0;
    
    let removed = 0;
    const now = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.isExpired(this.config.ttl)) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    this.stats.size -= removed;
    this.stats.evictions += removed;
    
    return removed;
  }
}

/**
 * Create a memoized version of a function.
 * 
 * @param {Function} fn - Function to memoize
 * @param {Object} options - Memoization options
 * @param {Function} options.keyGenerator - Key generator function (default: JSON.stringify)
 * @param {number} options.maxSize - Maximum cache size (default: 100)
 * @param {number} options.ttl - Time to live in milliseconds (default: 5 minutes)
 * @param {boolean} options.useWeakMap - Use WeakMap for garbage collection (default: false)
 * @returns {Function} - Memoized function
 */
export function memoize(fn, options = {}) {
  const config = { ...DEFAULT_CACHE_CONFIG, ...options };
  const cache = new MemoizationCache(config);
  
  return function(...args) {
    const key = config.keyGenerator(args);
    const cached = cache.get(key);
    
    if (cached !== undefined) {
      return cached;
    }
    
    const result = fn.apply(this, args);
    cache.set(key, result);
    
    return result;
  };
}

/**
 * Create a memoized function with custom cache key generation.
 * 
 * @param {Function} fn - Function to memoize
 * @param {Function} keyFn - Custom key generation function
 * @param {Object} options - Memoization options
 * @returns {Function} - Memoized function
 */
export function memoizeWithKey(fn, keyFn, options = {}) {
  return memoize(fn, { ...options, keyGenerator: keyFn });
}

/**
 * Create a memoized function that caches based on first argument only.
 * Useful for functions where the first argument is a unique identifier.
 * 
 * @param {Function} fn - Function to memoize
 * @param {Object} options - Memoization options
 * @returns {Function} - Memoized function
 */
export function memoizeByFirstArg(fn, options = {}) {
  return memoizeWithKey(fn, (args) => {
    if (args.length === 0) return 'no-args';
    return String(args[0]);
  }, options);
}

/**
 * Create a memoized function with TTL (time-based expiration).
 * 
 * @param {Function} fn - Function to memoize
 * @param {number} ttlMs - Time to live in milliseconds
 * @param {Object} options - Additional memoization options
 * @returns {Function} - Memoized function
 */
export function memoizeWithTTL(fn, ttlMs, options = {}) {
  return memoize(fn, { ...options, ttl: ttlMs });
}

/**
 * Create a memoized function that automatically invalidates when dependencies change.
 * 
 * @param {Function} fn - Function to memoize
 * @param {Function} dependencyFn - Function that returns dependency array
 * @param {Object} options - Memoization options
 * @returns {Function} - Memoized function with dependency tracking
 */
export function memoizeWithDependencies(fn, dependencyFn, options = {}) {
  const cache = new MemoizationCache(options);
  let lastDependencies = null;
  let lastResult = null;
  
  return function(...args) {
    const dependencies = dependencyFn.apply(this, args);
    
    // Check if dependencies changed
    if (lastDependencies && 
        dependencies.length === lastDependencies.length &&
        dependencies.every((dep, i) => dep === lastDependencies[i])) {
      // Dependencies unchanged, return cached result
      return lastResult;
    }
    
    // Dependencies changed, recompute
    lastDependencies = dependencies;
    lastResult = fn.apply(this, args);
    
    return lastResult;
  };
}

/**
 * Create a memoized class method decorator.
 * 
 * @param {Object} options - Memoization options
 * @returns {Function} - Method decorator
 */
export function memoizeMethod(options = {}) {
  return function(target, propertyName, descriptor) {
    if (typeof descriptor.value !== 'function') {
      throw new Error('@memoizeMethod can only be applied to methods');
    }
    
    const originalMethod = descriptor.value;
    const memoized = memoize(originalMethod, options);
    
    descriptor.value = function(...args) {
      return memoized.apply(this, args);
    };
    
    return descriptor;
  };
}

/**
 * Global cache registry for managing multiple caches.
 */
export class CacheRegistry {
  constructor() {
    this.caches = new Map();
  }
  
  /**
   * Create or get a named cache.
   * @param {string} name - Cache name
   * @param {Object} config - Cache configuration
   * @returns {MemoizationCache} - Cache instance
   */
  getCache(name, config = {}) {
    if (!this.caches.has(name)) {
      this.caches.set(name, new MemoizationCache(config));
    }
    
    return this.caches.get(name);
  }
  
  /**
   * Clear a specific cache.
   * @param {string} name - Cache name
   */
  clearCache(name) {
    const cache = this.caches.get(name);
    if (cache) {
      cache.clear();
    }
  }
  
  /**
   * Clear all caches.
   */
  clearAll() {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }
  
  /**
   * Get statistics for all caches.
   * @returns {Object} - Statistics by cache name
   */
  getStats() {
    const stats = {};
    
    for (const [name, cache] of this.caches.entries()) {
      stats[name] = cache.getStats();
    }
    
    return stats;
  }
  
  /**
   * Clean up expired entries in all caches.
   * @returns {Object} - Number of entries removed by cache name
   */
  cleanupAll() {
    const results = {};
    
    for (const [name, cache] of this.caches.entries()) {
      results[name] = cache.cleanup();
    }
    
    return results;
  }
}

/**
 * Global cache registry instance.
 */
export const globalCacheRegistry = new CacheRegistry();

/**
 * Pre-configured memoization functions for common use cases.
 */
export const memoization = {
  /**
   * Memoize actor computations (by actor ID).
   */
  actor: (fn, options = {}) => memoizeByFirstArg(fn, options),
  
  /**
   * Memoize item computations (by item ID).
   */
  item: (fn, options = {}) => memoizeByFirstArg(fn, options),
  
  /**
   * Memoize skill computations (by skill name).
   */
  skill: (fn, options = {}) => memoizeByFirstArg(fn, options),
  
  /**
   * Memoize with short TTL (1 minute).
   */
  shortTTL: (fn, options = {}) => memoizeWithTTL(fn, 60 * 1000, options),
  
  /**
   * Memoize with long TTL (1 hour).
   */
  longTTL: (fn, options = {}) => memoizeWithTTL(fn, 60 * 60 * 1000, options),
  
  /**
   * Memoize with no size limit.
   */
  unlimited: (fn, options = {}) => memoize(fn, { ...options, maxSize: 0 }),
};

/**
 * Utility to create a memoized version of expensive computations in UESRPG.
 * 
 * @param {string} cacheName - Name for the cache (for debugging)
 * @param {Function} computeFn - Computation function
 * @param {Object} options - Memoization options
 * @returns {Function} - Memoized computation function
 */
export function createUESRPGMemoizer(cacheName, computeFn, options = {}) {
  const cache = globalCacheRegistry.getCache(cacheName, options);
  
  return function(...args) {
    const key = options.keyGenerator ? options.keyGenerator(args) : JSON.stringify(args);
    const cached = cache.get(key);
    
    if (cached !== undefined) {
      return cached;
    }
    
    const result = computeFn.apply(this, args);
    cache.set(key, result);
    
    return result;
  };
}

/**
 * Clear all memoization caches in the system.
 */
export function clearAllMemoizationCaches() {
  globalCacheRegistry.clearAll();
}

/**
 * Get statistics for all memoization caches.
 */
export function getMemoizationStats() {
  return globalCacheRegistry.getStats();
}