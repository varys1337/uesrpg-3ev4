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
      console.debug('CanvasOptimizationSystem: Initializing...');
      
      // Initialize spatial index
      if (this.config.spatialIndex.enabled) {
        this.spatialIndex = initializeTokenSpatialIndex({
          ...this.config.spatialIndex,
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
      
      console.debug(`CanvasOptimizationSystem: Initialized in ${this.stats.initializationTime}ms`);
      
    } catch (err) {
      console.error('CanvasOptimizationSystem: Failed to initialize', err);
      this.initialized = false;
    }
  }
  
  /**
   * Register system hooks
   */
  registerHooks() {
    if (this.hooksRegistered) return;
    
    // Canvas lifecycle hooks
    Hooks.on('canvasReady', () => {
      this.handleCanvasReady();
    });
    
    Hooks.on('canvasTearDown', () => {
      this.handleCanvasTearDown();
    });
    
    // World lifecycle hooks
    Hooks.once('worldUnload', () => {
      this.shutdown();
    });
    
    // Register batch update listener for other systems
    Hooks.on('uesrpg.tokensUpdatedBatch', (updates) => {
      this.handleTokensUpdatedBatch(updates);
    });
    
    // Register debug commands if debug enabled
    if (this.config.debug) {
      this.registerDebugCommands();
    }
    
    this.hooksRegistered = true;
  }
  
  /**
   * Handle canvas ready event
   */
  handleCanvasReady() {
    if (!this.initialized || !this.config.enabled) return;
    
    console.debug('CanvasOptimizationSystem: Canvas ready, reinitializing spatial index');
    
    // Reinitialize spatial index with current canvas tokens
    if (this.spatialIndex) {
      this.spatialIndex.initializeFromCanvas();
    }
  }
  
  /**
   * Handle canvas tear down event
   */
  handleCanvasTearDown() {
    if (!this.initialized) return;
    
    console.debug('CanvasOptimizationSystem: Canvas tearing down, clearing spatial index');
    
    // Clear spatial index but keep system initialized
    if (this.spatialIndex) {
      this.spatialIndex.clear();
    }
  }
  
  /**
   * Handle batched token updates
   * @param {Array} updates
   */
  handleTokensUpdatedBatch(updates) {
    this.stats.tokenUpdatesProcessed += updates.length;
    
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
    game.uesrpg.debug.getCanvasOptimizationStats = () => this.getStats();
    game.uesrpg.debug.resetCanvasOptimizationStats = () => this.resetStats();
    game.uesrpg.debug.enableCanvasOptimization = (enabled) => this.setEnabled(enabled);
    
    console.debug('CanvasOptimizationSystem: Debug commands registered');
  }
  
  /**
   * Shutdown the system
   */
  shutdown() {
    if (!this.initialized) return;
    
    console.debug('CanvasOptimizationSystem: Shutting down...');
    
    // Clear all subsystems
    if (this.spatialIndex) {
      this.spatialIndex.clear();
    }
    
    if (this.tokenMonitor) {
      this.tokenMonitor.clearPending();
    }
    
    if (this.tokenQuery) {
      this.tokenQuery.clearCache();
    }
    
    this.initialized = false;
    this.hooksRegistered = false;
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
      this.shutdown();
    }
    
    // Propagate to subsystems
    if (this.spatialIndex) {
      this.spatialIndex.setEnabled(enabled);
    }
    
    if (this.tokenMonitor) {
      this.tokenMonitor.setEnabled(enabled);
    }
    
    console.debug(`CanvasOptimizationSystem: ${enabled ? 'Enabled' : 'Disabled'}`);
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
    
    console.debug('CanvasOptimizationSystem: Statistics reset');
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