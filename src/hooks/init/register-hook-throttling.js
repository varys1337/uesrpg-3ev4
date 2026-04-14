/**
 * Hook Throttling Registration
 * 
 * Registers throttled versions of high-frequency hooks to improve system performance.
 * This monkey-patches Hooks.on for specific high-frequency hooks to automatically
 * apply throttling and debouncing.
 * 
 * @module hooks/init/register-hook-throttling
 */

import { registerOnce } from "../_internal/hook-registry.js";
import { registerThrottledHook, HookPriority, createThrottledHandler } from "../../utils/hook-wrapper.js";

/**
 * Configuration for which hooks to throttle and how
 */
const THROTTLED_HOOKS = {
  // Canvas and token movement hooks - high frequency, can be debounced
  'updateToken': { priority: HookPriority.HIGH, debounceMs: 50, batchSize: 5 },
  'controlToken': { priority: HookPriority.HIGH, debounceMs: 100 },
  'targetToken': { priority: HookPriority.HIGH, debounceMs: 100 },
  'hoverToken': { priority: HookPriority.LOW, debounceMs: 200 },
  
  // Item update hooks (but not create/delete for data integrity)
  'updateItem': { priority: HookPriority.NORMAL, debounceMs: 100, batchSize: 10 },
  
  // Actor update hooks
  'updateActor': { priority: HookPriority.NORMAL, debounceMs: 100, batchSize: 5 },
  
  // Active effect update hooks
  'updateActiveEffect': { priority: HookPriority.HIGH, debounceMs: 50 },
  
  // Combat hooks
  'updateCombat': { priority: HookPriority.HIGH, debounceMs: 50 },
  'updateCombatant': { priority: HookPriority.HIGH, debounceMs: 50 },
  
  // UI rendering hooks
  'renderActorSheet': { priority: HookPriority.HIGH, debounceMs: 100 },
  'renderItemSheet': { priority: HookPriority.HIGH, debounceMs: 100 },
  'renderTokenHUD': { priority: HookPriority.HIGH, debounceMs: 50 },
  
  // Canvas interaction hooks
  'canvasPan': { priority: HookPriority.LOW, debounceMs: 200 },
  'canvasScroll': { priority: HookPriority.LOW, debounceMs: 200 },
  
  // Chat message hooks (can be batched)
  'createChatMessage': { priority: HookPriority.NORMAL, debounceMs: 100, batchSize: 5 },
  
  // Mouse movement hooks
  'mouseMove': { priority: HookPriority.LOW, debounceMs: 500 }
};

/**
 * Monkey-patch Hooks.on and Hooks.once to automatically throttle high-frequency hooks
 */
function patchHooks() {
  // Store original functions
  const originalHooksOn = Hooks.on;
  const originalHooksOnce = Hooks.once;
  
  // Track which handlers we've already patched to avoid double-patching
  const patchedHandlers = new WeakMap();
  
  /**
   * Create patched version of Hooks.on
   */
  Hooks.on = function(hookName, handler, ...args) {
    // Check if this is a hook we should throttle
    const config = THROTTLED_HOOKS[hookName];
    
    if (config && typeof handler === 'function') {
      // Check if we've already patched this handler
      if (patchedHandlers.has(handler)) {
        // Already patched, use original
        return originalHooksOn.call(this, hookName, handler, ...args);
      }
      
      // Create throttled wrapper
      const throttledHandler = createThrottledHandler(hookName, handler, config);
      
      // Store mapping from original to throttled
      patchedHandlers.set(handler, throttledHandler);
      
      // Register the throttled handler instead
      return originalHooksOn.call(this, hookName, throttledHandler, ...args);
    }
    
    // For non-throttled hooks, use original
    return originalHooksOn.call(this, hookName, handler, ...args);
  };
  
  /**
   * Create patched version of Hooks.once
   */
  Hooks.once = function(hookName, handler, ...args) {
    // Check if this is a hook we should throttle
    const config = THROTTLED_HOOKS[hookName];
    
    if (config && typeof handler === 'function') {
      // Check if we've already patched this handler
      if (patchedHandlers.has(handler)) {
        // Already patched, use original
        return originalHooksOnce.call(this, hookName, handler, ...args);
      }
      
      // Create throttled wrapper
      const throttledHandler = createThrottledHandler(hookName, handler, config);
      
      // Store mapping from original to throttled
      patchedHandlers.set(handler, throttledHandler);
      
      // Register the throttled handler instead
      return originalHooksOnce.call(this, hookName, throttledHandler, ...args);
    }
    
    // For non-throttled hooks, use original
    return originalHooksOnce.call(this, hookName, handler, ...args);
  };
  
  // Copy properties
  Hooks.on.prototype = originalHooksOn.prototype;
  Hooks.once.prototype = originalHooksOnce.prototype;
  
  // Store references for debugging
  Hooks.on._uesrpgOriginal = originalHooksOn;
  Hooks.once._uesrpgOriginal = originalHooksOnce;
  Hooks.on._uesrpgThrottledHooks = THROTTLED_HOOKS;
  Hooks.on._uesrpgIsPatched = true;
  Hooks.once._uesrpgIsPatched = true;
  
  console.debug('UESRPG | Hooks.on and Hooks.once patched for automatic throttling');
}

/**
 * Restore original Hooks.on and Hooks.once
 */
function restoreHooks() {
  if (Hooks.on._uesrpgOriginal) {
    Hooks.on = Hooks.on._uesrpgOriginal;
    console.debug('UESRPG | Hooks.on patch restored');
  }
  
  if (Hooks.once._uesrpgOriginal) {
    Hooks.once = Hooks.once._uesrpgOriginal;
    console.debug('UESRPG | Hooks.once patch restored');
  }
}

/**
 * Register throttled versions of performance-critical hooks
 */
export function registerHookThrottling() {
  registerOnce("hooks:hook-throttling", () => {
    console.debug("UESRPG | Registering hook throttling system");
    
    // Apply monkey patch
    try {
      patchHooks();
    } catch (err) {
      console.warn("UESRPG | Failed to patch Hooks.on/Hooks.once, falling back to manual registration", err);
      registerManualThrottling();
    }
    
    // Register a hook to log throttling statistics periodically
    Hooks.once('ready', () => {
      // Log statistics every 5 minutes if debug enabled
      setInterval(() => {
        const throttler = game.uesrpg?.debug?.hookThrottler;
        if (throttler?.config?.debug) {
          const stats = throttler.getStats();
          if (stats.totalScheduled > 0) {
            console.debug('HookThrottler Statistics:', stats);
          }
        }
      }, 5 * 60 * 1000); // 5 minutes
    });
    
    // Add debug commands
    Hooks.once('ready', () => {
      game.uesrpg = game.uesrpg || {};
      game.uesrpg.debug = game.uesrpg.debug || {};
      
      game.uesrpg.debug.flushThrottledHooks = () => {
        const throttler = game.uesrpg?.debug?.hookThrottler;
        if (throttler) {
          const flushed = throttler.flushAll();
          console.debug(`Flushed ${flushed} throttled hooks`);
          return flushed;
        }
        return 0;
      };
      
      game.uesrpg.debug.getHookThrottlerStats = () => {
        const throttler = game.uesrpg?.debug?.hookThrottler;
        return throttler ? throttler.getStats() : null;
      };
      
      game.uesrpg.debug.restoreHooks = restoreHooks;
      game.uesrpg.debug.patchHooks = patchHooks;
    });
    
    console.debug("UESRPG | Hook throttling registration complete");
  });
}

/**
 * Manual registration fallback if monkey-patching fails
 */
function registerManualThrottling() {
  console.debug("UESRPG | Registering manual hook throttling");
  
  // For each throttled hook, wrap existing handlers
  for (const [hookName, config] of Object.entries(THROTTLED_HOOKS)) {
    const existingCallbacks = Hooks.events[hookName];
    if (!existingCallbacks || existingCallbacks.length === 0) {
      continue;
    }
    
    console.debug(`UESRPG | Wrapping ${existingCallbacks.length} handlers for ${hookName}`);
    
    // Remove existing callbacks
    const originalCallbacks = [...existingCallbacks];
    Hooks.events[hookName] = [];
    
    // Re-register with throttling
    for (const callback of originalCallbacks) {
      registerThrottledHook(hookName, callback, config);
    }
  }
}

/**
 * Check if hook throttling is enabled
 * @returns {boolean}
 */
export function isHookThrottlingEnabled() {
  const throttler = game.uesrpg?.debug?.hookThrottler;
  return throttler?.config?.enabled === true;
}

/**
 * Enable or disable hook throttling at runtime
 * @param {boolean} enabled
 */
export function setHookThrottlingEnabled(enabled) {
  const throttler = game.uesrpg?.debug?.hookThrottler;
  if (throttler) {
    throttler.setEnabled(enabled);
    console.debug(`Hook throttling ${enabled ? 'enabled' : 'disabled'}`);
  }
}

/**
 * Get hook throttling statistics
 * @returns {Object|null}
 */
export function getHookThrottlingStats() {
  const throttler = game.uesrpg?.debug?.hookThrottler;
  return throttler ? throttler.getStats() : null;
}

/**
 * Check if Hooks.on is patched
 * @returns {boolean}
 */
export function isHooksOnPatched() {
  return !!Hooks.on._uesrpgIsPatched;
}