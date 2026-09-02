/**
 * Canvas Optimization System
 * 
 * Main entry point for canvas and token performance optimizations.
 * Initializes all canvas optimization subsystems and provides integration
 * with the existing hook throttling system.
 * 
 * @module utils/canvas/canvas-optimization
 */

import { initializeTokenSpatialIndex } from './token-spatial-index.js';
import { initializeTokenUpdateMonitor } from './token-monitor.js';
import { initializeTokenQuery } from './token-query.js';

/**
 * Canvas optimization system class
 */
export class CanvasOptimizationSystem {
  constructor(config = {}) {
    // Configuration
    this.config = {
      enabled: config.enabled !== false,
      debug: config.debug || false,
      spatialIndex: {
        enabled: true,
        gridSize: 100,
        maxCacheSize: 1000,
        ...config.spatialIndex
      },
      tokenMonitor: {
        enabled: true,
        debounceMs: 50,
        batchSize: 10,
        ...config.tokenMonitor
      },
      tokenQuery: {
        enabled: true,
        cacheTTL: 5000,
        ...config.tokenQuery
      }
    };
    
    // Subsystems
    this.spatialIndex = null;
    this.tokenMonitor = null;
    this.tokenQuery = null;
    
    // State
    this.initialized = false;
    this.hooksRegistered = false;
    this._hookIds = [];
    this._debugCommands = null;
    
    // Performance tracking
    this.stats = {
      initializationTime: 0,
      tokenUpdatesProcessed: 0,
      spatialQueries: 0,
      cacheHits: 0
    };
  }
  
  /**
   * Initialize all canvas optimization subsystems
   */
  initialize() {
    if (this.initialized || !this.config.enabled) return;
    
    const startTime = Date.now();
    
    try {
      if (this.config.debug) {
        console.debug('CanvasOptimizationSystem: Initializing...');
      }
      
      // Initialize spatial index
      if (this.config.spatialIndex.enabled) {
        this.spatialIndex = initializeTokenSpatialIndex({
          ...this.config.spatialIndex,
          manageTokenHooks: !this.config.tokenMonitor.enabled,
          debug: this.config.debug
        });
      }
      
      // Initialize token monitor
      if (this.config.tokenMonitor.enabled) {
        this.tokenMonitor = initializeTokenUpdateMonitor({
          ...this.config.tokenMonitor,
          debug: this.config.debug
        });
      }
      
      // Initialize token query
      if (this.config.tokenQuery.enabled) {
        this.tokenQuery = initializeTokenQuery({
          ...this.config.tokenQuery,
          debug: this.config.debug
        });
      }
      
      // Register hooks
      this.registerHooks();
      
      this.initialized = true;
      this.stats.initializationTime = Date.now() - startTime;
      
      if (this.config.debug) {
        console.debug(`CanvasOptimizationSystem: Initialized in ${this.stats.initializationTime}ms`);
      }
      
    } catch (err) {
      console.error('CanvasOptimizationSystem: Failed to initialize', err);
      this.shutdown();
    }
  }
  
  /**
   * Register system hooks
   */
  registerHooks() {
    if (this.hooksRegistered) return;
    
    // World lifecycle hooks
    this._hookIds.push(['worldUnload', Hooks.once('worldUnload', () => {
      this.shutdown();
    })]);
    
    // Register batch update listener for other systems
    this._hookIds.push(['uesrpg.tokensUpdatedBatch', Hooks.on('uesrpg.tokensUpdatedBatch', (updates) => {
      this.handleTokensUpdatedBatch(updates);
    })]);

    // Query results can become stale when tokens are created, deleted, or
    // receive an update which is intentionally processed without batching.
    this._hookIds.push(['createToken', Hooks.on('createToken', () => {
      this.tokenQuery?.clearCache();
    })]);
    this._hookIds.push(['deleteToken', Hooks.on('deleteToken', () => {
      this.tokenQuery?.clearCache();
    })]);
    this._hookIds.push(['uesrpg.tokenUpdatedImmediate', Hooks.on('uesrpg.tokenUpdatedImmediate', () => {
      this.tokenQuery?.clearCache();
    })]);
    
    // Register debug commands if debug enabled
    if (this.config.debug) {
      this.registerDebugCommands();
    }
    
    this.hooksRegistered = true;
  }

  /**
   * Remove all registered Foundry hooks.
   */
  unregisterHooks() {
    for (const [event, hookId] of this._hookIds) {
      Hooks.off(event, hookId);
    }
    this._hookIds.length = 0;
    this.hooksRegistered = false;
  }
  
  /**
   * Handle batched token updates
   * @param {Array} updates
   */
  handleTokensUpdatedBatch(updates) {
    this.stats.tokenUpdatesProcessed += updates.length;
    this.tokenQuery?.clearCache();
    
    // Update statistics
    if (this.spatialIndex) {
      const spatialStats = this.spatialIndex.getStats();
      this.stats.spatialQueries = spatialStats.queries;
    }
    
    if (this.tokenQuery) {
      const queryStats = this.tokenQuery.getStats();
      this.stats.cacheHits = queryStats.cacheHits;
    }
  }
  
  /**
   * Register debug commands
   */
  registerDebugCommands() {
    game.uesrpg = game.uesrpg || {};
    game.uesrpg.debug = game.uesrpg.debug || {};
    
    // Canvas optimization commands
    game.uesrpg.debug.canvasOptimization = this;
    
    // Individual subsystem access
    if (this.spatialIndex) {
      game.uesrpg.debug.tokenSpatialIndex = this.spatialIndex;
    }
    
    if (this.tokenMonitor) {
      game.uesrpg.debug.tokenUpdateMonitor = this.tokenMonitor;
    }
    
    if (this.tokenQuery) {
      game.uesrpg.debug.tokenQuery = this.tokenQuery;
    }
    
    // Utility commands
    this._debugCommands = {
      getStats: () => this.getStats(),
      resetStats: () => this.resetStats(),
      setEnabled: (enabled) => this.setEnabled(enabled),
    };
    game.uesrpg.debug.getCanvasOptimizationStats = this._debugCommands.getStats;
    game.uesrpg.debug.resetCanvasOptimizationStats = this._debugCommands.resetStats;
    game.uesrpg.debug.enableCanvasOptimization = this._debugCommands.setEnabled;
    
    console.debug('CanvasOptimizationSystem: Debug commands registered');
  }

  /**
   * Remove debug commands owned by this instance without disturbing other tools.
   */
  unregisterDebugCommands() {
    const debug = game?.uesrpg?.debug;
    if (!debug) return;

    if (debug.canvasOptimization === this) delete debug.canvasOptimization;
    if (debug.tokenSpatialIndex === this.spatialIndex) delete debug.tokenSpatialIndex;
    if (debug.tokenUpdateMonitor === this.tokenMonitor) delete debug.tokenUpdateMonitor;
    if (debug.tokenQuery === this.tokenQuery) delete debug.tokenQuery;
    if (debug.getCanvasOptimizationStats === this._debugCommands?.getStats) {
      delete debug.getCanvasOptimizationStats;
    }
    if (debug.resetCanvasOptimizationStats === this._debugCommands?.resetStats) {
      delete debug.resetCanvasOptimizationStats;
    }
    if (debug.enableCanvasOptimization === this._debugCommands?.setEnabled) {
      delete debug.enableCanvasOptimization;
    }
    this._debugCommands = null;
  }
  
  /**
   * Shutdown the system
   */
  shutdown({ removeDebugCommands = true } = {}) {
    if (this.config.debug && (this.initialized || this.hooksRegistered)) {
      console.debug('CanvasOptimizationSystem: Shutting down...');
    }
    
    // Clear all subsystems
    if (this.spatialIndex) {
      this.spatialIndex.shutdown();
    }
    
    if (this.tokenMonitor) {
      this.tokenMonitor.shutdown();
    }
    
    if (this.tokenQuery) {
      this.tokenQuery.clearCache();
    }

    this.unregisterHooks();
    if (removeDebugCommands) this.unregisterDebugCommands();
    
    this.initialized = false;
  }
  
  /**
   * Enable or disable the system
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    
    if (enabled && !this.initialized) {
      this.initialize();
    } else if (!enabled && this.initialized) {
      this.shutdown({ removeDebugCommands: false });
    }
    
    // Propagate to subsystems
    if (this.spatialIndex) {
      this.spatialIndex.setEnabled(enabled);
    }
    
    if (this.tokenMonitor) {
      this.tokenMonitor.setEnabled(enabled);
    }
    
    if (this.config.debug) {
      console.debug(`CanvasOptimizationSystem: ${enabled ? 'Enabled' : 'Disabled'}`);
    }
  }
  
  /**
   * Get system statistics
   * @returns {Object}
   */
  getStats() {
    const stats = {
      ...this.stats,
      initialized: this.initialized,
      enabled: this.config.enabled,
      subsystems: {}
    };
    
    // Add subsystem stats
    if (this.spatialIndex) {
      stats.subsystems.spatialIndex = this.spatialIndex.getStats();
    }
    
    if (this.tokenMonitor) {
      stats.subsystems.tokenMonitor = this.tokenMonitor.getStats();
    }
    
    if (this.tokenQuery) {
      stats.subsystems.tokenQuery = this.tokenQuery.getStats();
    }
    
    return stats;
  }
  
  /**
   * Reset all statistics
   */
  resetStats() {
    this.stats = {
      initializationTime: this.stats.initializationTime,
      tokenUpdatesProcessed: 0,
      spatialQueries: 0,
      cacheHits: 0
    };
    
    // Reset subsystem stats
    if (this.spatialIndex) {
      this.spatialIndex.resetStats();
    }
    
    if (this.tokenMonitor) {
      this.tokenMonitor.resetStats();
    }
    
    if (this.tokenQuery) {
      this.tokenQuery.resetStats();
    }
    
    if (this.config.debug) {
      console.debug('CanvasOptimizationSystem: Statistics reset');
    }
  }
  
  /**
   * Get spatial index instance
   * @returns {TokenSpatialIndex|null}
   */
  getSpatialIndex() {
    return this.spatialIndex;
  }
  
  /**
   * Get token monitor instance
   * @returns {TokenUpdateMonitor|null}
   */
  getTokenMonitor() {
    return this.tokenMonitor;
  }
  
  /**
   * Get token query instance
   * @returns {TokenQuery|null}
   */
  getTokenQuery() {
    return this.tokenQuery;
  }
}

/**
 * Singleton instance
 */
let singletonInstance = null;

/**
 * Get the singleton CanvasOptimizationSystem instance
 * @param {Object} config
 * @returns {CanvasOptimizationSystem}
 */
export function getCanvasOptimizationSystem(config = {}) {
  if (!singletonInstance) {
    singletonInstance = new CanvasOptimizationSystem(config);
  }
  return singletonInstance;
}

/**
 * Initialize the canvas optimization system
 * @param {Object} config
 * @returns {CanvasOptimizationSystem}
 */
export function initializeCanvasOptimization(config = {}) {
  const system = getCanvasOptimizationSystem(config);
  
  // Initialize if not already initialized
  if (!system.initialized && config.enabled !== false) {
    system.initialize();
  }
  
  return system;
}

/**
 * Check if canvas optimization is enabled
 * @returns {boolean}
 */
export function isCanvasOptimizationEnabled() {
  const system = singletonInstance;
  return system?.initialized && system.config.enabled;
}

/**
 * Enable or disable canvas optimization at runtime
 * @param {boolean} enabled
 */
export function setCanvasOptimizationEnabled(enabled) {
  const system = getCanvasOptimizationSystem();
  system.setEnabled(enabled);
}

/**
 * Get canvas optimization statistics
 * @returns {Object|null}
 */
export function getCanvasOptimizationStats() {
  const system = singletonInstance;
  return system ? system.getStats() : null;
}
