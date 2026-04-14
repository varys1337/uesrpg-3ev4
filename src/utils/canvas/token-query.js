/**
 * Token Query Utilities
 * 
 * Provides efficient token querying utilities that use the TokenSpatialIndex
 * instead of iterating over canvas.tokens.placeables directly.
 * 
 * @module utils/canvas/token-query
 */

import { getTokenSpatialIndex } from './token-spatial-index.js';

/**
 * Token query utilities class
 */
export class TokenQuery {
  constructor() {
    this.spatialIndex = getTokenSpatialIndex();
    this.cache = new Map();
    this.cacheTTL = 5000; // 5 seconds
    this.lastCleanup = Date.now();
    
    // Performance tracking
    this.stats = {
      queries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      directIterations: 0,
      spatialQueries: 0
    };
  }
  
  /**
   * Get all tokens on canvas (cached)
   * @param {Function} filter - Optional filter function
   * @param {boolean} forceRefresh - Force cache refresh
   * @returns {Array<Token>}
   */
  getAllTokens(filter = null, forceRefresh = false) {
    this.stats.queries++;
    
    // Generate cache key
    const cacheKey = filter ? `all:${filter.toString()}` : 'all';
    
    // Check cache
    if (!forceRefresh && this._checkCache(cacheKey)) {
      this.stats.cacheHits++;
      const cached = this.cache.get(cacheKey);
      return filter ? cached.filter(filter) : cached;
    }
    
    this.stats.cacheMisses++;
    
    // Get tokens from spatial index if available and enabled
    let tokens;
    if (this.spatialIndex.enabled && this.spatialIndex.tokens.size > 0) {
      this.stats.spatialQueries++;
      tokens = this.spatialIndex.getAllTokens();
    } else {
      // Fallback to direct iteration
      this.stats.directIterations++;
      tokens = canvas?.tokens?.placeables || [];
    }
    
    // Apply filter if provided
    const result = filter ? tokens.filter(filter) : tokens.slice();
    
    // Cache result
    this._setCache(cacheKey, result);
    
    return result;
  }
  
  /**
   * Get tokens within radius of a point
   * @param {number} x - Center X coordinate
   * @param {number} y - Center Y coordinate
   * @param {number} radius - Search radius in pixels
   * @param {Function} filter - Optional filter function
   * @returns {Array<{token: Token, distance: number}>}
   */
  getTokensInRadius(x, y, radius, filter = null) {
    this.stats.queries++;
    
    // Generate cache key
    const cacheKey = `radius:${x},${y},${radius}${filter ? `:${filter.toString()}` : ''}`;
    
    // Check cache
    if (this._checkCache(cacheKey)) {
      this.stats.cacheHits++;
      return this.cache.get(cacheKey);
    }
    
    this.stats.cacheMisses++;
    
    let results;
    if (this.spatialIndex.enabled) {
      this.stats.spatialQueries++;
      results = this.spatialIndex.queryRadius(x, y, radius, filter);
    } else {
      // Fallback to direct iteration
      this.stats.directIterations++;
      results = this._getTokensInRadiusFallback(x, y, radius, filter);
    }
    
    // Cache result
    this._setCache(cacheKey, results);
    
    return results;
  }
  
  /**
   * Get tokens within rectangle
   * @param {number} x1 - Left coordinate
   * @param {number} y1 - Top coordinate
   * @param {number} x2 - Right coordinate
   * @param {number} y2 - Bottom coordinate
   * @param {Function} filter - Optional filter function
   * @returns {Array<Token>}
   */
  getTokensInRectangle(x1, y1, x2, y2, filter = null) {
    this.stats.queries++;
    
    // Generate cache key
    const cacheKey = `rect:${x1},${y1},${x2},${y2}${filter ? `:${filter.toString()}` : ''}`;
    
    // Check cache
    if (this._checkCache(cacheKey)) {
      this.stats.cacheHits++;
      return this.cache.get(cacheKey);
    }
    
    this.stats.cacheMisses++;
    
    let tokens;
    if (this.spatialIndex.enabled) {
      this.stats.spatialQueries++;
      tokens = this.spatialIndex.queryRectangle(x1, y1, x2, y2, filter);
    } else {
      // Fallback to direct iteration
      this.stats.directIterations++;
      tokens = this._getTokensInRectangleFallback(x1, y1, x2, y2, filter);
    }
    
    // Cache result
    this._setCache(cacheKey, tokens);
    
    return tokens;
  }
  
  /**
   * Get distance between two tokens (cached)
   * @param {Token|string} tokenA
   * @param {Token|string} tokenB
   * @param {boolean} useChebyshev - Use Chebyshev distance
   * @returns {number}
   */
  getDistance(tokenA, tokenB, useChebyshev = false) {
    if (this.spatialIndex.enabled) {
      return this.spatialIndex.getDistance(tokenA, tokenB, useChebyshev);
    }
    
    // Fallback to direct calculation
    const posA = this._getTokenPosition(tokenA);
    const posB = this._getTokenPosition(tokenB);
    
    if (!posA || !posB) return Infinity;
    
    if (useChebyshev) {
      return Math.max(
        Math.abs(posA.x - posB.x),
        Math.abs(posA.y - posB.y)
      );
    }
    
    const dx = posA.x - posB.x;
    const dy = posA.y - posB.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  /**
   * Get tokens by actor ID
   * @param {string} actorId
   * @returns {Array<Token>}
   */
  getTokensByActorId(actorId) {
    this.stats.queries++;
    
    const cacheKey = `actor:${actorId}`;
    
    // Check cache
    if (this._checkCache(cacheKey)) {
      this.stats.cacheHits++;
      return this.cache.get(cacheKey);
    }
    
    this.stats.cacheMisses++;
    
    const filter = token => token?.actor?.id === actorId;
    const tokens = this.getAllTokens(filter, false);
    
    // Cache result
    this._setCache(cacheKey, tokens);
    
    return tokens;
  }
  
  /**
   * Get controlled tokens
   * @returns {Array<Token>}
   */
  getControlledTokens() {
    // This is already efficient in Foundry
    return canvas?.tokens?.controlled || [];
  }
  
  /**
   * Get tokens with specific disposition
   * @param {number} disposition - CONST.TOKEN_DISPOSITIONS value
   * @returns {Array<Token>}
   */
  getTokensByDisposition(disposition) {
    this.stats.queries++;
    
    const cacheKey = `disp:${disposition}`;
    
    // Check cache
    if (this._checkCache(cacheKey)) {
      this.stats.cacheHits++;
      return this.cache.get(cacheKey);
    }
    
    this.stats.cacheMisses++;
    
    const filter = token => token?.document?.disposition === disposition;
    const tokens = this.getAllTokens(filter, false);
    
    // Cache result
    this._setCache(cacheKey, tokens);
    
    return tokens;
  }
  
  /**
   * Clear query cache
   */
  clearCache() {
    this.cache.clear();
    this.lastCleanup = Date.now();
  }
  
  /**
   * Get performance statistics
   * @returns {Object}
   */
  getStats() {
    const cacheHitRate = this.stats.cacheHits + this.stats.cacheMisses > 0
      ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100
      : 0;
    
    const spatialQueryRate = this.stats.queries > 0
      ? (this.stats.spatialQueries / this.stats.queries) * 100
      : 0;
    
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      cacheHitRate: cacheHitRate.toFixed(1),
      spatialQueryRate: spatialQueryRate.toFixed(1),
      spatialIndexEnabled: this.spatialIndex.enabled
    };
  }
  
  /**
   * Reset performance statistics
   */
  resetStats() {
    this.stats = {
      queries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      directIterations: 0,
      spatialQueries: 0
    };
  }
  
  // ===========================================================================
  // Private Methods
  // ===========================================================================
  
  /**
   * Check if cache entry is valid
   * @param {string} key
   * @returns {boolean}
   * @private
   */
  _checkCache(key) {
    if (!this.cache.has(key)) return false;
    
    const entry = this.cache.get(key);
    const now = Date.now();
    
    // Check TTL
    if (now - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return false;
    }
    
    // Clean up old entries periodically
    if (now - this.lastCleanup > 30000) { // 30 seconds
      this._cleanupCache();
      this.lastCleanup = now;
    }
    
    return true;
  }
  
  /**
   * Set cache entry
   * @param {string} key
   * @param {any} value
   * @private
   */
  _setCache(key, value) {
    // Limit cache size
    if (this.cache.size >= 100) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }
  
  /**
   * Clean up expired cache entries
   * @private
   */
  _cleanupCache() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.cacheTTL) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
  
  /**
   * Fallback implementation for radius query
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {Function} filter
   * @returns {Array<{token: Token, distance: number}>}
   * @private
   */
  _getTokensInRadiusFallback(x, y, radius, filter) {
    const tokens = canvas?.tokens?.placeables || [];
    const results = [];
    
    for (const token of tokens) {
      if (!token) continue;
      
      const tokenX = token.x || token.document?.x || 0;
      const tokenY = token.y || token.document?.y || 0;
      
      const dx = x - tokenX;
      const dy = y - tokenY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= radius && (!filter || filter(token))) {
        results.push({ token, distance });
      }
    }
    
    // Sort by distance
    results.sort((a, b) => a.distance - b.distance);
    
    return results;
  }
  
  /**
   * Fallback implementation for rectangle query
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @param {Function} filter
   * @returns {Array<Token>}
   * @private
   */
  _getTokensInRectangleFallback(x1, y1, x2, y2, filter) {
    const tokens = canvas?.tokens?.placeables || [];
    const results = [];
    
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    
    for (const token of tokens) {
      if (!token) continue;
      
      const tokenX = token.x || token.document?.x || 0;
      const tokenY = token.y || token.document?.y || 0;
      const tokenWidth = token.w || token.width || 1;
      const tokenHeight = token.h || token.height || 1;
      
      const tokenRight = tokenX + tokenWidth;
      const tokenBottom = tokenY + tokenHeight;
      
      if (tokenX <= maxX && tokenRight >= minX &&
          tokenY <= maxY && tokenBottom >= minY &&
          (!filter || filter(token))) {
        results.push(token);
      }
    }
    
    return results;
  }
  
  /**
   * Get token position
   * @param {Token|string} token
   * @returns {{x: number, y: number}|null}
   * @private
   */
  _getTokenPosition(token) {
    if (typeof token === 'string') {
      const tokenObj = canvas.tokens?.get(token);
      if (!tokenObj) return null;
      return {
        x: tokenObj.x || tokenObj.document?.x || 0,
        y: tokenObj.y || tokenObj.document?.y || 0
      };
    }
    
    return {
      x: token.x || token.document?.x || 0,
      y: token.y || token.document?.y || 0
    };
  }
}

/**
 * Singleton instance
 */
let singletonInstance = null;

/**
 * Get the singleton TokenQuery instance
 * @returns {TokenQuery}
 */
export function getTokenQuery() {
  if (!singletonInstance) {
    singletonInstance = new TokenQuery();
  }
  return singletonInstance;
}

/**
 * Initialize the token query system
 * @param {Object} config
 * @returns {TokenQuery}
 */
export function initializeTokenQuery(config = {}) {
  const query = getTokenQuery();
  
  // Register debug commands if debug enabled
  if (config.debug) {
    game.uesrpg = game.uesrpg || {};
    game.uesrpg.debug = game.uesrpg.debug || {};
    game.uesrpg.debug.tokenQuery = query;
    
    console.debug('TokenQuery initialized with debug mode');
  }
  
  return query;
}

// =============================================================================
// Convenience Functions (for direct import)
// =============================================================================

/**
 * Get all tokens (convenience function)
 * @param {Function} filter
 * @returns {Array<Token>}
 */
export function getAllTokens(filter = null) {
  return getTokenQuery().getAllTokens(filter);
}

/**
 * Get tokens within radius (convenience function)
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {Function} filter
 * @returns {Array<{token: Token, distance: number}>}
 */
export function getTokensInRadius(x, y, radius, filter = null) {
  return getTokenQuery().getTokensInRadius(x, y, radius, filter);
}

/**
 * Get tokens within rectangle (convenience function)
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {Function} filter
 * @returns {Array<Token>}
 */
export function getTokensInRectangle(x1, y1, x2, y2, filter = null) {
  return getTokenQuery().getTokensInRectangle(x1, y1, x2, y2, filter);
}

/**
 * Get distance between tokens (convenience function)
 * @param {Token|string} tokenA
 * @param {Token|string} tokenB
 * @param {boolean} useChebyshev
 * @returns {number}
 */
export function getTokenDistance(tokenA, tokenB, useChebyshev = false) {
  return getTokenQuery().getDistance(tokenA, tokenB, useChebyshev);
}

/**
 * Get tokens by actor ID (convenience function)
 * @param {string} actorId
 * @returns {Array<Token>}
 */
export function getTokensByActorId(actorId) {
  return getTokenQuery().getTokensByActorId(actorId);
}