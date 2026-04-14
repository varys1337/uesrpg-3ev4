/**
 * Batch index updates for efficient collection management.
 * 
 * This module provides utilities for batch updating indexes when
 * multiple items/effects are created, updated, or deleted at once.
 * 
 * @module batch-index-updates
 */

import { globalCollectionRegistry } from './indexed-collections.js';

/**
 * Batch update handler for item changes.
 * 
 * @param {Actor} actor - The actor whose items changed
 * @param {Object[]} created - Newly created items
 * @param {Object[]} updated - Updated items (with _id and update data)
 * @param {string[]} deleted - IDs of deleted items
 * @param {Object} options - Update options
 * @param {boolean} options.refreshAll - Refresh entire collection (default: false)
 */
export function batchUpdateItems(actor, created = [], updated = [], deleted = [], options = {}) {
  const { refreshAll = false } = options;
  
  if (!actor?.id) return;
  
  const manager = globalCollectionRegistry.getManager(actor);
  
  if (refreshAll) {
    // Full refresh - simplest but less efficient
    manager.refresh();
    return;
  }
  
  // Process deletions first
  for (const itemId of deleted) {
    manager.items.remove(itemId);
  }
  
  // Process creations
  for (const item of created) {
    if (item) {
      manager.items.add(item);
    }
  }
  
  // Process updates - need to remove old entry and add updated one
  for (const update of updated) {
    if (update?._id) {
      // Remove old entry
      manager.items.remove(update._id);
      
      // Find the actual updated item in actor's items
      const actualItem = actor.items?.find(item => item._id === update._id);
      if (actualItem) {
        manager.items.add(actualItem);
      }
    }
  }
}

/**
 * Batch update handler for effect changes.
 * 
 * @param {Actor} actor - The actor whose effects changed
 * @param {Object[]} created - Newly created effects
 * @param {Object[]} updated - Updated effects (with _id and update data)
 * @param {string[]} deleted - IDs of deleted effects
 * @param {Object} options - Update options
 * @param {boolean} options.refreshAll - Refresh entire collection (default: false)
 */
export function batchUpdateEffects(actor, created = [], updated = [], deleted = [], options = {}) {
  const { refreshAll = false } = options;
  
  if (!actor?.id) return;
  
  const manager = globalCollectionRegistry.getManager(actor);
  
  if (refreshAll) {
    // Full refresh
    manager.refresh();
    return;
  }
  
  // Process deletions first
  for (const effectId of deleted) {
    manager.effects.remove(effectId);
  }
  
  // Process creations
  for (const effect of created) {
    if (effect) {
      manager.effects.add(effect);
    }
  }
  
  // Process updates
  for (const update of updated) {
    if (update?._id) {
      // Remove old entry
      manager.effects.remove(update._id);
      
      // Find the actual updated effect in actor's effects
      const actualEffect = actor.effects?.find(effect => effect._id === update._id);
      if (actualEffect) {
        manager.effects.add(actualEffect);
      }
    }
  }
}

/**
 * Hook integration for automatic batch updates.
 * 
 * This function registers Foundry hooks to automatically update indexes
 * when items or effects are created, updated, or deleted.
 * 
 * @returns {Function} Cleanup function to unregister hooks
 */
export function registerBatchUpdateHooks() {
  const hooks = [];
  
  // Item creation hook
  const createItemHook = Hooks.on('createItem', (item, options, userId) => {
    const actor = item.parent;
    if (actor) {
      batchUpdateItems(actor, [item], [], []);
    }
  });
  hooks.push(['createItem', createItemHook]);
  
  // Item update hook
  const updateItemHook = Hooks.on('updateItem', (item, updateData, options, userId) => {
    const actor = item.parent;
    if (actor) {
      batchUpdateItems(actor, [], [{ _id: item._id, ...updateData }], []);
    }
  });
  hooks.push(['updateItem', updateItemHook]);
  
  // Item deletion hook
  const deleteItemHook = Hooks.on('deleteItem', (item, options, userId) => {
    const actor = item.parent;
    if (actor) {
      batchUpdateItems(actor, [], [], [item._id]);
    }
  });
  hooks.push(['deleteItem', deleteItemHook]);
  
  // Effect creation hook
  const createEffectHook = Hooks.on('createActiveEffect', (effect, options, userId) => {
    const actor = effect.parent;
    if (actor) {
      batchUpdateEffects(actor, [effect], [], []);
    }
  });
  hooks.push(['createActiveEffect', createEffectHook]);
  
  // Effect update hook
  const updateEffectHook = Hooks.on('updateActiveEffect', (effect, updateData, options, userId) => {
    const actor = effect.parent;
    if (actor) {
      batchUpdateEffects(actor, [], [{ _id: effect._id, ...updateData }], []);
    }
  });
  hooks.push(['updateActiveEffect', updateEffectHook]);
  
  // Effect deletion hook
  const deleteEffectHook = Hooks.on('deleteActiveEffect', (effect, options, userId) => {
    const actor = effect.parent;
    if (actor) {
      batchUpdateEffects(actor, [], [], [effect._id]);
    }
  });
  hooks.push(['deleteActiveEffect', deleteEffectHook]);
  
  // Actor sheet render hook - refresh collections when sheet opens
  const renderActorSheetHook = Hooks.on('renderActorSheet', (app, html, data) => {
    const actor = app.actor;
    if (actor) {
      globalCollectionRegistry.refresh(actor);
    }
  });
  hooks.push(['renderActorSheet', renderActorHook]);
  
  // Cleanup function
  return () => {
    for (const [event, id] of hooks) {
      Hooks.off(event, id);
    }
  };
}

/**
 * Performance-optimized batch processor for large datasets.
 * 
 * @param {Array} items - Items to process
 * @param {Function} processFn - Processing function (item) -> result
 * @param {Object} options - Processing options
 * @param {number} options.batchSize - Items per batch (default: 50)
 * @param {number} options.delayMs - Delay between batches (default: 0)
 * @param {Function} options.progressCallback - Callback for progress reporting
 * @returns {Promise<Array>} - Promise resolving to all processed results
 */
export async function processBatchWithProgress(items, processFn, options = {}) {
  const {
    batchSize = 50,
    delayMs = 0,
    progressCallback = null
  } = options;
  
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  
  const results = [];
  const total = items.length;
  let processed = 0;
  
  for (let start = 0; start < total; start += batchSize) {
    const end = Math.min(start + batchSize, total);
    const batch = items.slice(start, end);
    
    // Process batch synchronously
    for (const item of batch) {
      results.push(processFn(item));
    }
    
    processed = end;
    
    // Report progress
    if (progressCallback && typeof progressCallback === 'function') {
      progressCallback({
        processed,
        total,
        percent: Math.round((processed / total) * 100),
        batchStart: start,
        batchEnd: end
      });
    }
    
    // Delay between batches if specified
    if (delayMs > 0 && processed < total) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return results;
}

/**
 * Incremental batch processor using requestIdleCallback.
 * 
 * @param {Array} items - Items to process
 * @param {Function} processFn - Processing function (item) -> result
 * @param {Object} options - Processing options
 * @param {number} options.batchSize - Items per idle callback (default: 10)
 * @param {number} options.timeoutMs - Idle callback timeout (default: 1000)
 * @param {Function} options.progressCallback - Callback for progress reporting
 * @returns {Promise<Array>} - Promise resolving to all processed results
 */
export function processBatchIncremental(items, processFn, options = {}) {
  return new Promise((resolve) => {
    const {
      batchSize = 10,
      timeoutMs = 1000,
      progressCallback = null
    } = options;
    
    if (!Array.isArray(items) || items.length === 0) {
      resolve([]);
      return;
    }
    
    const results = [];
    const total = items.length;
    let processed = 0;
    
    function processIdleBatch(deadline) {
      const batchStart = processed;
      let batchEnd = batchStart;
      
      // Process as many items as we can in the current idle period
      while (batchEnd < total && (deadline.timeRemaining() > 0 || deadline.didTimeout)) {
        batchEnd = Math.min(batchEnd + batchSize, total);
      }
      
      // Process the batch
      for (let i = batchStart; i < batchEnd; i++) {
        results.push(processFn(items[i]));
      }
      
      processed = batchEnd;
      
      // Report progress
      if (progressCallback && typeof progressCallback === 'function') {
        progressCallback({
          processed,
          total,
          percent: Math.round((processed / total) * 100),
          batchStart,
          batchEnd,
          timeRemaining: deadline.timeRemaining(),
          didTimeout: deadline.didTimeout
        });
      }
      
      if (processed < total) {
        // Schedule next batch
        requestIdleCallback(processIdleBatch, { timeout: timeoutMs });
      } else {
        // All done
        resolve(results);
      }
    }
    
    // Start processing
    requestIdleCallback(processIdleBatch, { timeout: timeoutMs });
  });
}

/**
 * Batch index builder for initial collection setup.
 * 
 * @param {Actor} actor - Actor to build indexes for
 * @param {Object} options - Build options
 * @param {boolean} options.useIncremental - Use incremental building (default: true for large datasets)
 * @param {Function} options.progressCallback - Progress callback
 * @returns {Promise<Object>} - Promise resolving to collection manager
 */
export async function buildIndexesBatch(actor, options = {}) {
  const {
    useIncremental = true,
    progressCallback = null
  } = options;
  
  if (!actor) {
    return null;
  }
  
  const itemCount = actor.items?.length || 0;
  const effectCount = actor.effects?.length || 0;
  const totalOperations = itemCount + effectCount;
  
  // For small datasets, build synchronously
  if (totalOperations < 100 || !useIncremental) {
    const manager = globalCollectionRegistry.getManager(actor);
    manager.refresh();
    return manager;
  }
  
  // For large datasets, build incrementally
  const manager = globalCollectionRegistry.getManager(actor);
  
  // Clear existing data
  manager.items.update([]);
  manager.effects.update([]);
  
  let completedOperations = 0;
  
  // Helper to report progress
  function reportProgress(increment = 1) {
    completedOperations += increment;
    if (progressCallback && typeof progressCallback === 'function') {
      progressCallback({
        completed: completedOperations,
        total: totalOperations,
        percent: Math.round((completedOperations / totalOperations) * 100)
      });
    }
  }
  
  // Build item indexes incrementally
  if (itemCount > 0) {
    await processBatchIncremental(actor.items || [], (item) => {
      manager.items.add(item);
      reportProgress(1);
    }, {
      batchSize: 25,
      progressCallback: null // We handle progress ourselves
    });
  } else {
    completedOperations += itemCount;
  }
  
  // Build effect indexes incrementally
  if (effectCount > 0) {
    await processBatchIncremental(actor.effects || [], (effect) => {
      manager.effects.add(effect);
      reportProgress(1);
    }, {
      batchSize: 25,
      progressCallback: null
    });
  } else {
    completedOperations += effectCount;
  }
  
  return manager;
}

/**
 * Statistics for batch operations.
 */
export const batchStats = {
  itemUpdates: 0,
  effectUpdates: 0,
  batchOperations: 0,
  incrementalBatches: 0,
  totalItemsProcessed: 0,
  totalEffectsProcessed: 0,
  totalTimeMs: 0,
  
  reset() {
    this.itemUpdates = 0;
    this.effectUpdates = 0;
    this.batchOperations = 0;
    this.incrementalBatches = 0;
    this.totalItemsProcessed = 0;
    this.totalEffectsProcessed = 0;
    this.totalTimeMs = 0;
  },
  
  recordItemUpdate(count = 1) {
    this.itemUpdates += count;
    this.totalItemsProcessed += count;
  },
  
  recordEffectUpdate(count = 1) {
    this.effectUpdates += count;
    this.totalEffectsProcessed += count;
  },
  
  recordBatchOperation() {
    this.batchOperations++;
  },
  
  recordIncrementalBatch() {
    this.incrementalBatches++;
  },
  
  recordTime(ms) {
    this.totalTimeMs += ms;
  },
  
  getStats() {
    return {
      itemUpdates: this.itemUpdates,
      effectUpdates: this.effectUpdates,
      batchOperations: this.batchOperations,
      incrementalBatches: this.incrementalBatches,
      totalItemsProcessed: this.totalItemsProcessed,
      totalEffectsProcessed: this.totalEffectsProcessed,
      totalTimeMs: this.totalTimeMs,
      avgTimePerItem: this.totalItemsProcessed > 0 ? this.totalTimeMs / this.totalItemsProcessed : 0,
      avgTimePerEffect: this.totalEffectsProcessed > 0 ? this.totalTimeMs / this.totalEffectsProcessed : 0
    };
  }
};