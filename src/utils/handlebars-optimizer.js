/**
 * Handlebars Optimizer
 * 
 * Provides caching and memoization for Handlebars helper functions
 * to reduce repeated computation during template rendering.
 * 
 * @module utils/handlebars-optimizer
 */

/**
 * Create an optimized version of a Handlebars helper with caching
 * @param {Function} originalHelper - Original helper function
 * @param {Object} options - Optimization options
 * @param {number} options.cacheSize - Maximum cache entries (default: 100)
 * @param {number} options.ttl - Cache time-to-live in ms (default: 5000)
 * @param {boolean} options.enabled - Enable caching (default: true)
 * @returns {Function} Optimized helper function
 */
export function createOptimizedHelper(originalHelper, options = {}) {
  const { cacheSize = 100, ttl = 5000, enabled = true } = options;
  
  if (!enabled) {
    return originalHelper;
  }
  
  const cache = new Map();
  const accessTimes = new Map();
  const stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0
  };
  
  // Generate cache key from arguments
  function generateCacheKey(args) {
    try {
      // Simplified cache key generation to avoid compatibility warnings
      // Use type-based identification instead of instanceof checks
      return JSON.stringify(args, (key, value) => {
        // Handle special cases without triggering getters
        if (value && typeof value === 'object') {
          // Check for common Foundry document patterns without instanceof
          const constructorName = value.constructor?.name;
          if (constructorName === 'Document' || constructorName === 'Actor' ||
              constructorName === 'Item' || constructorName === 'Token') {
            // Use safe property access with try-catch
            try {
              const id = value.id;
              const version = value._version || value.document?._version || '0';
              return `${constructorName}:${id || 'unknown'}:${version}`;
            } catch {
              return `${constructorName}:unknown`;
            }
          }
          
          // Handle other special types
          if (value instanceof RegExp) {
            return value.toString();
          }
          if (value instanceof Date) {
            return value.toISOString();
          }
          
          // For other objects, return a placeholder to avoid deep serialization
          // that might trigger warnings
          return `[Object:${constructorName || 'Object'}]`;
        }
        
        if (typeof value === 'function') {
          return `[Function:${value.name || 'anonymous'}]`;
        }
        
        return value;
      });
    } catch (error) {
      // Fallback to simple string concatenation
      return args.map(arg => {
        if (arg && typeof arg === 'object') {
          return `[Object:${arg.constructor?.name || 'Object'}]`;
        }
        return String(arg);
      }).join('|');
    }
  }
  
  // Clean up expired entries
  function cleanup() {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, { timestamp }] of cache) {
      if (now - timestamp > ttl) {
        cache.delete(key);
        accessTimes.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      stats.evictions += removed;
      stats.size = cache.size;
    }
    
    // Enforce cache size limit
    if (cache.size > cacheSize) {
      const entries = [...accessTimes.entries()];
      entries.sort((a, b) => a[1] - b[1]); // Sort by access time (oldest first)
      
      const toRemove = entries.slice(0, cache.size - cacheSize);
      for (const [key] of toRemove) {
        cache.delete(key);
        accessTimes.delete(key);
        stats.evictions++;
      }
      
      stats.size = cache.size;
    }
  }
  
  // Optimized helper function
  return function(...args) {
    if (!enabled) {
      stats.misses++;
      return originalHelper.apply(this, args);
    }
    
    const now = Date.now();
    const cacheKey = generateCacheKey(args);
    
    // Check cache
    if (cache.has(cacheKey)) {
      const { value, timestamp } = cache.get(cacheKey);
      
      // Check TTL
      if (now - timestamp < ttl) {
        accessTimes.set(cacheKey, now);
        stats.hits++;
        return value;
      }
      
      // Entry expired, remove it
      cache.delete(cacheKey);
      accessTimes.delete(cacheKey);
    }
    
    // Cache miss, execute original helper
    stats.misses++;
    const result = originalHelper.apply(this, args);
    
    // Cache the result
    cache.set(cacheKey, { value: result, timestamp: now });
    accessTimes.set(cacheKey, now);
    stats.size = cache.size;
    
    // Periodic cleanup
    if (stats.misses % 10 === 0) {
      cleanup();
    }
    
    return result;
  };
}

/**
 * Optimized helper registry
 */
export class OptimizedHelperRegistry {
  constructor() {
    this.optimizedHelpers = new Map();
    this.stats = {
      totalHelpers: 0,
      optimizedHelpers: 0,
      totalCacheHits: 0,
      totalCacheMisses: 0
    };
  }
  
  /**
   * Register an optimized helper
   * @param {string} name - Helper name
   * @param {Function} helper - Helper function
   * @param {Object} options - Optimization options
   */
  register(name, helper, options = {}) {
    const optimized = createOptimizedHelper(helper, options);
    
    // Store original for reference
    this.optimizedHelpers.set(name, {
      original: helper,
      optimized,
      options,
      stats: { hits: 0, misses: 0 }
    });
    
    // Register with Handlebars
    Handlebars.registerHelper(name, optimized);
    
    this.stats.totalHelpers++;
    this.stats.optimizedHelpers++;
    
    return optimized;
  }
  
  /**
   * Get helper statistics
   * @param {string} name - Helper name (optional)
   * @returns {Object}
   */
  getStats(name = null) {
    if (name) {
      const helper = this.optimizedHelpers.get(name);
      return helper ? helper.stats : null;
    }
    
    // Aggregate stats
    const aggregated = {
      ...this.stats,
      helpers: []
    };
    
    for (const [name, data] of this.optimizedHelpers) {
      aggregated.helpers.push({
        name,
        hits: data.stats.hits,
        misses: data.stats.misses,
        hitRate: data.stats.hits / (data.stats.hits + data.stats.misses) || 0
      });
      
      aggregated.totalCacheHits += data.stats.hits;
      aggregated.totalCacheMisses += data.stats.misses;
    }
    
    return aggregated;
  }
  
  /**
   * Clear all helper caches
   */
  clearCaches() {
    for (const [name, data] of this.optimizedHelpers) {
      // Recreate optimized helper to clear cache
      const optimized = createOptimizedHelper(data.original, data.options);
      Handlebars.registerHelper(name, optimized);
      
      // Update registry
      this.optimizedHelpers.set(name, {
        ...data,
        optimized,
        stats: { hits: 0, misses: 0 }
      });
    }
    
    console.log('OptimizedHelperRegistry: Cleared all helper caches');
  }
  
  /**
   * Disable optimization for a helper
   * @param {string} name - Helper name
   */
  disableOptimization(name) {
    const data = this.optimizedHelpers.get(name);
    if (!data) return;
    
    // Re-register original helper
    Handlebars.registerHelper(name, data.original);
    
    // Update registry
    this.optimizedHelpers.set(name, {
      ...data,
      optimized: data.original,
      options: { ...data.options, enabled: false }
    });
    
    this.stats.optimizedHelpers--;
    console.log(`OptimizedHelperRegistry: Disabled optimization for helper "${name}"`);
  }
  
  /**
   * Enable optimization for a helper
   * @param {string} name - Helper name
   * @param {Object} options - Optimization options
   */
  enableOptimization(name, options = {}) {
    const data = this.optimizedHelpers.get(name);
    if (!data) return;
    
    const optimized = createOptimizedHelper(data.original, options);
    
    // Re-register optimized helper
    Handlebars.registerHelper(name, optimized);
    
    // Update registry
    this.optimizedHelpers.set(name, {
      ...data,
      optimized,
      options: { ...data.options, ...options, enabled: true }
    });
    
    this.stats.optimizedHelpers++;
    console.log(`OptimizedHelperRegistry: Enabled optimization for helper "${name}"`);
  }
}

/**
 * Singleton instance
 */
let singletonRegistry = null;

/**
 * Get the singleton OptimizedHelperRegistry instance
 * @returns {OptimizedHelperRegistry}
 */
export function getOptimizedHelperRegistry() {
  if (!singletonRegistry) {
    singletonRegistry = new OptimizedHelperRegistry();
  }
  return singletonRegistry;
}

/**
 * Initialize optimized helper registry
 * @param {Object} options
 * @returns {OptimizedHelperRegistry}
 */
export function initializeOptimizedHelpers(options = {}) {
  const registry = getOptimizedHelperRegistry();
  
  const { debug = false } = options;
  
  if (debug) {
    console.log('OptimizedHelperRegistry: Initialized', registry.getStats());
  }
  
  return registry;
}

/**
 * Common optimized helpers for UESRPG system
 */
export const COMMON_OPTIMIZED_HELPERS = {
  // String helpers
  capitalize: function(str) {
    const s = String(str || "");
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  
  lowercase: function(str) {
    return String(str || "").toLowerCase();
  },
  
  uppercase: function(str) {
    return String(str || "").toUpperCase();
  },
  
  truncate: function(str, length) {
    const s = String(str || "");
    if (s.length <= length) return s;
    return s.substring(0, length) + "...";
  },
  
  // Number helpers
  formatNumber: function(num, decimals = 0) {
    const n = Number(num);
    if (!Number.isFinite(n)) return String(num || "");
    return n.toFixed(decimals);
  },
  
  add: function(a, b) {
    return (Number(a) || 0) + (Number(b) || 0);
  },
  
  subtract: function(a, b) {
    return (Number(a) || 0) - (Number(b) || 0);
  },
  
  multiply: function(a, b) {
    return (Number(a) || 0) * (Number(b) || 0);
  },
  
  divide: function(a, b) {
    const divisor = Number(b) || 1;
    return (Number(a) || 0) / divisor;
  },
  
  // Comparison helpers
  gt: function(a, b) {
    return (Number(a) || 0) > (Number(b) || 0);
  },
  
  lt: function(a, b) {
    return (Number(a) || 0) < (Number(b) || 0);
  },
  
  eq: function(a, b) {
    return a === b;
  },
  
  ne: function(a, b) {
    return a !== b;
  },
  
  // Array helpers
  length: function(array) {
    return Array.isArray(array) ? array.length : 0;
  },
  
  first: function(array) {
    return Array.isArray(array) && array.length > 0 ? array[0] : null;
  },
  
  last: function(array) {
    return Array.isArray(array) && array.length > 0 ? array[array.length - 1] : null;
  },
  
  // Object helpers
  hasProperty: function(obj, prop) {
    return obj && typeof obj === 'object' && prop in obj;
  },
  
  getProperty: function(obj, prop) {
    return obj && typeof obj === 'object' ? obj[prop] : undefined;
  },
  
  // System-specific helpers
  isGM: function() {
    return game.user?.isGM || false;
  },
  
  isOwner: function(document) {
    return document?.isOwner || false;
  },
  
  setting: function(key) {
    return game.settings?.get("uesrpg-3ev4", key);
  }
};

/**
 * Register common optimized helpers
 * @param {Object} options - Optimization options for all helpers
 */
export function registerCommonOptimizedHelpers(options = {}) {
  const registry = getOptimizedHelperRegistry();
  
  for (const [name, helper] of Object.entries(COMMON_OPTIMIZED_HELPERS)) {
    registry.register(name, helper, options);
  }
  
  console.log(`OptimizedHelperRegistry: Registered ${Object.keys(COMMON_OPTIMIZED_HELPERS).length} common helpers`);
}

/**
 * Get optimization statistics
 * @returns {Object}
 */
export function getOptimizationStats() {
  const registry = getOptimizedHelperRegistry();
  return registry.getStats();
}

/**
 * Clear all helper caches
 */
export function clearHelperCaches() {
  const registry = getOptimizedHelperRegistry();
  registry.clearCaches();
}