/**
 * Combat Tracker DOM Optimizer
 *
 * Optimizes combat tracker DOM updates to minimize reflows and improve UI responsiveness.
 * Uses virtual DOM diffing to apply only necessary changes during combat updates.
 *
 * @module ui/apps/combat-tracker-dom-optimizer
 */

import { isPerfEnabled, monoMs, perfRecord } from "../../utils/perf-tracker.js";

/**
 * Get the CombatTracker class with v14 compatibility
 * In Foundry v14+, CombatTracker is namespaced under foundry.applications.sidebar.tabs.CombatTracker
 * @returns {Function|null} CombatTracker class or null if not found
 */
function getCombatTrackerClass() {
  // Try v14+ namespace first
  if (foundry?.applications?.sidebar?.tabs?.CombatTracker) {
    return foundry.applications.sidebar.tabs.CombatTracker;
  }
  // Fallback to global (v13 and earlier)
  if (typeof CombatTracker !== 'undefined') {
    return CombatTracker;
  }
  return null;
}

/**
 * Check if CombatTracker is available
 * @returns {boolean} True if CombatTracker class is available
 */
function isCombatTrackerAvailable() {
  return getCombatTrackerClass() !== null;
}

/**
 * Virtual DOM diffing for combat tracker
 */
export class CombatTrackerDOMOptimizer {
  constructor(tracker) {
    this.tracker = tracker;
    this.currentState = null;
    this.updateQueue = [];
    this.isUpdating = false;
    this.stats = {
      queueLength: 0,
      updatesProcessed: 0,
      fullRenders: 0,
      partialUpdates: 0,
      domChangesSaved: 0,
      lastUpdateDuration: 0,
    };
  }
  
  /**
   * Queue update instead of immediate render
   * @param {object} update - Update data
   */
  queueUpdate(update) {
    this.updateQueue.push(update);
    this.stats.queueLength = this.updateQueue.length;
    this.scheduleUpdate();
  }
  
  /**
   * Schedule batched update
   */
  scheduleUpdate() {
    if (this.isUpdating) return;
    
    this.isUpdating = true;
    
    // Use requestAnimationFrame for smooth UI updates
    requestAnimationFrame(() => this.processQueue());
  }
  
  /**
   * Process queued updates
   */
  async processQueue() {
    if (this.updateQueue.length === 0) {
      this.isUpdating = false;
      return;
    }
    
    const perfStart = isPerfEnabled() ? monoMs() : 0;
    
    // Merge updates
    const mergedUpdate = this.mergeUpdates(this.updateQueue);
    this.updateQueue = [];
    this.stats.queueLength = 0;
    
    // Calculate minimal DOM changes
    const changes = this.calculateChanges(this.currentState, mergedUpdate);
    
    // Apply changes
    await this.applyDOMChanges(changes);
    
    this.currentState = mergedUpdate;
    this.isUpdating = false;
    this.stats.updatesProcessed++;
    
    if (isPerfEnabled()) {
      this.stats.lastUpdateDuration = monoMs() - perfStart;
      
      perfRecord({
        event: 'combatTracker.domOptimizer.update',
        changes,
        queueSize: this.stats.updatesProcessed,
        durationMs: this.stats.lastUpdateDuration,
      });
    }
  }
  
  /**
   * Merge multiple updates into a single update
   * @param {Array<object>} updates - Array of update objects
   * @returns {object} Merged update
   */
  mergeUpdates(updates) {
    if (updates.length === 0) return null;
    if (updates.length === 1) return updates[0];
    
    const merged = {};
    
    for (const update of updates) {
      // Merge combatants
      if (update.combatants) {
        if (!merged.combatants) merged.combatants = {};
        Object.assign(merged.combatants, update.combatants);
      }
      
      // Merge other properties (last merge wins)
      if (update.turn !== undefined) merged.turn = update.turn;
      if (update.round !== undefined) merged.round = update.round;
      if (update.active !== undefined) merged.active = update.active;
      if (update.scene !== undefined) merged.scene = update.scene;
      if (update.sort !== undefined) merged.sort = update.sort;
    }
    
    return merged;
  }
  
  /**
   * Calculate minimal DOM changes between old and new state
   * @param {object} oldState - Previous state
   * @param {object} newState - New state
   * @returns {object} Changes object
   */
  calculateChanges(oldState, newState) {
    const changes = {
      added: [],
      removed: [],
      updated: [],
      reordered: false,
      turnChanged: false,
      roundChanged: false,
    };
    
    // Check for turn/round changes
    if (oldState?.turn !== newState?.turn) {
      changes.turnChanged = true;
    }
    if (oldState?.round !== newState?.round) {
      changes.roundChanged = true;
    }
    
    // Simple diff for combatants
    const oldIds = new Set(oldState?.combatants ? Object.keys(oldState.combatants) : []);
    const newIds = new Set(newState?.combatants ? Object.keys(newState.combatants) : []);
    
    // Added combatants
    for (const id of newIds) {
      if (!oldIds.has(id)) {
        changes.added.push(id);
      }
    }
    
    // Removed combatants
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        changes.removed.push(id);
      }
    }
    
    // Updated combatants
    if (newState?.combatants) {
      for (const [id, combatantData] of Object.entries(newState.combatants)) {
        const oldCombatantData = oldState?.combatants?.[id];
        if (oldCombatantData && this.hasSignificantChange(oldCombatantData, combatantData)) {
          changes.updated.push(id);
        }
      }
    }
    
    // Check if order changed (simplified - check if any combatant moved significantly)
    if (oldState?.combatants && newState?.combatants) {
      const oldOrder = Object.keys(oldState.combatants);
      const newOrder = Object.keys(newState.combatants);
      changes.reordered = !this.arraysEqual(oldOrder, newOrder);
    }
    
    return changes;
  }
  
  /**
   * Check if combatant data has significant changes requiring DOM update
   * @param {object} oldData - Old combatant data
   * @param {object} newData - New combatant data
   * @returns {boolean} True if significant change
   */
  hasSignificantChange(oldData, newData) {
    // Check key properties that affect UI
    const significantProps = [
      'initiative', 'hidden', 'defeated', 'actorId', 'tokenId',
      'name', 'img', 'resource', 'active', 'owner'
    ];
    
    for (const prop of significantProps) {
      if (oldData[prop] !== newData[prop]) {
        return true;
      }
    }
    
    // Check HP changes
    if (oldData.hp !== undefined && newData.hp !== undefined) {
      if (oldData.hp.value !== newData.hp.value || 
          oldData.hp.max !== newData.hp.max ||
          oldData.hp.temp !== newData.hp.temp) {
        return true;
      }
    }
    
    // Check effects/conditions
    if (JSON.stringify(oldData.effects) !== JSON.stringify(newData.effects)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Compare two arrays for equality
   * @param {Array} a - First array
   * @param {Array} b - Second array
   * @returns {boolean} True if arrays are equal
   */
  arraysEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length !== b.length) return false;
    
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    
    return true;
  }
  
  /**
   * Apply only necessary DOM updates
   * @param {object} changes - Changes object from calculateChanges
   */
  async applyDOMChanges(changes) {
    // If major changes needed, do full render
    if (changes.reordered || changes.added.length > 0 || changes.removed.length > 0) {
      // Full re-render needed
      this.stats.fullRenders++;
      await this.tracker.render(true); // Force render
    } else if (changes.updated.length > 0 || changes.turnChanged || changes.roundChanged) {
      // Partial updates only
      this.stats.partialUpdates++;
      await this.updateCombatantElements(changes.updated, changes.turnChanged, changes.roundChanged);
    } else {
      // No changes - nothing to do
      this.stats.domChangesSaved++;
    }
  }
  
  /**
   * Update specific combatant elements
   * @param {string[]} combatantIds - IDs of combatants to update
   * @param {boolean} turnChanged - Whether turn changed
   * @param {boolean} roundChanged - Whether round changed
   */
  async updateCombatantElements(combatantIds, turnChanged = false, roundChanged = false) {
    if (!this.tracker?.rendered) return;
    
    const html = this.tracker.element;
    if (!html) return;
    
    // Update turn/round indicators if needed
    if (turnChanged || roundChanged) {
      const turnElement = html.querySelector('.combat-tracker-header .turn');
      const roundElement = html.querySelector('.combat-tracker-header .round');
      
      if (turnElement && this.currentState?.turn !== undefined) {
        turnElement.textContent = this.currentState.turn + 1;
      }
      
      if (roundElement && this.currentState?.round !== undefined) {
        roundElement.textContent = this.currentState.round;
      }
    }
    
    // Update individual combatant rows
    for (const combatantId of combatantIds) {
      const row = html.querySelector(`li[data-combatant-id="${combatantId}"]`);
      if (!row) continue;
      
      // Update initiative
      const initiativeElement = row.querySelector('.token-initiative');
      if (initiativeElement && this.currentState?.combatants?.[combatantId]?.initiative !== undefined) {
        initiativeElement.textContent = this.currentState.combatants[combatantId].initiative;
      }
      
      // Update HP
      const hpElement = row.querySelector('.token-resource');
      if (hpElement && this.currentState?.combatants?.[combatantId]?.hp !== undefined) {
        const hp = this.currentState.combatants[combatantId].hp;
        hpElement.textContent = `${hp.value}/${hp.max}`;
        if (hp.temp) {
          hpElement.textContent += `+${hp.temp}`;
        }
      }
      
      // Update active state
      if (this.currentState?.combatants?.[combatantId]?.active !== undefined) {
        if (this.currentState.combatants[combatantId].active) {
          row.classList.add('active');
        } else {
          row.classList.remove('active');
        }
      }
    }
  }
  
  /**
   * Get optimizer statistics
   * @returns {object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      isUpdating: this.isUpdating,
      queueLength: this.updateQueue.length,
      hasCurrentState: !!this.currentState,
    };
  }
  
  /**
   * Reset optimizer statistics
   */
  resetStats() {
    this.stats = {
      queueLength: 0,
      updatesProcessed: 0,
      fullRenders: 0,
      partialUpdates: 0,
      domChangesSaved: 0,
      lastUpdateDuration: 0,
    };
  }
  
  /**
   * Clear update queue and reset state
   */
  clear() {
    this.updateQueue = [];
    this.currentState = null;
    this.isUpdating = false;
    this.stats.queueLength = 0;
  }
}

/**
 * Global combat tracker DOM optimizer registry
 */
const optimizerRegistry = new Map();

/**
 * Get or create optimizer for a combat tracker
 * @param {Application} tracker - Combat tracker application
 * @returns {CombatTrackerDOMOptimizer} Optimizer instance
 */
export function getCombatTrackerDOMOptimizer(tracker) {
  if (!tracker) return null;
  
  if (!optimizerRegistry.has(tracker)) {
    optimizerRegistry.set(tracker, new CombatTrackerDOMOptimizer(tracker));
  }
  
  return optimizerRegistry.get(tracker);
}

/**
 * Initialize combat tracker DOM optimization for all combat trackers
 */
export function initializeCombatTrackerDOMOptimization() {
  // Feature flag: disable combat tracker DOM optimization due to token actor initiative issues
  const COMBAT_TRACKER_DOM_OPTIMIZATION_ENABLED = false;
  
  if (!COMBAT_TRACKER_DOM_OPTIMIZATION_ENABLED) {
    console.info('UESRPG | Combat tracker DOM optimization DISABLED (token actor initiative issue)');
    return null;
  }
  
  // Get CombatTracker class with v14 compatibility
  const CombatTrackerClass = getCombatTrackerClass();
  
  // Check if CombatTracker class exists (may be deprecated in v14+)
  if (!CombatTrackerClass) {
    console.warn('UESRPG | CombatTracker class not found. DOM optimization disabled.');
    return null;
  }
  
  // Check if we've already patched
  if (CombatTrackerClass.prototype._uesrpgRenderPatched) {
    console.debug('UESRPG | CombatTracker already patched for DOM optimization');
    return {
      optimizerRegistry,
      getCombatTrackerDOMOptimizer,
    };
  }
  
  // Patch CombatTracker.prototype.render to use optimizer
  const originalRender = CombatTrackerClass.prototype.render;
  
  CombatTrackerClass.prototype.render = function(force = false, options = {}) {
    const optimizer = getCombatTrackerDOMOptimizer(this);
    
    if (!optimizer || force) {
      // Bypass optimizer for forced renders
      return originalRender.call(this, force, options);
    }
    
    // Queue update instead of immediate render
    const update = {
      combatants: this.combat?.combatants?.reduce((acc, c) => {
        acc[c.id] = {
          id: c.id,
          name: c.name,
          img: c.img,
          initiative: c.initiative,
          hidden: c.hidden,
          defeated: c.defeated,
          actorId: c.actorId,
          tokenId: c.tokenId,
          hp: c.actor?.system?.attributes?.hp,
          active: c.active,
          owner: c.actor?.hasPlayerOwner,
          effects: c.actor?.effects?.contents?.map(e => ({
            id: e.id,
            name: e.name,
            icon: e.icon,
          })),
        };
        return acc;
      }, {}) || {},
      turn: this.combat?.turn,
      round: this.combat?.round,
      active: this.combat?.active,
      scene: this.combat?.scene,
      sort: this.combat?.sort,
    };
    
    optimizer.queueUpdate(update);
    
    // Return a Promise that resolves with this for async compatibility
    // The DOM update happens asynchronously via requestAnimationFrame
    return Promise.resolve(this);
  };
  
  // Mark as patched
  CombatTrackerClass.prototype._uesrpgRenderPatched = true;
  
  // Clean up optimizer when tracker is closed
  const originalClose = CombatTrackerClass.prototype.close;
  
  CombatTrackerClass.prototype.close = function(options = {}) {
    optimizerRegistry.delete(this);
    return originalClose.call(this, options);
  };
  
  console.log('UESRPG | Combat Tracker DOM Optimization initialized (v14 compatible)');
  
  return {
    optimizerRegistry,
    getCombatTrackerDOMOptimizer,
  };
}

/**
 * Check if combat tracker DOM optimization is enabled
 * @returns {boolean} True if optimization is active
 */
export function isCombatTrackerDOMOptimizationEnabled() {
  const CombatTrackerClass = getCombatTrackerClass();
  return CombatTrackerClass !== null &&
         CombatTrackerClass.prototype._uesrpgRenderPatched === true;
}

/**
 * Get optimization statistics for all trackers
 * @returns {object} Combined statistics
 */
export function getCombatTrackerDOMOptimizationStats() {
  const stats = {
    totalTrackers: optimizerRegistry.size,
    trackers: [],
    combinedStats: {
      fullRenders: 0,
      partialUpdates: 0,
      domChangesSaved: 0,
      updatesProcessed: 0,
    },
  };
  
  for (const [tracker, optimizer] of optimizerRegistry) {
    const trackerStats = optimizer.getStats();
    stats.trackers.push({
      trackerId: tracker.id,
      ...trackerStats,
    });
    
    stats.combinedStats.fullRenders += trackerStats.fullRenders;
    stats.combinedStats.partialUpdates += trackerStats.partialUpdates;
    stats.combinedStats.domChangesSaved += trackerStats.domChangesSaved;
    stats.combinedStats.updatesProcessed += trackerStats.updatesProcessed;
  }
  
  return stats;
}

/**
 * Clear all optimizers
 */
export function clearCombatTrackerDOMOptimizers() {
  optimizerRegistry.clear();
}