/**
 * Hook Execution Throttler
 * 
 * Centralized system for debouncing and batching hook executions to reduce
 * main thread blocking and improve system responsiveness.
 * 
 * @module utils/hook-throttler
 */

/**
 * Hook priority levels
 * @enum {string}
 */
export const HookPriority = Object.freeze({
  CRITICAL: 'critical',   // Must execute immediately (safety, correctness)
  HIGH: 'high',           // Should execute soon (UI updates, visual feedback)
  NORMAL: 'normal',       // Can be deferred (analytics, logging)
  LOW: 'low'              // Can be batched (cleanup, cache maintenance)
});

/**
 * Default debounce delays by priority (in milliseconds)
 */
const DEFAULT_DEBOUNCE_DELAYS = {
  [HookPriority.CRITICAL]: 0,
  [HookPriority.HIGH]: 16,     // ~1 frame at 60fps
  [HookPriority.NORMAL]: 100,
  [HookPriority.LOW]: 500
};

/**
 * Default batch sizes by priority
 */
const DEFAULT_BATCH_SIZES = {
  [HookPriority.CRITICAL]: 1,
  [HookPriority.HIGH]: 5,
  [HookPriority.NORMAL]: 10,
  [HookPriority.LOW]: 20
};

/**
 * Hook throttler class for managing debounced and batched hook executions
 */
export class HookThrottler {
  constructor() {
    /** @type {Map<string, HookQueueEntry>} */
    this.queue = new Map();
    /** @type {Map<string, NodeJS.Timeout|number>} */
    this.timers = new Map();
    /** @type {Map<string, number>} */
    this.executionCounts = new Map();
    /** @type {Map<string, number>} */
    this.batchCounts = new Map();
    
    // Performance tracking
    this.stats = {
      totalScheduled: 0,
      totalExecuted: 0,
      totalBatched: 0,
      totalDebounced: 0,
      totalImmediate: 0
    };
    
    // Configuration
    this.config = {
      enabled: true,
      debug: false,
      maxQueueSize: 1000
    };
    
    // Initialize with default priorities for known hooks
    this.hookPriorities = this.getDefaultHookPriorities();
  }
  
  /**
   * Get default priority mapping for known hooks
   * @returns {Map<string, string>}
   */
  getDefaultHookPriorities() {
    const priorities = new Map();
    
    // Critical hooks - data integrity and safety
    const criticalHooks = [
      'createItem', 'deleteItem', 'deleteActor', 'deleteToken',
      'createActiveEffect', 'deleteActiveEffect',
      'preCreateItem', 'preDeleteItem', 'preDeleteActor',
      'createCombatant', 'deleteCombatant'
    ];
    
    // High priority hooks - UI updates and visual feedback
    const highHooks = [
      'updateToken', 'updateActor', 'updateItem',
      'updateActiveEffect', 'updateCombat', 'updateCombatant',
      'renderTokenHUD', 'renderActorSheet', 'renderItemSheet',
      'canvasReady', 'canvasTearDown'
    ];
    
    // Normal priority hooks - data updates
    const normalHooks = [
      'controlToken', 'targetToken', 'hoverToken',
      'createChatMessage', 'updateChatMessage', 'deleteChatMessage',
      'createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry',
      'createRollTable', 'updateRollTable', 'deleteRollTable'
    ];
    
    // Low priority hooks - cleanup and maintenance
    const lowHooks = [
      'canvasPan', 'canvasScroll', 'mouseMove',
      'dragDrop', 'dragStart', 'dragEnd',
      'closeApplication', 'collapseSidebar'
    ];
    
    // Set priorities
    criticalHooks.forEach(hook => priorities.set(hook, HookPriority.CRITICAL));
    highHooks.forEach(hook => priorities.set(hook, HookPriority.HIGH));
    normalHooks.forEach(hook => priorities.set(hook, HookPriority.NORMAL));
    lowHooks.forEach(hook => priorities.set(hook, HookPriority.LOW));
    
    return priorities;
  }
  
  /**
   * Get priority for a hook
   * @param {string} hookName
   * @returns {string}
   */
  getHookPriority(hookName) {
    return this.hookPriorities.get(hookName) || HookPriority.NORMAL;
  }
  
  /**
   * Schedule a hook execution with throttling
   * @param {string} hookName - Name of the hook
   * @param {Function} handler - Handler function
   * @param {Array} args - Arguments to pass to handler
   * @param {Object} [options] - Scheduling options
   * @param {string} [options.priority] - Override priority
   * @param {number} [options.debounceMs] - Override debounce delay
   * @param {number} [options.batchSize] - Override batch size
   * @param {boolean} [options.forceImmediate] - Force immediate execution
   * @returns {boolean} - Whether execution was scheduled/immediate
   */
  schedule(hookName, handler, args, options = {}) {
    if (!this.config.enabled) {
      // Execute immediately if throttler is disabled
      handler(...args);
      return true;
    }
    
    const priority = options.priority || this.getHookPriority(hookName);
    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_DELAYS[priority];
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZES[priority];
    const forceImmediate = options.forceImmediate || false;
    
    this.stats.totalScheduled++;
    
    // Critical hooks or forced immediate execute right away
    if (priority === HookPriority.CRITICAL || forceImmediate || debounceMs === 0) {
      this.stats.totalImmediate++;
      handler(...args);
      return true;
    }
    
    // Create queue key
    const key = this.getQueueKey(hookName, handler);
    
    // Initialize queue entry if needed
    if (!this.queue.has(key)) {
      this.queue.set(key, {
        hookName,
        handler,
        argsList: [],
        priority,
        debounceMs,
        batchSize,
        createdAt: Date.now()
      });
      
      this.batchCounts.set(key, 0);
    }
    
    const entry = this.queue.get(key);
    entry.argsList.push(args);
    entry.batchSize = batchSize; // Update in case options changed
    
    const currentBatchCount = this.batchCounts.get(key) + 1;
    this.batchCounts.set(key, currentBatchCount);
    
    // Check if we should execute based on batch size
    const shouldExecuteByBatch = currentBatchCount >= batchSize;
    
    // Schedule execution
    if (shouldExecuteByBatch) {
      this._executeNow(key);
    } else {
      this._scheduleExecution(key, debounceMs);
    }
    
    return false; // Was scheduled, not executed immediately
  }
  
  /**
   * Get unique key for a hook+handler combination
   * @param {string} hookName
   * @param {Function} handler
   * @returns {string}
   */
  getQueueKey(hookName, handler) {
    const handlerName = handler.name || 'anonymous';
    const handlerId = handler._uesrpgHookId || (() => {
      const id = Math.random().toString(36).substring(2, 9);
      handler._uesrpgHookId = id;
      return id;
    })();
    
    return `${hookName}:${handlerName}:${handlerId}`;
  }
  
  /**
   * Schedule execution for a queued hook
   * @param {string} key
   * @param {number} delayMs
   * @private
   */
  _scheduleExecution(key, delayMs) {
    // Clear existing timer
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }
    
    // Schedule new execution
    const timer = setTimeout(() => {
      this._executeNow(key);
    }, delayMs);
    
    this.timers.set(key, timer);
    this.stats.totalDebounced++;
  }
  
  /**
   * Execute all batched calls for a key
   * @param {string} key
   * @private
   */
  _executeNow(key) {
    const entry = this.queue.get(key);
    if (!entry) return;
    
    // Clear timer
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    
    // Execute handler for each batched call
    const { handler, argsList } = entry;
    const batchCount = argsList.length;
    
    if (batchCount === 1) {
      // Single execution
      handler(...argsList[0]);
    } else {
      // Batched execution - call handler for each argument set
      this.stats.totalBatched++;
      for (const args of argsList) {
        handler(...args);
      }
    }
    
    this.stats.totalExecuted += batchCount;
    this.executionCounts.set(key, (this.executionCounts.get(key) || 0) + batchCount);
    
    // Clean up
    this.queue.delete(key);
    this.batchCounts.delete(key);
    
    // Log if debug enabled
    if (this.config.debug && batchCount > 1) {
      console.debug(`HookThrottler: Executed ${batchCount} batched calls for ${entry.hookName}`);
    }
  }
  
  /**
   * Flush all pending hook executions
   */
  flushAll() {
    const keys = Array.from(this.queue.keys());
    
    for (const key of keys) {
      this._executeNow(key);
    }
    
    return keys.length;
  }
  
  /**
   * Clear all pending hook executions without running them
   */
  clearAll() {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    
    // Clear all queues
    this.queue.clear();
    this.timers.clear();
    this.batchCounts.clear();
    
    return this.stats.totalScheduled - this.stats.totalExecuted;
  }
  
  /**
   * Enable or disable the throttler
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    
    if (!enabled) {
      // If disabling, flush all pending executions
      this.flushAll();
    }
  }
  
  /**
   * Set debug mode
   * @param {boolean} debug
   */
  setDebug(debug) {
    this.config.debug = debug;
  }
  
  /**
   * Get performance statistics
   * @returns {Object}
   */
  getStats() {
    const pending = this.stats.totalScheduled - this.stats.totalExecuted;
    const batchedRate = this.stats.totalScheduled > 0 
      ? (this.stats.totalBatched / this.stats.totalScheduled) * 100 
      : 0;
    const debouncedRate = this.stats.totalScheduled > 0
      ? (this.stats.totalDebounced / this.stats.totalScheduled) * 100
      : 0;
    
    return {
      ...this.stats,
      pending,
      queueSize: this.queue.size,
      batchedRate: batchedRate.toFixed(1),
      debouncedRate: debouncedRate.toFixed(1),
      executionCounts: Object.fromEntries(this.executionCounts)
    };
  }
  
  /**
   * Reset all statistics
   */
  resetStats() {
    this.stats = {
      totalScheduled: 0,
      totalExecuted: 0,
      totalBatched: 0,
      totalDebounced: 0,
      totalImmediate: 0
    };
    
    this.executionCounts.clear();
  }
  
  /**
   * Get queue information for debugging
   * @returns {Array<Object>}
   */
  getQueueInfo() {
    return Array.from(this.queue.entries()).map(([key, entry]) => ({
      key,
      hookName: entry.hookName,
      pendingCalls: entry.argsList.length,
      priority: entry.priority,
      batchSize: entry.batchSize,
      age: Date.now() - entry.createdAt
    }));
  }
}

/**
 * Singleton instance
 */
let singletonInstance = null;

/**
 * Get the singleton HookThrottler instance
 * @returns {HookThrottler}
 */
export function getHookThrottler() {
  if (!singletonInstance) {
    singletonInstance = new HookThrottler();
  }
  return singletonInstance;
}

/**
 * Initialize the hook throttler system
 * @param {Object} [config]
 * @returns {HookThrottler}
 */
export function initializeHookThrottler(config = {}) {
  const throttler = getHookThrottler();
  
  if (config.enabled !== undefined) {
    throttler.setEnabled(config.enabled);
  }
  
  if (config.debug !== undefined) {
    throttler.setDebug(config.debug);
  }
  
  // Register cleanup on canvas tear down
  Hooks.once('canvasTearDown', () => {
    throttler.clearAll();
  });
  
  // Register debug command if debug enabled
  if (throttler.config.debug) {
    game.uesrpg = game.uesrpg || {};
    game.uesrpg.debug = game.uesrpg.debug || {};
    game.uesrpg.debug.hookThrottler = throttler;
    
    console.debug('HookThrottler initialized with debug mode');
  }
  
  return throttler;
}