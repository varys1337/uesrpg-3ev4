/**
 * Combat Hook Throttler
 * 
 * Specialized throttling for combat hooks to reduce cascade during combat updates.
 * Merges updates for the same combat and processes them at controlled intervals.
 * 
 * @module utils/combat-throttler
 */

import { isPerfEnabled, monoMs, perfRecord } from "./perf-tracker.js";

/**
 * Combat hook throttling system
 */
export class CombatHookThrottler {
  constructor() {
    this.lastUpdate = 0;
    this.updateQueue = [];
    this.throttleMs = 100; // Maximum 10 updates per second
    this.stats = {
      throttledUpdates: 0,
      immediateUpdates: 0,
      mergedUpdates: 0,
      queueProcessed: 0,
      averageQueueSize: 0,
      lastProcessDuration: 0,
    };
  }
  
  /**
   * Throttle combat update
   * @param {Combat} combat - Combat document
   * @param {object} update - Update data
   * @param {Function} handler - Handler function
   */
  throttleUpdate(combat, update, handler) {
    if (!this.shouldThrottle(update)) {
      // Process immediately
      this.stats.immediateUpdates++;
      handler(combat, update);
      return;
    }
    
    const now = Date.now();
    
    // If recent update, queue this one
    if (now - this.lastUpdate < this.throttleMs) {
      this.queueUpdate(combat, update, handler);
      this.stats.throttledUpdates++;
      return;
    }
    
    // Process immediately
    this.lastUpdate = now;
    this.stats.immediateUpdates++;
    handler(combat, update);
    
    // Process any queued updates
    this.processQueue();
  }
  
  /**
   * Check if update should be throttled
   * @param {object} update - Update data
   * @returns {boolean} True if should throttle
   */
  shouldThrottle(update) {
    // Critical updates should not be throttled
    if (update.turn !== undefined || update.round !== undefined) {
      return false;
    }
    
    // Combatant updates can be throttled
    if (update.combatants !== undefined) {
      return true;
    }
    
    // Other updates default to throttling
    return true;
  }
  
  /**
   * Queue update for deferred processing
   * @param {Combat} combat - Combat document
   * @param {object} update - Update data
   * @param {Function} handler - Handler function
   */
  queueUpdate(combat, update, handler) {
    // Merge with existing queued update for same combat
    const existingIndex = this.updateQueue.findIndex(
      item => item.combat === combat && item.handler === handler
    );
    
    if (existingIndex >= 0) {
      // Merge updates
      this.updateQueue[existingIndex].update = {
        ...this.updateQueue[existingIndex].update,
        ...update
      };
      this.stats.mergedUpdates++;
    } else {
      this.updateQueue.push({ combat, update, handler });
    }
    
    // Schedule queue processing
    this.scheduleQueueProcessing();
  }
  
  /**
   * Schedule queue processing
   */
  scheduleQueueProcessing() {
    if (this._processingScheduled) return;
    
    this._processingScheduled = true;
    
    // Schedule processing after throttle interval
    setTimeout(() => {
      this._processingScheduled = false;
      this.processQueue();
    }, this.throttleMs);
  }
  
  /**
   * Process queued updates
   */
  processQueue() {
    if (this.updateQueue.length === 0) return;
    
    const now = Date.now();
    if (now - this.lastUpdate >= this.throttleMs) {
      const perfStart = isPerfEnabled() ? monoMs() : 0;
      
      // Process one item from queue
      const item = this.updateQueue.shift();
      this.lastUpdate = now;
      
      try {
        item.handler(item.combat, item.update);
      } catch (err) {
        console.error('UESRPG | CombatHookThrottler | Error processing queued update:', err);
      }
      
      this.stats.queueProcessed++;
      
      if (isPerfEnabled()) {
        this.stats.lastProcessDuration = monoMs() - perfStart;
        
        perfRecord({
          event: 'combat.hookThrottler.process',
          queueSize: this.updateQueue.length,
          durationMs: this.stats.lastProcessDuration,
        });
      }
      
      // Schedule next if more items
      if (this.updateQueue.length > 0) {
        this.scheduleQueueProcessing();
      }
    }
  }
  
  /**
   * Get throttler statistics
   * @returns {object} Statistics object
   */
  getStats() {
    const totalUpdates = this.stats.throttledUpdates + this.stats.immediateUpdates;
    const mergeRate = totalUpdates > 0 ? (this.stats.mergedUpdates / totalUpdates) * 100 : 0;
    
    return {
      ...this.stats,
      queueSize: this.updateQueue.length,
      throttleMs: this.throttleMs,
      mergeRate: `${mergeRate.toFixed(1)}%`,
      totalUpdates,
    };
  }
  
  /**
   * Reset throttler statistics
   */
  resetStats() {
    this.stats = {
      throttledUpdates: 0,
      immediateUpdates: 0,
      mergedUpdates: 0,
      queueProcessed: 0,
      averageQueueSize: 0,
      lastProcessDuration: 0,
    };
  }
  
  /**
   * Clear update queue
   */
  clearQueue() {
    this.updateQueue = [];
  }
  
  /**
   * Set throttle interval
   * @param {number} ms - Throttle interval in milliseconds
   */
  setThrottleInterval(ms) {
    this.throttleMs = Math.max(16, ms); // Minimum 16ms (~1 frame)
  }
}

/**
 * Global combat hook throttler instance
 */
let globalCombatThrottler = null;

/**
 * Get or create global combat hook throttler
 * @returns {CombatHookThrottler} Throttler instance
 */
export function getCombatHookThrottler() {
  if (!globalCombatThrottler) {
    globalCombatThrottler = new CombatHookThrottler();
  }
  return globalCombatThrottler;
}

/**
 * Initialize combat hook throttling and register hooks
 */
export function initializeCombatHookThrottling() {
  // Feature flag: disable combat hook throttling due to token actor initiative issues
  const COMBAT_HOOK_THROTTLING_ENABLED = false;
  
  if (!COMBAT_HOOK_THROTTLING_ENABLED) {
    console.info('UESRPG | Combat hook throttling DISABLED (token actor initiative issue)');
    return null;
  }
  
  const throttler = getCombatHookThrottler();
  
  /**
   * Throttled handler for updateCombat hook
   */
  const throttledUpdateCombatHandler = function(combat, update, options, userId) {
    // Check if this is a critical update that should not be throttled
    const isCritical = update.turn !== undefined || update.round !== undefined;
    
    if (isCritical) {
      // For critical updates, process immediately and allow normal hook propagation
      // by not throttling at all
      return;
    }
    
    throttler.throttleUpdate(combat, update, (c, u) => {
      // When processing throttled updates, we need to ensure other hook handlers
      // are called. Use Hooks.callAll with a flag to prevent re-entering our handler.
      if (!combat._uesrpgThrottleProcessing) {
        combat._uesrpgThrottleProcessing = true;
        try {
          // Temporarily unregister our handler to avoid infinite recursion
          const wasRegistered = Hooks.events.updateCombat?.handlers?.includes(throttledUpdateCombatHandler);
          if (wasRegistered) {
            Hooks.off('updateCombat', throttledUpdateCombatHandler);
          }
          
          try {
            // Call the hook to trigger all other handlers
            Hooks.callAll('updateCombat', c, u, options, userId);
          } finally {
            // Re-register our handler if it was previously registered
            if (wasRegistered) {
              Hooks.on('updateCombat', throttledUpdateCombatHandler);
            }
          }
        } finally {
          combat._uesrpgThrottleProcessing = false;
        }
      }
    });
  };
  
  /**
   * Handler for updateCombatant hook
   */
  const updateCombatantHandler = function(combatant, update, options, userId) {
    const combat = combatant?.parent;
    if (!combat) return;
    
    // Convert combatant update to combat update for throttling
    const combatUpdate = {
      combatants: {
        [combatant.id]: update
      }
    };
    
    throttler.throttleUpdate(combat, combatUpdate, (c, u) => {
      // When processing throttled updates, we need to ensure other hook handlers
      // are called. Use Hooks.callAll with a flag to prevent re-entering our handler.
      if (!combat._uesrpgThrottleProcessingCombatant) {
        combat._uesrpgThrottleProcessingCombatant = true;
        try {
          // Temporarily unregister our handler to avoid infinite recursion
          const wasRegistered = Hooks.events.updateCombatant?.handlers?.includes(updateCombatantHandler);
          if (wasRegistered) {
            Hooks.off('updateCombatant', updateCombatantHandler);
          }
          
          try {
            // Call the hook to trigger all other handlers
            Hooks.callAll('updateCombatant', combatant, update, options, userId);
          } finally {
            // Re-register our handler if it was previously registered
            if (wasRegistered) {
              Hooks.on('updateCombatant', updateCombatantHandler);
            }
          }
        } finally {
          combat._uesrpgThrottleProcessingCombatant = false;
        }
      }
    });
  };
  
  // Register our handlers with high priority (early execution)
  Hooks.on('updateCombat', throttledUpdateCombatHandler);
  Hooks.on('updateCombatant', updateCombatantHandler);
  
  console.log('UESRPG | Combat Hook Throttling initialized (safe mode)');
  
  return throttler;
}

/**
 * Check if combat hook throttling is enabled
 * @returns {boolean} True if throttling is active
 */
export function isCombatHookThrottlingEnabled() {
  return globalCombatThrottler !== null;
}

/**
 * Get combat hook throttler statistics
 * @returns {object} Statistics object
 */
export function getCombatHookThrottlerStats() {
  return globalCombatThrottler ? globalCombatThrottler.getStats() : null;
}

/**
 * Clear combat hook throttler queue
 */
export function clearCombatHookThrottlerQueue() {
  if (globalCombatThrottler) {
    globalCombatThrottler.clearQueue();
  }
}

/**
 * Set combat hook throttling interval
 * @param {number} ms - Throttle interval in milliseconds
 */
export function setCombatHookThrottlingInterval(ms) {
  const throttler = getCombatHookThrottler();
  throttler.setThrottleInterval(ms);
}