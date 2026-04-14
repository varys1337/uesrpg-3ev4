/**
 * Combat Update Scheduler
 * 
 * Defers non-critical combat updates to improve UI responsiveness during combat.
 * Critical updates (turn/round changes) are processed immediately, while
 * non-critical updates (combatant state changes) are batched and processed
 * during idle time.
 * 
 * @module core/combat/optimization/combat-update-scheduler
 */

import { isPerfEnabled, monoMs, perfRecord } from "../../../utils/perf-tracker.js";

/**
 * Types of combat updates that can be deferred
 */
const DEFERRABLE_UPDATE_TYPES = new Set([
  'combatants',      // Combatant updates (HP, status, etc.)
  'flags',           // Flag updates
  'scene',           // Scene changes
  'active',          // Active state changes
  'sort',            // Sort order changes
]);

/**
 * Types of combat updates that must be processed immediately
 */
const CRITICAL_UPDATE_TYPES = new Set([
  'turn',            // Turn changes
  'round',           // Round changes
  'started',         // Combat start/end
]);

/**
 * Combat update deferral system
 */
export class CombatUpdateScheduler {
  constructor() {
    this.pendingUpdates = new Map();
    this.deferredCallbacks = new Set();
    this.isScheduled = false;
    this.stats = {
      deferredUpdates: 0,
      immediateUpdates: 0,
      batchFlushes: 0,
      averageBatchSize: 0,
      lastFlushDuration: 0,
    };
  }
  
  /**
   * Schedule deferred update
   * @param {string} combatId - Combat document ID
   * @param {string} updateType - Type of update (e.g., 'combatants', 'flags')
   * @param {object} data - Update data
   */
  deferUpdate(combatId, updateType, data) {
    if (!this.pendingUpdates.has(combatId)) {
      this.pendingUpdates.set(combatId, new Map());
    }
    
    const combatUpdates = this.pendingUpdates.get(combatId);
    combatUpdates.set(updateType, data);
    
    this.stats.deferredUpdates++;
    
    this.scheduleFlush();
  }
  
  /**
   * Schedule flush during idle time
   */
  scheduleFlush() {
    if (this.isScheduled) return;
    
    this.isScheduled = true;
    
    // Use requestIdleCallback if available, otherwise setTimeout
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => this.flushUpdates(), { timeout: 500 });
    } else {
      setTimeout(() => this.flushUpdates(), 100);
    }
  }
  
  /**
   * Process deferred updates
   */
  async flushUpdates() {
    const perfStart = isPerfEnabled() ? monoMs() : 0;
    
    this.isScheduled = false;
    
    if (this.pendingUpdates.size === 0 && this.deferredCallbacks.size === 0) {
      return;
    }
    
    this.stats.batchFlushes++;
    
    // Process combat updates
    for (const [combatId, updates] of this.pendingUpdates) {
      const combat = game.combats?.get(combatId);
      if (!combat) continue;
      
      // Batch process updates
      await this.processCombatUpdates(combat, updates);
    }
    
    this.pendingUpdates.clear();
    
    // Execute deferred callbacks
    for (const callback of this.deferredCallbacks) {
      try {
        callback();
      } catch (err) {
        console.error('UESRPG | CombatUpdateScheduler | Deferred callback error:', err);
      }
    }
    this.deferredCallbacks.clear();
    
    // Update stats
    if (isPerfEnabled()) {
      this.stats.lastFlushDuration = monoMs() - perfStart;
      
      perfRecord({
        event: 'combat.updateScheduler.flush',
        pendingUpdates: this.stats.deferredUpdates,
        batchFlushes: this.stats.batchFlushes,
        durationMs: this.stats.lastFlushDuration,
      });
    }
  }
  
  /**
   * Process batched updates for a combat
   * @param {Combat} combat - Combat document
   * @param {Map<string, object>} updates - Map of update type to data
   */
  async processCombatUpdates(combat, updates) {
    const combinedUpdate = {};
    
    // Merge updates by type
    for (const [updateType, data] of updates) {
      if (updateType === 'combatants') {
        // Special handling for combatant updates
        if (!combinedUpdate.combatants) {
          combinedUpdate.combatants = {};
        }
        Object.assign(combinedUpdate.combatants, data);
      } else {
        combinedUpdate[updateType] = data;
      }
    }
    
    // Apply the combined update
    if (Object.keys(combinedUpdate).length > 0) {
      try {
        await combat.update(combinedUpdate);
      } catch (err) {
        console.error('UESRPG | CombatUpdateScheduler | Failed to apply batched update:', err);
      }
    }
  }
  
  /**
   * Register callback to run after updates
   * @param {Function} callback - Callback function
   */
  deferCallback(callback) {
    this.deferredCallbacks.add(callback);
    this.scheduleFlush();
  }
  
  /**
   * Check if an update type should be deferred
   * @param {string} updateType - Update type
   * @returns {boolean} True if deferrable
   */
  static isDeferrableUpdate(updateType) {
    return DEFERRABLE_UPDATE_TYPES.has(updateType);
  }
  
  /**
   * Check if an update type is critical
   * @param {string} updateType - Update type
   * @returns {boolean} True if critical
   */
  static isCriticalUpdate(updateType) {
    return CRITICAL_UPDATE_TYPES.has(updateType);
  }
  
  /**
   * Get scheduler statistics
   * @returns {object} Statistics object
   */
  getStats() {
    const pendingCount = Array.from(this.pendingUpdates.values())
      .reduce((sum, updates) => sum + updates.size, 0);
    
    return {
      ...this.stats,
      pendingUpdates: pendingCount,
      deferredCallbacks: this.deferredCallbacks.size,
      isScheduled: this.isScheduled,
    };
  }
  
  /**
   * Reset scheduler statistics
   */
  resetStats() {
    this.stats = {
      deferredUpdates: 0,
      immediateUpdates: 0,
      batchFlushes: 0,
      averageBatchSize: 0,
      lastFlushDuration: 0,
    };
  }
  
  /**
   * Clear all pending updates
   */
  clear() {
    this.pendingUpdates.clear();
    this.deferredCallbacks.clear();
    this.isScheduled = false;
  }
}

/**
 * Global combat update scheduler instance
 */
let globalScheduler = null;

/**
 * Get or create the global combat update scheduler
 * @returns {CombatUpdateScheduler} Scheduler instance
 */
export function getCombatUpdateScheduler() {
  if (!globalScheduler) {
    globalScheduler = new CombatUpdateScheduler();
  }
  return globalScheduler;
}

/**
 * Initialize combat update scheduler and register hooks
 */
export function initializeCombatUpdateScheduler() {
  // Feature flag: disable combat update scheduler due to token actor initiative issues
  const COMBAT_UPDATE_SCHEDULER_ENABLED = false;
  
  if (!COMBAT_UPDATE_SCHEDULER_ENABLED) {
    console.info('UESRPG | Combat update scheduler DISABLED (token actor initiative issue)');
    return null;
  }
  
  const scheduler = getCombatUpdateScheduler();
  
  // Register updateCombat hook to defer non-critical updates
  Hooks.on('updateCombat', (combat, update, options, userId) => {
    // Check if this is a critical update
    const hasCriticalUpdate = Object.keys(update).some(key =>
      CombatUpdateScheduler.isCriticalUpdate(key)
    );
    
    if (hasCriticalUpdate) {
      // Process critical updates immediately
      scheduler.stats.immediateUpdates++;
      return;
    }
    
    // Check for deferrable updates
    const deferrableUpdates = Object.keys(update).filter(key =>
      CombatUpdateScheduler.isDeferrableUpdate(key)
    );
    
    if (deferrableUpdates.length > 0) {
      // Defer non-critical updates for batched processing
      // But allow other hook handlers to run (don't return false)
      for (const updateType of deferrableUpdates) {
        scheduler.deferUpdate(combat.id, updateType, { [updateType]: update[updateType] });
      }
      scheduler.stats.deferredUpdates++;
      return; // Allow other handlers to process the update
    }
    
    // Non-deferrable, non-critical updates process normally
    scheduler.stats.immediateUpdates++;
  });
  
  // Clean up on combat deletion
  Hooks.on('deleteCombat', (combat) => {
    if (combat?.id) {
      scheduler.pendingUpdates.delete(combat.id);
    }
  });
  
  console.log('UESRPG | Combat Update Scheduler initialized');
  
  return scheduler;
}

/**
 * Check if combat update scheduler is enabled
 * @returns {boolean} True if scheduler is active
 */
export function isCombatUpdateSchedulerEnabled() {
  return globalScheduler !== null;
}

/**
 * Get scheduler statistics
 * @returns {object} Statistics object
 */
export function getCombatUpdateSchedulerStats() {
  return globalScheduler ? globalScheduler.getStats() : null;
}

/**
 * Clear all pending updates
 */
export function clearCombatUpdateScheduler() {
  if (globalScheduler) {
    globalScheduler.clear();
  }
}