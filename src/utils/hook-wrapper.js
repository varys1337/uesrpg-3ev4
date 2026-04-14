/**
 * Hook Registration Wrapper
 * 
 * Provides utilities for registering hooks with automatic throttling,
 * debouncing, and batching to improve system performance.
 * 
 * @module utils/hook-wrapper
 */

import { getHookThrottler, HookPriority } from './hook-throttler.js';

/**
 * Default hook configuration by hook name pattern
 */
const DEFAULT_HOOK_CONFIGS = {
  // Canvas and token movement hooks - high frequency, can be debounced
  'updateToken': { priority: HookPriority.HIGH, debounceMs: 50, batchSize: 5 },
  'controlToken': { priority: HookPriority.HIGH, debounceMs: 100 },
  'targetToken': { priority: HookPriority.HIGH, debounceMs: 100 },
  'hoverToken': { priority: HookPriority.LOW, debounceMs: 200 },
  
  // Item lifecycle hooks - critical for data integrity
  'createItem': { priority: HookPriority.CRITICAL },
  'deleteItem': { priority: HookPriority.CRITICAL },
  'preCreateItem': { priority: HookPriority.CRITICAL },
  'preDeleteItem': { priority: HookPriority.CRITICAL },
  
  // Item update hooks - can be batched by actor
  'updateItem': { priority: HookPriority.NORMAL, debounceMs: 100, batchSize: 10 },
  
  // Actor lifecycle hooks
  'createActor': { priority: HookPriority.CRITICAL },
  'deleteActor': { priority: HookPriority.CRITICAL },
  'updateActor': { priority: HookPriority.NORMAL, debounceMs: 100, batchSize: 5 },
  
  // Active effect hooks - critical for system correctness
  'createActiveEffect': { priority: HookPriority.CRITICAL },
  'deleteActiveEffect': { priority: HookPriority.CRITICAL },
  'updateActiveEffect': { priority: HookPriority.HIGH, debounceMs: 50 },
  
  // Combat hooks
  'updateCombat': { priority: HookPriority.HIGH, debounceMs: 50 },
  'updateCombatant': { priority: HookPriority.HIGH, debounceMs: 50 },
  'createCombatant': { priority: HookPriority.CRITICAL },
  'deleteCombatant': { priority: HookPriority.CRITICAL },
  
  // UI rendering hooks - can be debounced
  'renderActorSheet': { priority: HookPriority.HIGH, debounceMs: 100 },
  'renderItemSheet': { priority: HookPriority.HIGH, debounceMs: 100 },
  'renderTokenHUD': { priority: HookPriority.HIGH, debounceMs: 50 },
  'renderApplication': { priority: HookPriority.NORMAL, debounceMs: 100 },
  
  // Canvas lifecycle hooks
  'canvasReady': { priority: HookPriority.LOW, debounceMs: 500 },
  'canvasTearDown': { priority: HookPriority.LOW, debounceMs: 0 },
  'canvasPan': { priority: HookPriority.LOW, debounceMs: 200 },
  'canvasScroll': { priority: HookPriority.LOW, debounceMs: 200 },
  
  // Chat hooks
  'createChatMessage': { priority: HookPriority.NORMAL, debounceMs: 100, batchSize: 5 },
  'updateChatMessage': { priority: HookPriority.NORMAL, debounceMs: 100 },
  'deleteChatMessage': { priority: HookPriority.NORMAL, debounceMs: 100 },
  
  // Drag and drop hooks
  'dragStart': { priority: HookPriority.HIGH, debounceMs: 0 },
  'dragEnd': { priority: HookPriority.HIGH, debounceMs: 0 },
  'dragDrop': { priority: HookPriority.HIGH, debounceMs: 0 },
  
  // Mouse movement hooks - very low priority
  'mouseMove': { priority: HookPriority.LOW, debounceMs: 500 },
  'mouseWheel': { priority: HookPriority.LOW, debounceMs: 200 }
};

/**
 * Get configuration for a specific hook
 * @param {string} hookName
 * @returns {Object}
 */
function getHookConfig(hookName) {
  // Check for exact match
  if (DEFAULT_HOOK_CONFIGS[hookName]) {
    return { ...DEFAULT_HOOK_CONFIGS[hookName] };
  }
  
  // Check for pattern matches
  for (const [pattern, config] of Object.entries(DEFAULT_HOOK_CONFIGS)) {
    if (hookName.startsWith(pattern) || hookName.includes(pattern)) {
      return { ...config };
    }
  }
  
  // Default configuration
  return {
    priority: HookPriority.NORMAL,
    debounceMs: 100,
    batchSize: 1
  };
}

/**
 * Create a throttled wrapper for a hook handler
 * @param {string} hookName
 * @param {Function} handler
 * @param {Object} [options]
 * @returns {Function}
 */
export function createThrottledHandler(hookName, handler, options = {}) {
  const throttler = getHookThrottler();
  const config = { ...getHookConfig(hookName), ...options };
  
  // Store original handler for reference
  const wrappedHandler = function(...args) {
    return throttler.schedule(hookName, handler, args, config);
  };
  
  // Copy properties for debugging
  wrappedHandler._uesrpgOriginalHandler = handler;
  wrappedHandler._uesrpgHookName = hookName;
  wrappedHandler._uesrpgConfig = config;
  
  return wrappedHandler;
}

/**
 * Register a hook with automatic throttling
 * @param {string} hookName
 * @param {Function} handler
 * @param {Object} [options]
 * @returns {Function} The wrapped handler
 */
export function registerThrottledHook(hookName, handler, options = {}) {
  const wrappedHandler = createThrottledHandler(hookName, handler, options);
  Hooks.on(hookName, wrappedHandler);
  return wrappedHandler;
}

/**
 * Register multiple hooks with throttling
 * @param {Array<Object>} hooks Array of {hookName, handler, options}
 * @returns {Array<Function>} Array of wrapped handlers
 */
export function registerThrottledHooks(hooks) {
  return hooks.map(({ hookName, handler, options = {} }) => {
    return registerThrottledHook(hookName, handler, options);
  });
}

/**
 * Register a once hook with throttling (only executes first call)
 * @param {string} hookName
 * @param {Function} handler
 * @param {Object} [options]
 * @returns {Function}
 */
export function registerThrottledHookOnce(hookName, handler, options = {}) {
  let executed = false;
  
  const onceHandler = function(...args) {
    if (executed) return;
    executed = true;
    return handler(...args);
  };
  
  return registerThrottledHook(hookName, onceHandler, options);
}

/**
 * Batch multiple hook registrations with shared configuration
 * @param {string} hookName
 * @param {Array<Function>} handlers
 * @param {Object} [options]
 * @returns {Array<Function>}
 */
export function registerThrottledHookBatch(hookName, handlers, options = {}) {
  return handlers.map((handler, index) => {
    return registerThrottledHook(hookName, handler, {
      ...options,
      batchSize: options.batchSize || handlers.length
    });
  });
}

/**
 * Create a debounced hook handler
 * @param {string} hookName
 * @param {Function} handler
 * @param {number} waitMs
 * @returns {Function}
 */
export function createDebouncedHandler(hookName, handler, waitMs = 100) {
  let timeout = null;
  let lastArgs = null;
  
  const debouncedHandler = function(...args) {
    lastArgs = args;
    
    if (timeout) {
      clearTimeout(timeout);
    }
    
    timeout = setTimeout(() => {
      if (lastArgs) {
        handler(...lastArgs);
        lastArgs = null;
      }
      timeout = null;
    }, waitMs);
  };
  
  debouncedHandler._uesrpgOriginalHandler = handler;
  debouncedHandler._uesrpgHookName = hookName;
  debouncedHandler._uesrpgDebounceMs = waitMs;
  
  return debouncedHandler;
}

/**
 * Create a batched hook handler
 * @param {string} hookName
 * @param {Function} handler
 * @param {number} batchSize
 * @returns {Function}
 */
export function createBatchedHandler(hookName, handler, batchSize = 10) {
  let batch = [];
  let flushScheduled = false;
  
  const batchedHandler = function(...args) {
    batch.push(args);
    
    if (batch.length >= batchSize && !flushScheduled) {
      flushBatch();
    } else if (!flushScheduled) {
      // Schedule flush for next tick
      flushScheduled = true;
      setTimeout(flushBatch, 0);
    }
  };
  
  function flushBatch() {
    if (batch.length === 0) {
      flushScheduled = false;
      return;
    }
    
    const currentBatch = [...batch];
    batch = [];
    flushScheduled = false;
    
    handler(currentBatch);
  }
  
  batchedHandler._uesrpgOriginalHandler = handler;
  batchedHandler._uesrpgHookName = hookName;
  batchedHandler._uesrpgBatchSize = batchSize;
  batchedHandler.flush = flushBatch;
  
  return batchedHandler;
}

/**
 * Initialize the hook wrapper system
 * @param {Object} [config]
 */
export function initializeHookWrapper(config = {}) {
  const throttler = getHookThrottler();
  
  // Apply configuration
  if (config.enabled !== undefined) {
    throttler.setEnabled(config.enabled);
  }
  
  if (config.debug !== undefined) {
    throttler.setDebug(config.debug);
  }
  
  // Add debug commands if enabled
  if (throttler.config.debug) {
    game.uesrpg = game.uesrpg || {};
    game.uesrpg.hooks = game.uesrpg.hooks || {};
    game.uesrpg.hooks.wrapper = {
      registerThrottledHook,
      registerThrottledHooks,
      createThrottledHandler,
      createDebouncedHandler,
      createBatchedHandler,
      getHookConfig,
      DEFAULT_HOOK_CONFIGS
    };
    
    console.debug('HookWrapper initialized with debug mode');
  }
  
  // Register cleanup on world unload
  Hooks.once('worldUnload', () => {
    throttler.clearAll();
  });
  
  return {
    throttler,
    registerThrottledHook,
    registerThrottledHooks
  };
}

/**
 * Check if a hook should be throttled based on its name
 * @param {string} hookName
 * @returns {boolean}
 */
export function shouldThrottleHook(hookName) {
  const config = getHookConfig(hookName);
  return config.priority !== HookPriority.CRITICAL && config.debounceMs > 0;
}

/**
 * Get statistics about hook throttling
 * @returns {Object}
 */
export function getHookThrottlingStats() {
  const throttler = getHookThrottler();
  return throttler.getStats();
}

/**
 * Flush all pending throttled hook executions
 * @returns {number} Number of flushed hooks
 */
export function flushThrottledHooks() {
  const throttler = getHookThrottler();
  return throttler.flushAll();
}

/**
 * Clear all pending throttled hook executions
 * @returns {number} Number of cleared hooks
 */
export function clearThrottledHooks() {
  const throttler = getHookThrottler();
  return throttler.clearAll();
}

// Export for convenience
export { HookPriority } from './hook-throttler.js';