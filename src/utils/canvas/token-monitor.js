/**
 * Token Update Monitor
 * 
 * Debounces and batches token update events to reduce redundant processing
 * across multiple subsystems. Integrates with the TokenSpatialIndex for
 * efficient spatial queries.
 * 
 * @module utils/canvas/token-monitor
 */

import { getTokenSpatialIndex } from './token-spatial-index.js';

/**
 * Token update monitor class
 */
export class TokenUpdateMonitor {
  constructor(options = {}) {
    // Configuration
    this.debounceMs = options.debounceMs || 50;
    this.batchSize = options.batchSize || 10;
    this.enabled = options.enabled !== false;
    this.debug = options.debug === true;
    this._hookIds = [];
    this._hooksRegistered = false;
    
    // State
    this.pendingUpdates = new Map(); // tokenId -> {tokenDoc, changed, timestamp}
    this.flushTimer = null;
    this.isFlushing = false;
    
    // Performance tracking
    this.stats = {
      updatesReceived: 0,
      updatesProcessed: 0,
      batchesProcessed: 0,
      debouncedUpdates: 0,
      immediateUpdates: 0
    };
    
    // Reference to spatial index
    this.spatialIndex = getTokenSpatialIndex();
    
    // Register hooks
    this.registerHooks();
  }
  
  /**
   * Register token update hooks
   */
  registerHooks() {
    if (this._hooksRegistered) return;
    
    // Token update hook with debouncing
    this._hookIds.push(['updateToken', Hooks.on('updateToken', (tokenDoc, changed, options, userId) => {
      this.handleTokenUpdate(tokenDoc, changed, options, userId);
    })]);
    
    // Token creation hook
    this._hookIds.push(['createToken', Hooks.on('createToken', (tokenDoc, options, userId) => {
      this.handleTokenCreate(tokenDoc, options, userId);
    })]);
    
    // Token deletion hook
    this._hookIds.push(['deleteToken', Hooks.on('deleteToken', (tokenDoc, options, userId) => {
      this.handleTokenDelete(tokenDoc, options, userId);
    })]);
    
    // Canvas lifecycle hooks
    this._hookIds.push(['canvasTearDown', Hooks.on('canvasTearDown', () => {
      this.clearPending();
    })]);
    
    this._hooksRegistered = true;
  }

  /**
   * Remove all registered Foundry hooks.
   */
  unregisterHooks() {
    for (const [event, hookId] of this._hookIds) {
      Hooks.off(event, hookId);
    }
    this._hookIds.length = 0;
    this._hooksRegistered = false;
  }

  /**
   * Release queued work and long-lived listeners.
   */
  shutdown() {
    this.clearPending();
    this.unregisterHooks();
  }
  
  /**
   * Handle token update event
   * @param {TokenDocument} tokenDoc
   * @param {Object} changed
   * @param {Object} options
   * @param {string} userId
   */
  handleTokenUpdate(tokenDoc, changed, options, userId) {
    if (!this.enabled) return;
    
    this.stats.updatesReceived++;
    
    // Check if this is a position update
    const isPositionUpdate = changed.x !== undefined || changed.y !== undefined;
    const isSignificantUpdate = isPositionUpdate ||
                               changed.rotation !== undefined ||
                               changed.width !== undefined ||
                               changed.height !== undefined;
    
    if (!isSignificantUpdate) {
      // Non-significant update, process immediately
      this.stats.immediateUpdates++;
      this.processImmediateUpdate(tokenDoc, changed);
      return;
    }
    
    // Debounce significant updates
    this.stats.debouncedUpdates++;
    this.queueTokenUpdate(tokenDoc, changed);
  }
  
  /**
   * Handle token creation
   * @param {TokenDocument} tokenDoc
   * @param {Object} options
   * @param {string} userId
   */
  handleTokenCreate(tokenDoc, options, userId) {
    if (!this.enabled) return;
    
    // Get token object from canvas
    const token = canvas.tokens?.get(tokenDoc.id);
    if (token) {
      // Register with spatial index immediately
      this.spatialIndex.registerToken(token);
    }
  }
  
  /**
   * Handle token deletion
   * @param {TokenDocument} tokenDoc
   * @param {Object} options
   * @param {string} userId
   */
  handleTokenDelete(tokenDoc, options, userId) {
    if (!this.enabled) return;
    
    // Remove from spatial index
    this.spatialIndex.unregisterToken(tokenDoc.id);
    
    // Remove from pending updates
    this.pendingUpdates.delete(tokenDoc.id);
  }
  
  /**
   * Queue a token update for debounced processing
   * @param {TokenDocument} tokenDoc
   * @param {Object} changed
   */
  queueTokenUpdate(tokenDoc, changed) {
    const tokenId = tokenDoc.id;
    
    this.pendingUpdates.set(tokenId, {
      tokenDoc,
      changed,
      timestamp: Date.now()
    });
    
    // Schedule flush
    this.scheduleFlush();
    
    // Check if we've reached batch size
    if (this.pendingUpdates.size >= this.batchSize) {
      this.flushPending();
    }
  }
  
  /**
   * Process immediate update (non-debounced)
   * @param {TokenDocument} tokenDoc
   * @param {Object} changed
   */
  processImmediateUpdate(tokenDoc, changed) {
    const token = canvas.tokens?.get(tokenDoc.id);
    if (!token) return;
    
    // Update spatial index immediately
    this.spatialIndex.queueTokenUpdate(token);
    
    // Notify immediate update
    Hooks.callAll('uesrpg.tokenUpdatedImmediate', tokenDoc, changed);
  }
  
  /**
   * Schedule a flush of pending updates
   */
  scheduleFlush() {
    if (this.flushTimer || this.isFlushing) return;
    
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPending();
    }, this.debounceMs);
  }
  
  /**
   * Flush all pending updates
   */
  flushPending() {
    if (this.isFlushing || this.pendingUpdates.size === 0) return;
    
    this.isFlushing = true;
    
    try {
      // Get all pending updates
      const updates = Array.from(this.pendingUpdates.values());
      this.pendingUpdates.clear();
      
      // Clear timer
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      
      // Process batch
      this.processBatch(updates);
      
      this.stats.batchesProcessed++;
      this.stats.updatesProcessed += updates.length;
      
    } finally {
      this.isFlushing = false;
    }
  }
  
  /**
   * Process a batch of token updates
   * @param {Array<Object>} updates
   */
  processBatch(updates) {
    if (updates.length === 0) return;
    
    // Group updates by token for spatial index
    const tokenUpdates = [];
    
    for (const { tokenDoc, changed } of updates) {
      const token = canvas.tokens?.get(tokenDoc.id);
      if (token) {
        tokenUpdates.push(token);
        
        // Update spatial index
        this.spatialIndex.queueTokenUpdate(token);
      }
    }
    
    // Process spatial index updates
    this.spatialIndex.processUpdateQueue();
    
    // Notify other systems of batched updates
    Hooks.callAll('uesrpg.tokensUpdatedBatch', updates);
    
    // Log if debug enabled
    if (this.debug && updates.length > 1) {
      console.debug(`TokenUpdateMonitor: Processed batch of ${updates.length} token updates`);
    }
  }
  
  /**
   * Clear all pending updates
   */
  clearPending() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    this.pendingUpdates.clear();
    this.isFlushing = false;
  }
  
  /**
   * Enable or disable the monitor
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    
    if (!enabled) {
      this.clearPending();
    }
  }
  
  /**
   * Get performance statistics
   * @returns {Object}
   */
  getStats() {
    const debouncedRate = this.stats.updatesReceived > 0
      ? (this.stats.debouncedUpdates / this.stats.updatesReceived) * 100
      : 0;
    
    const batchRate = this.stats.updatesProcessed > 0
      ? (this.stats.batchesProcessed / this.stats.updatesProcessed) * 100
      : 0;
    
    return {
      ...this.stats,
      pendingUpdates: this.pendingUpdates.size,
      debouncedRate: debouncedRate.toFixed(1),
      batchRate: batchRate.toFixed(1),
      enabled: this.enabled
    };
  }
  
  /**
   * Reset performance statistics
   */
  resetStats() {
    this.stats = {
      updatesReceived: 0,
      updatesProcessed: 0,
      batchesProcessed: 0,
      debouncedUpdates: 0,
      immediateUpdates: 0
    };
  }
}

/**
 * Singleton instance
 */
let singletonInstance = null;

/**
 * Get the singleton TokenUpdateMonitor instance
 * @param {Object} options
 * @returns {TokenUpdateMonitor}
 */
export function getTokenUpdateMonitor(options = {}) {
  if (!singletonInstance) {
    singletonInstance = new TokenUpdateMonitor(options);
  }
  return singletonInstance;
}

/**
 * Initialize the token update monitor system
 * @param {Object} config
 * @returns {TokenUpdateMonitor}
 */
export function initializeTokenUpdateMonitor(config = {}) {
  const monitor = getTokenUpdateMonitor(config);
  monitor.debug = config.debug === true;
  monitor.registerHooks();
  
  // Register debug commands if debug enabled
  if (config.debug) {
    game.uesrpg = game.uesrpg || {};
    game.uesrpg.debug = game.uesrpg.debug || {};
    game.uesrpg.debug.tokenUpdateMonitor = monitor;
    
    console.debug('TokenUpdateMonitor initialized with debug mode');
  }
  
  return monitor;
}
