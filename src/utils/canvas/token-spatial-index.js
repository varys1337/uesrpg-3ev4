/**
 * Token Spatial Index Service
 * 
 * Centralized service for efficient token spatial queries and distance calculations.
 * Maintains a spatial grid index for O(1) proximity lookups and caches distance
 * calculations to avoid redundant computations across subsystems.
 * 
 * @module utils/canvas/token-spatial-index
 */

/**
 * Token spatial index class
 */
export class TokenSpatialIndex {
  constructor(options = {}) {
    // Configuration
    this.gridSize = options.gridSize || 100; // pixels per grid cell
    this.maxCacheSize = options.maxCacheSize || 1000;
    this.enabled = options.enabled !== false;
    
    // Data stores
    this.tokens = new Map(); // tokenId -> {token, x, y, width, height, bounds}
    this.spatialGrid = new Map(); // gridKey -> Set<tokenId>
    this.distanceCache = new Map(); // `${id1}-${id2}` -> distance
    this.positionCache = new Map(); // tokenId -> {x, y} (cached position)
    
    // Update queue for batched processing
    this.updateQueue = new Set();
    this.idleCallbackId = null;
    this.isProcessing = false;
    
    // Performance tracking
    this.stats = {
      queries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      distanceCalculations: 0,
      gridLookups: 0
    };
    
    // Initialize if canvas is ready
    if (canvas?.scene) {
      this.initializeFromCanvas();
    }
    
    // Register canvas hooks
    this.registerHooks();
  }
  
  /**
   * Initialize index from current canvas tokens
   */
  initializeFromCanvas() {
    if (!canvas?.tokens?.placeables) return;
    
    const tokens = canvas.tokens.placeables;
    for (const token of tokens) {
      this.registerToken(token);
    }
    
    console.debug(`TokenSpatialIndex: Initialized with ${this.tokens.size} tokens`);
  }
  
  /**
   * Register canvas lifecycle hooks
   */
  registerHooks() {
    // Only register hooks once
    if (this._hooksRegistered) return;
    
    // Token creation
    Hooks.on('createToken', (tokenDoc, options, userId) => {
      const token = canvas.tokens?.get(tokenDoc.id);
      if (token) {
        this.registerToken(token);
      }
    });
    
    // Token update (debounced)
    Hooks.on('updateToken', (tokenDoc, changed, options, userId) => {
      if (changed.x !== undefined || changed.y !== undefined) {
        const token = canvas.tokens?.get(tokenDoc.id);
        if (token) {
          this.queueTokenUpdate(token);
        }
      }
    });
    
    // Token deletion
    Hooks.on('deleteToken', (tokenDoc, options, userId) => {
      this.unregisterToken(tokenDoc.id);
    });
    
    // Canvas tear down
    Hooks.on('canvasTearDown', () => {
      this.clear();
    });
    
    // Canvas ready
    Hooks.on('canvasReady', () => {
      this.initializeFromCanvas();
    });
    
    this._hooksRegistered = true;
  }
  
  /**
   * Register a token in the spatial index
   * @param {Token} token - The PIXI Token object
   */
  registerToken(token) {
    if (!token?.id || !this.enabled) return;
    
    const id = token.id;
    const position = this._getTokenPosition(token);
    
    this.tokens.set(id, {
      token,
      ...position,
      width: token.w || token.width || 1,
      height: token.h || token.height || 1,
      bounds: this._getTokenBounds(token)
    });
    
    this._addToSpatialGrid(id, position);
    this._invalidateDistanceCache(id);
    
    this._scheduleIdleUpdate();
  }
  
  /**
   * Unregister a token from the spatial index
   * @param {string} tokenId
   */
  unregisterToken(tokenId) {
    if (!this.tokens.has(tokenId)) return;
    
    const tokenData = this.tokens.get(tokenId);
    this._removeFromSpatialGrid(tokenId, tokenData);
    this._invalidateDistanceCache(tokenId);
    
    this.tokens.delete(tokenId);
    this.positionCache.delete(tokenId);
  }
  
  /**
   * Queue a token update for batched processing
   * @param {Token} token
   */
  queueTokenUpdate(token) {
    if (!token?.id || !this.enabled) return;
    
    this.updateQueue.add(token.id);
    this._scheduleIdleUpdate();
  }
  
  /**
   * Process all queued token updates
   */
  processUpdateQueue() {
    if (this.isProcessing || this.updateQueue.size === 0) return;
    
    this.isProcessing = true;
    
    try {
      const queue = Array.from(this.updateQueue);
      this.updateQueue.clear();
      
      for (const tokenId of queue) {
        const token = canvas.tokens?.get(tokenId);
        if (token && this.tokens.has(tokenId)) {
          this._updateTokenPosition(tokenId, token);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * Update token position in the index
   * @param {string} tokenId
   * @param {Token} token
   * @private
   */
  _updateTokenPosition(tokenId, token) {
    const oldData = this.tokens.get(tokenId);
    const newPosition = this._getTokenPosition(token);
    
    // Check if position actually changed
    if (oldData && oldData.x === newPosition.x && oldData.y === newPosition.y) {
      return;
    }
    
    // Update token data
    this.tokens.set(tokenId, {
      ...oldData,
      token,
      ...newPosition,
      bounds: this._getTokenBounds(token)
    });
    
    // Update spatial grid
    this._removeFromSpatialGrid(tokenId, oldData);
    this._addToSpatialGrid(tokenId, newPosition);
    
    // Invalidate distance cache for this token
    this._invalidateDistanceCache(tokenId);
    
    // Update position cache
    this.positionCache.set(tokenId, newPosition);
  }
  
  /**
   * Query tokens within a radius of a point
   * @param {number} centerX - X coordinate
   * @param {number} centerY - Y coordinate
   * @param {number} radius - Search radius in pixels
   * @param {Function} filter - Optional filter function (token -> boolean)
   * @returns {Array<{token: Token, distance: number}>}
   */
  queryRadius(centerX, centerY, radius, filter = null) {
    this.stats.queries++;
    
    if (!this.enabled || this.tokens.size === 0) {
      return [];
    }
    
    // Get grid cells that intersect the search radius
    const gridCells = this._getGridCellsForRadius(centerX, centerY, radius);
    const candidates = new Set();
    
    // Collect candidate tokens from relevant grid cells
    for (const cellKey of gridCells) {
      const cellTokens = this.spatialGrid.get(cellKey);
      if (!cellTokens) continue;
      
      this.stats.gridLookups++;
      for (const tokenId of cellTokens) {
        candidates.add(tokenId);
      }
    }
    
    // Filter by actual distance
    const results = [];
    for (const tokenId of candidates) {
      const tokenData = this.tokens.get(tokenId);
      if (!tokenData) continue;
      
      const distance = this._getDistance(
        centerX, centerY,
        tokenData.x, tokenData.y
      );
      
      if (distance <= radius && (!filter || filter(tokenData.token))) {
        results.push({
          token: tokenData.token,
          distance,
          tokenId,
          x: tokenData.x,
          y: tokenData.y
        });
      }
    }
    
    // Sort by distance (closest first)
    results.sort((a, b) => a.distance - b.distance);
    
    return results;
  }
  
  /**
   * Query tokens within a rectangular area
   * @param {number} x1 - Left coordinate
   * @param {number} y1 - Top coordinate
   * @param {number} x2 - Right coordinate
   * @param {number} y2 - Bottom coordinate
   * @param {Function} filter - Optional filter function
   * @returns {Array<Token>}
   */
  queryRectangle(x1, y1, x2, y2, filter = null) {
    this.stats.queries++;
    
    if (!this.enabled || this.tokens.size === 0) {
      return [];
    }
    
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    
    const gridCells = this._getGridCellsForRectangle(minX, minY, maxX, maxY);
    const candidates = new Set();
    const results = [];
    
    // Collect candidate tokens
    for (const cellKey of gridCells) {
      const cellTokens = this.spatialGrid.get(cellKey);
      if (!cellTokens) continue;
      
      this.stats.gridLookups++;
      for (const tokenId of cellTokens) {
        candidates.add(tokenId);
      }
    }
    
    // Filter by actual rectangle intersection
    for (const tokenId of candidates) {
      const tokenData = this.tokens.get(tokenId);
      if (!tokenData) continue;
      
      const { x, y, width, height } = tokenData;
      const tokenRight = x + width;
      const tokenBottom = y + height;
      
      if (x <= maxX && tokenRight >= minX &&
          y <= maxY && tokenBottom >= minY &&
          (!filter || filter(tokenData.token))) {
        results.push(tokenData.token);
      }
    }
    
    return results;
  }
  
  /**
   * Get cached distance between two tokens
   * @param {Token|string} tokenA - Token object or token ID
   * @param {Token|string} tokenB - Token object or token ID
   * @param {boolean} useChebyshev - Use Chebyshev distance (grid spaces)
   * @returns {number}
   */
  getDistance(tokenA, tokenB, useChebyshev = false) {
    const idA = typeof tokenA === 'string' ? tokenA : tokenA?.id;
    const idB = typeof tokenB === 'string' ? tokenB : tokenB?.id;
    
    if (!idA || !idB || idA === idB) return 0;
    
    const key = this._distanceKey(idA, idB, useChebyshev);
    
    // Check cache
    if (this.distanceCache.has(key)) {
      this.stats.cacheHits++;
      return this.distanceCache.get(key);
    }
    
    this.stats.cacheMisses++;
    this.stats.distanceCalculations++;
    
    // Get token positions
    const posA = this._getTokenPositionById(idA);
    const posB = this._getTokenPositionById(idB);
    
    if (!posA || !posB) {
      return Infinity;
    }
    
    // Calculate distance
    let distance;
    if (useChebyshev) {
      distance = Math.max(
        Math.abs(posA.x - posB.x),
        Math.abs(posA.y - posB.y)
      );
    } else {
      const dx = posA.x - posB.x;
      const dy = posA.y - posB.y;
      distance = Math.sqrt(dx * dx + dy * dy);
    }
    
    // Cache result (with LRU eviction if needed)
    if (this.distanceCache.size >= this.maxCacheSize) {
      const firstKey = this.distanceCache.keys().next().value;
      this.distanceCache.delete(firstKey);
    }
    
    this.distanceCache.set(key, distance);
    
    return distance;
  }
  
  /**
   * Get all tokens in the index
   * @returns {Array<Token>}
   */
  getAllTokens() {
    return Array.from(this.tokens.values()).map(data => data.token);
  }
  
  /**
   * Get token by ID
   * @param {string} tokenId
   * @returns {Token|null}
   */
  getToken(tokenId) {
    return this.tokens.get(tokenId)?.token || null;
  }
  
  /**
   * Get token position by ID
   * @param {string} tokenId
   * @returns {{x: number, y: number}|null}
   */
  getTokenPosition(tokenId) {
    return this.positionCache.get(tokenId) || null;
  }
  
  /**
   * Clear the entire index
   */
  clear() {
    this.tokens.clear();
    this.spatialGrid.clear();
    this.distanceCache.clear();
    this.positionCache.clear();
    this.updateQueue.clear();
    
    if (this.idleCallbackId) {
      cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }
    
    this.isProcessing = false;
  }
  
  /**
   * Enable or disable the index
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    
    if (!enabled) {
      this.clear();
    } else if (canvas?.scene) {
      this.initializeFromCanvas();
    }
  }
  
  /**
   * Get performance statistics
   * @returns {Object}
   */
  getStats() {
    const cacheHitRate = this.stats.cacheHits + this.stats.cacheMisses > 0
      ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100
      : 0;
    
    return {
      ...this.stats,
      tokenCount: this.tokens.size,
      gridCellCount: this.spatialGrid.size,
      cacheSize: this.distanceCache.size,
      cacheHitRate: cacheHitRate.toFixed(1),
      queueSize: this.updateQueue.size,
      enabled: this.enabled
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
      distanceCalculations: 0,
      gridLookups: 0
    };
  }
  
  // ===========================================================================
  // Private Methods
  // ===========================================================================
  
  /**
   * Get token position
   * @param {Token} token
   * @returns {{x: number, y: number}}
   * @private
   */
  _getTokenPosition(token) {
    return {
      x: token.x || token.document?.x || 0,
      y: token.y || token.document?.y || 0
    };
  }
  
  /**
   * Get token position by ID
   * @param {string} tokenId
   * @returns {{x: number, y: number}|null}
   * @private
   */
  _getTokenPositionById(tokenId) {
    // Check cache first
    if (this.positionCache.has(tokenId)) {
      return this.positionCache.get(tokenId);
    }
    
    // Check token data
    const tokenData = this.tokens.get(tokenId);
    if (tokenData) {
      const position = { x: tokenData.x, y: tokenData.y };
      this.positionCache.set(tokenId, position);
      return position;
    }
    
    // Fallback to canvas
    const token = canvas.tokens?.get(tokenId);
    if (token) {
      const position = this._getTokenPosition(token);
      this.positionCache.set(tokenId, position);
      return position;
    }
    
    return null;
  }
  
  /**
   * Get token bounding box
   * @param {Token} token
   * @returns {{x1: number, y1: number, x2: number, y2: number}}
   * @private
   */
  _getTokenBounds(token) {
    const x = token.x || token.document?.x || 0;
    const y = token.y || token.document?.y || 0;
    const width = token.w || token.width || 1;
    const height = token.h || token.height || 1;
    
    return {
      x1: x,
      y1: y,
      x2: x + width,
      y2: y + height
    };
  }
  
  /**
   * Add token to spatial grid
   * @param {string} tokenId
   * @param {{x: number, y: number}} position
   * @private
   */
  _addToSpatialGrid(tokenId, position) {
    const gridKey = this._positionToGridKey(position.x, position.y);
    
    if (!this.spatialGrid.has(gridKey)) {
      this.spatialGrid.set(gridKey, new Set());
    }
    
    this.spatialGrid.get(gridKey).add(tokenId);
  }
  
  /**
   * Remove token from spatial grid
   * @param {string} tokenId
   * @param {Object} tokenData
   * @private
   */
  _removeFromSpatialGrid(tokenId, tokenData) {
    if (!tokenData) return;
    
    const gridKey = this._positionToGridKey(tokenData.x, tokenData.y);
    const cell = this.spatialGrid.get(gridKey);
    
    if (cell) {
      cell.delete(tokenId);
      
      // Clean up empty cells
      if (cell.size === 0) {
        this.spatialGrid.delete(gridKey);
      }
    }
  }
  
  /**
   * Convert position to grid key
   * @param {number} x
   * @param {number} y
   * @returns {string}
   * @private
   */
  _positionToGridKey(x, y) {
    const gridX = Math.floor(x / this.gridSize);
    const gridY = Math.floor(y / this.gridSize);
    return `${gridX},${gridY}`;
  }
  
  /**
   * Get grid cells for a radius search
   * @param {number} centerX
   * @param {number} centerY
   * @param {number} radius
   * @returns {Array<string>}
   * @private
   */
  _getGridCellsForRadius(centerX, centerY, radius) {
    const cells = new Set();
    
    // Calculate grid bounds
    const minGridX = Math.floor((centerX - radius) / this.gridSize);
    const maxGridX = Math.floor((centerX + radius) / this.gridSize);
    const minGridY = Math.floor((centerY - radius) / this.gridSize);
    const maxGridY = Math.floor((centerY + radius) / this.gridSize);
    
    // Add all grid cells in the bounding rectangle
    for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
      for (let gridY = minGridY; gridY <= maxGridY; gridY++) {
        cells.add(`${gridX},${gridY}`);
      }
    }
    
    return Array.from(cells);
  }
  
  /**
   * Get grid cells for a rectangle
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @returns {Array<string>}
   * @private
   */
  _getGridCellsForRectangle(x1, y1, x2, y2) {
    const cells = new Set();
    
    const minGridX = Math.floor(x1 / this.gridSize);
    const maxGridX = Math.floor(x2 / this.gridSize);
    const minGridY = Math.floor(y1 / this.gridSize);
    const maxGridY = Math.floor(y2 / this.gridSize);
    
    for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
      for (let gridY = minGridY; gridY <= maxGridY; gridY++) {
        cells.add(`${gridX},${gridY}`);
      }
    }
    
    return Array.from(cells);
  }
  
  /**
   * Calculate Euclidean distance
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @returns {number}
   * @private
   */
  _getDistance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  /**
   * Generate distance cache key
   * @param {string} idA
   * @param {string} idB
   * @param {boolean} useChebyshev
   * @returns {string}
   * @private
   */
  _distanceKey(idA, idB, useChebyshev) {
    const sortedIds = [idA, idB].sort();
    return `${sortedIds[0]}-${sortedIds[1]}-${useChebyshev ? 'chebyshev' : 'euclidean'}`;
  }
  
  /**
   * Invalidate distance cache for a token
   * @param {string} tokenId
   * @private
   */
  _invalidateDistanceCache(tokenId) {
    const keysToDelete = [];
    
    for (const key of this.distanceCache.keys()) {
      if (key.includes(tokenId)) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.distanceCache.delete(key);
    }
  }
  
  /**
   * Schedule idle update processing
   * @private
   */
  _scheduleIdleUpdate() {
    if (this.idleCallbackId || !this.enabled) return;
    
    if (typeof requestIdleCallback === 'function') {
      this.idleCallbackId = requestIdleCallback(
        () => {
          this.idleCallbackId = null;
          this.processUpdateQueue();
        },
        { timeout: 100 }
      );
    } else {
      this.idleCallbackId = setTimeout(() => {
        this.idleCallbackId = null;
        this.processUpdateQueue();
      }, 0);
    }
  }
}

/**
 * Singleton instance
 */
let singletonInstance = null;

/**
 * Get the singleton TokenSpatialIndex instance
 * @param {Object} options
 * @returns {TokenSpatialIndex}
 */
export function getTokenSpatialIndex(options = {}) {
  if (!singletonInstance) {
    singletonInstance = new TokenSpatialIndex(options);
  }
  return singletonInstance;
}

/**
 * Initialize the token spatial index system
 * @param {Object} config
 * @returns {TokenSpatialIndex}
 */
export function initializeTokenSpatialIndex(config = {}) {
  const index = getTokenSpatialIndex(config);
  
  // Register debug commands if debug enabled
  if (config.debug) {
    game.uesrpg = game.uesrpg || {};
    game.uesrpg.debug = game.uesrpg.debug || {};
    game.uesrpg.debug.tokenSpatialIndex = index;
    
    console.debug('TokenSpatialIndex initialized with debug mode');
  }
  
  return index;
}