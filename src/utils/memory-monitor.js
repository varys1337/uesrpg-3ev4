/**
 * Memory monitoring utility for detecting potential memory leaks in long-running sessions.
 * 
 * This module tracks cache sizes over time, logs warnings when caches grow beyond
 * expected limits, and provides debug commands to dump memory usage statistics.
 * 
 * @module memory-monitor
 */

/**
 * Default configuration for memory monitoring.
 */
const DEFAULT_CONFIG = {
  enabled: true,
  sampleInterval: 60 * 1000, // 1 minute between samples
  warningThresholds: {
    templateCache: 500,      // Maximum expected template cache entries
    memoizationCache: 1000,  // Maximum expected memoization entries
    tokenQueryCache: 500,    // Maximum expected token query entries
    spatialIndexCache: 2000, // Maximum expected spatial index entries
    handlebarsHelperCache: 200, // Maximum expected helper cache entries
  },
  logLevel: 'warn',          // 'debug', 'info', 'warn', 'error'
  trackGrowthRate: true,     // Track growth rate over time
  maxHistory: 60,            // Keep up to 60 samples (1 hour at 1-minute intervals)
};

/**
 * Memory sample containing cache statistics at a point in time.
 */
class MemorySample {
  constructor(timestamp = Date.now()) {
    this.timestamp = timestamp;
    this.cacheSizes = {};
    this.totalEstimatedSize = 0;
    this.warnings = [];
  }
}

/**
 * Memory monitoring system.
 */
export class MemoryMonitor {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.samples = [];
    this.isMonitoring = false;
    this.intervalId = null;
    this.stats = {
      samplesTaken: 0,
      warningsIssued: 0,
      maxCacheSizeObserved: {},
    };
  }

  /**
   * Start monitoring memory usage.
   */
  start() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.intervalId = setInterval(() => this._takeSample(), this.config.sampleInterval);
    
    // Take initial sample
    this._takeSample();
    
    console.log('UESRPG | Memory monitoring started');
  }

  /**
   * Stop monitoring memory usage.
   */
  stop() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    console.log('UESRPG | Memory monitoring stopped');
  }

  /**
   * Take a memory sample.
   */
  _takeSample() {
    const sample = new MemorySample();
    
    try {
      // Collect cache sizes from various systems
      this._collectCacheSizes(sample);
      
      // Check for warnings
      this._checkThresholds(sample);
      
      // Store sample
      this.samples.push(sample);
      this.stats.samplesTaken++;
      
      // Trim history if needed
      if (this.samples.length > this.config.maxHistory) {
        this.samples.shift();
      }
      
      // Log warnings if any
      if (sample.warnings.length > 0 && this.config.logLevel !== 'debug') {
        sample.warnings.forEach(warning => {
          console.warn(`UESRPG | Memory warning: ${warning}`);
        });
        this.stats.warningsIssued += sample.warnings.length;
      }
      
      // Update max observed sizes
      for (const [cacheName, size] of Object.entries(sample.cacheSizes)) {
        const currentMax = this.stats.maxCacheSizeObserved[cacheName] || 0;
        if (size > currentMax) {
          this.stats.maxCacheSizeObserved[cacheName] = size;
        }
      }
      
    } catch (error) {
      console.error('UESRPG | Error taking memory sample:', error);
    }
  }

  /**
   * Collect cache sizes from various systems.
   */
  _collectCacheSizes(sample) {
    // Try to get template cache stats
    try {
      const templateCache = game.uesrpg?.templateCache;
      if (templateCache?.cache) {
        sample.cacheSizes.templateCache = templateCache.cache.size;
        sample.totalEstimatedSize += templateCache.cache.size * 1024; // Rough estimate
      }
    } catch (e) { /* Ignore if not available */ }
    
    // Try to get memoization cache stats
    try {
      const memoization = game.uesrpg?.memoization;
      if (memoization?.cache) {
        sample.cacheSizes.memoizationCache = memoization.cache.size;
        sample.totalEstimatedSize += memoization.cache.size * 512; // Rough estimate
      }
    } catch (e) { /* Ignore if not available */ }
    
    // Try to get token query cache stats
    try {
      const tokenQuery = game.uesrpg?.tokenQuery;
      if (tokenQuery?.cache) {
        sample.cacheSizes.tokenQueryCache = tokenQuery.cache.size;
        sample.totalEstimatedSize += tokenQuery.cache.size * 256; // Rough estimate
      }
    } catch (e) { /* Ignore if not available */ }
    
    // Try to get spatial index cache stats
    try {
      const spatialIndex = game.uesrpg?.spatialIndex;
      if (spatialIndex?.cache) {
        sample.cacheSizes.spatialIndexCache = spatialIndex.cache.size;
        sample.totalEstimatedSize += spatialIndex.cache.size * 128; // Rough estimate
      }
    } catch (e) { /* Ignore if not available */ }
    
    // Try to get handlebars helper cache stats
    try {
      const handlebarsOptimizer = game.uesrpg?.handlebarsOptimizer;
      if (handlebarsOptimizer?.cache) {
        sample.cacheSizes.handlebarsHelperCache = handlebarsOptimizer.cache.size;
        sample.totalEstimatedSize += handlebarsOptimizer.cache.size * 256; // Rough estimate
      }
    } catch (e) { /* Ignore if not available */ }
    
    // Try to get sheet cache stats
    try {
      const sheetCache = game.uesrpg?.sheetCache;
      if (sheetCache?.cache) {
        sample.cacheSizes.sheetCache = sheetCache.cache.size;
        sample.totalEstimatedSize += sheetCache.cache.size * 1024; // Rough estimate
      }
    } catch (e) { /* Ignore if not available */ }
  }

  /**
   * Check cache sizes against warning thresholds.
   */
  _checkThresholds(sample) {
    const thresholds = this.config.warningThresholds;
    
    for (const [cacheName, size] of Object.entries(sample.cacheSizes)) {
      const threshold = thresholds[cacheName];
      if (threshold && size > threshold) {
        sample.warnings.push(
          `${cacheName} size (${size}) exceeds warning threshold (${threshold})`
        );
      }
    }
    
    // Check for rapid growth if we have previous samples
    if (this.config.trackGrowthRate && this.samples.length >= 2) {
      const previousSample = this.samples[this.samples.length - 1];
      const timeDiff = sample.timestamp - previousSample.timestamp;
      
      if (timeDiff > 0) {
        for (const [cacheName, currentSize] of Object.entries(sample.cacheSizes)) {
          const previousSize = previousSample.cacheSizes[cacheName];
          if (previousSize !== undefined && currentSize > previousSize) {
            const growth = currentSize - previousSize;
            const growthRate = growth / (timeDiff / 1000); // per second
            
            if (growthRate > 10) { // More than 10 entries per second
              sample.warnings.push(
                `${cacheName} growing rapidly: ${growth} entries in ${Math.round(timeDiff/1000)}s (${growthRate.toFixed(1)}/s)`
              );
            }
          }
        }
      }
    }
  }

  /**
   * Get current memory statistics.
   */
  getStats() {
    const latestSample = this.samples.length > 0 ? this.samples[this.samples.length - 1] : null;
    
    return {
      isMonitoring: this.isMonitoring,
      samplesTaken: this.stats.samplesTaken,
      warningsIssued: this.stats.warningsIssued,
      maxCacheSizeObserved: { ...this.stats.maxCacheSizeObserved },
      currentCacheSizes: latestSample ? { ...latestSample.cacheSizes } : {},
      currentWarnings: latestSample ? [...latestSample.warnings] : [],
      config: { ...this.config },
    };
  }

  /**
   * Get memory usage history for charting.
   */
  getHistory(cacheName = null) {
    if (!cacheName) {
      // Return all cache histories
      const result = {};
      for (const sample of this.samples) {
        for (const [name, size] of Object.entries(sample.cacheSizes)) {
          if (!result[name]) result[name] = [];
          result[name].push({
            timestamp: sample.timestamp,
            size,
          });
        }
      }
      return result;
    } else {
      // Return specific cache history
      return this.samples
        .filter(sample => sample.cacheSizes[cacheName] !== undefined)
        .map(sample => ({
          timestamp: sample.timestamp,
          size: sample.cacheSizes[cacheName],
        }));
    }
  }

  /**
   * Clear memory samples and reset statistics.
   */
  clearHistory() {
    this.samples = [];
    this.stats = {
      samplesTaken: 0,
      warningsIssued: 0,
      maxCacheSizeObserved: {},
    };
  }

  /**
   * Export memory data for debugging.
   */
  exportData() {
    return {
      samples: this.samples.map(s => ({
        timestamp: s.timestamp,
        cacheSizes: s.cacheSizes,
        warnings: s.warnings,
      })),
      stats: this.stats,
      config: this.config,
    };
  }
}

/**
 * Global memory monitor instance.
 */
let globalMemoryMonitor = null;

/**
 * Get or create the global memory monitor.
 */
export function getMemoryMonitor(config = {}) {
  if (!globalMemoryMonitor) {
    globalMemoryMonitor = new MemoryMonitor(config);
  }
  return globalMemoryMonitor;
}

/**
 * Initialize memory monitoring.
 */
export function initializeMemoryMonitoring(config = {}) {
  const monitor = getMemoryMonitor(config);
  
  // Only start automatically if enabled in config
  if (config.enabled !== false) {
    // Wait for game to be ready
    Hooks.once('ready', () => {
      // Small delay to let other systems initialize
      setTimeout(() => monitor.start(), 5000);
    });
  }
  
  // Register debug command
  registerMemoryDebugCommand();
  
  return monitor;
}

/**
 * Register debug command for memory monitoring.
 */
function registerMemoryDebugCommand() {
  if (game.uesrpg) {
    game.uesrpg.debug = game.uesrpg.debug || {};
    game.uesrpg.debug.memory = {
      /**
       * Show memory usage statistics.
       */
      stats: () => {
        const monitor = getMemoryMonitor();
        const stats = monitor.getStats();
        
        console.group('UESRPG | Memory Usage Statistics');
        console.log('Monitoring:', stats.isMonitoring ? 'Active' : 'Inactive');
        console.log('Samples taken:', stats.samplesTaken);
        console.log('Warnings issued:', stats.warningsIssued);
        
        console.group('Current Cache Sizes:');
        for (const [cache, size] of Object.entries(stats.currentCacheSizes)) {
          console.log(`${cache}: ${size} entries`);
        }
        console.groupEnd();
        
        console.group('Maximum Observed Sizes:');
        for (const [cache, size] of Object.entries(stats.maxCacheSizeObserved)) {
          console.log(`${cache}: ${size} entries`);
        }
        console.groupEnd();
        
        if (stats.currentWarnings.length > 0) {
          console.group('Current Warnings:');
          stats.currentWarnings.forEach(warning => console.warn(warning));
          console.groupEnd();
        }
        
        console.groupEnd();
        
        return stats;
      },
      
      /**
       * Start memory monitoring.
       */
      start: () => {
        const monitor = getMemoryMonitor();
        monitor.start();
        console.log('UESRPG | Memory monitoring started via debug command');
        return monitor.getStats();
      },
      
      /**
       * Stop memory monitoring.
       */
      stop: () => {
        const monitor = getMemoryMonitor();
        monitor.stop();
        console.log('UESRPG | Memory monitoring stopped via debug command');
        return monitor.getStats();
      },
      
      /**
       * Clear memory history.
       */
      clear: () => {
        const monitor = getMemoryMonitor();
        monitor.clearHistory();
        console.log('UESRPG | Memory history cleared');
        return monitor.getStats();
      },
      
      /**
       * Export memory data as JSON.
       */
      export: () => {
        const monitor = getMemoryMonitor();
        const data = monitor.exportData();
        console.log('UESRPG | Memory data exported:', data);
        return data;
      },
      
      /**
       * Take an immediate memory sample.
       */
      sample: () => {
        const monitor = getMemoryMonitor();
        monitor._takeSample();
        console.log('UESRPG | Manual memory sample taken');
        return monitor.getStats();
      },
    };
  }
}

/**
 * Check if memory monitoring is enabled.
 */
export function isMemoryMonitoringEnabled() {
  return globalMemoryMonitor?.isMonitoring || false;
}

/**
 * Get memory monitoring statistics.
 */
export function getMemoryMonitoringStats() {
  return globalMemoryMonitor ? globalMemoryMonitor.getStats() : null;
}