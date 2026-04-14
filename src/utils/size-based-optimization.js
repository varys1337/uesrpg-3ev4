/**
 * Size-based optimization utilities for algorithm selection.
 * 
 * This module provides utilities to select different algorithms based on dataset size
 * to optimize performance for both small and large datasets.
 * 
 * @module size-based-optimization
 */

/**
 * Size-based algorithm selector.
 * 
 * @param {number} size - Size of the dataset
 * @param {Object} thresholds - Threshold configuration
 * @param {number} thresholds.small - Small dataset threshold (default: 20)
 * @param {number} thresholds.medium - Medium dataset threshold (default: 100)
 * @param {number} thresholds.large - Large dataset threshold (default: 500)
 * @returns {string} - Size category: 'tiny', 'small', 'medium', 'large', 'huge'
 */
export function getSizeCategory(size, thresholds = {}) {
  const { small = 20, medium = 100, large = 500 } = thresholds;
  
  if (size <= 5) return 'tiny';
  if (size <= small) return 'small';
  if (size <= medium) return 'medium';
  if (size <= large) return 'large';
  return 'huge';
}

/**
 * Execute different functions based on dataset size.
 * 
 * @param {number|Array} sizeOrData - Either the size or the data array
 * @param {Object} handlers - Handler functions for each size category
 * @param {Function} handlers.tiny - Handler for tiny datasets (0-5 items)
 * @param {Function} handlers.small - Handler for small datasets (6-20 items)
 * @param {Function} handlers.medium - Handler for medium datasets (21-100 items)
 * @param {Function} handlers.large - Handler for large datasets (101-500 items)
 * @param {Function} handlers.huge - Handler for huge datasets (501+ items)
 * @param {Object} thresholds - Threshold configuration
 * @returns {*} - Result of the selected handler
 */
export function withSizeBasedAlgorithm(sizeOrData, handlers, thresholds = {}) {
  const size = Array.isArray(sizeOrData) ? sizeOrData.length : sizeOrData;
  const category = getSizeCategory(size, thresholds);
  
  const handler = handlers[category] || handlers.default;
  if (!handler) {
    throw new Error(`No handler for size category: ${category}`);
  }
  
  return handler(sizeOrData);
}

/**
 * Optimized item processing with size-based algorithm selection.
 * 
 * @param {Array} items - Array of items to process
 * @param {Function} processFn - Processing function (item) -> result
 * @param {Object} options - Options
 * @param {number} options.batchSize - Batch size for large datasets (default: 50)
 * @param {boolean} options.useRequestIdleCallback - Use requestIdleCallback for huge datasets (default: true)
 * @returns {Array} - Processed results
 */
export function processItemsWithSizeOptimization(items, processFn, options = {}) {
  const { batchSize = 50, useRequestIdleCallback = true } = options;
  
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  
  const size = items.length;
  const category = getSizeCategory(size);
  
  switch (category) {
    case 'tiny':
    case 'small':
      // Small dataset: process synchronously
      return items.map(processFn);
      
    case 'medium':
      // Medium dataset: process synchronously but with early exit optimization
      const results = [];
      for (const item of items) {
        results.push(processFn(item));
      }
      return results;
      
    case 'large':
      // Large dataset: process in batches synchronously
      return processInBatches(items, processFn, batchSize);
      
    case 'huge':
      // Huge dataset: process incrementally with requestIdleCallback if available
      if (useRequestIdleCallback && typeof requestIdleCallback === 'function') {
        return processIncrementalWithIdleCallback(items, processFn, batchSize);
      } else {
        return processInBatches(items, processFn, batchSize);
      }
      
    default:
      return items.map(processFn);
  }
}

/**
 * Process items in batches.
 * 
 * @param {Array} items - Items to process
 * @param {Function} processFn - Processing function
 * @param {number} batchSize - Batch size
 * @returns {Array} - Processed results
 */
function processInBatches(items, processFn, batchSize) {
  const results = [];
  const total = items.length;
  
  for (let start = 0; start < total; start += batchSize) {
    const end = Math.min(start + batchSize, total);
    const batch = items.slice(start, end);
    
    for (const item of batch) {
      results.push(processFn(item));
    }
  }
  
  return results;
}

/**
 * Process items incrementally using requestIdleCallback.
 * 
 * @param {Array} items - Items to process
 * @param {Function} processFn - Processing function
 * @param {number} batchSize - Batch size
 * @returns {Promise<Array>} - Promise resolving to processed results
 */
function processIncrementalWithIdleCallback(items, processFn, batchSize) {
  return new Promise((resolve) => {
    const results = [];
    const total = items.length;
    let processed = 0;
    
    function processBatch(deadline) {
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
      
      if (processed < total) {
        // Schedule next batch
        requestIdleCallback(processBatch, { timeout: 1000 });
      } else {
        // All done
        resolve(results);
      }
    }
    
    // Start processing
    requestIdleCallback(processBatch, { timeout: 1000 });
  });
}

/**
 * Size-based search optimization.
 * 
 * @param {Array} items - Items to search
 * @param {Function} predicate - Predicate function (item) -> boolean
 * @param {Object} options - Options
 * @param {boolean} options.returnFirst - Return first match (default: true)
 * @param {number} options.maxScan - Maximum items to scan for large datasets
 * @returns {Array|*} - Matching items or first match
 */
export function searchItemsWithSizeOptimization(items, predicate, options = {}) {
  const { returnFirst = true, maxScan = 1000 } = options;
  
  if (!Array.isArray(items) || items.length === 0) {
    return returnFirst ? null : [];
  }
  
  const size = items.length;
  const category = getSizeCategory(size);
  
  // For huge datasets, we might want to limit scanning
  const scanLimit = category === 'huge' ? Math.min(size, maxScan) : size;
  
  const results = returnFirst ? null : [];
  
  for (let i = 0; i < scanLimit; i++) {
    const item = items[i];
    if (predicate(item)) {
      if (returnFirst) {
        return item;
      }
      results.push(item);
    }
  }
  
  return results;
}

/**
 * Size-based aggregation optimization.
 * 
 * @param {Array} items - Items to aggregate
 * @param {Function} aggregator - Aggregator function (accumulator, item) -> accumulator
 * @param {*} initialValue - Initial accumulator value
 * @param {Object} options - Options
 * @returns {*} - Aggregated result
 */
export function aggregateWithSizeOptimization(items, aggregator, initialValue, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return initialValue;
  }
  
  const size = items.length;
  const category = getSizeCategory(size);
  
  // For small datasets, simple reduce is fine
  if (category === 'tiny' || category === 'small') {
    return items.reduce(aggregator, initialValue);
  }
  
  // For larger datasets, use optimized loop
  let accumulator = initialValue;
  for (const item of items) {
    accumulator = aggregator(accumulator, item);
  }
  return accumulator;
}

/**
 * Create a memoized size-based selector.
 * 
 * @param {Function} selectorFn - Selector function (size) -> algorithm
 * @returns {Function} - Memoized selector
 */
export function createSizeBasedSelector(selectorFn) {
  const cache = new Map();
  
  return (size) => {
    if (cache.has(size)) {
      return cache.get(size);
    }
    
    const result = selectorFn(size);
    cache.set(size, result);
    return result;
  };
}

/**
 * Performance statistics for size-based optimizations.
 */
export const sizeOptimizationStats = {
  calls: 0,
  byCategory: {
    tiny: 0,
    small: 0,
    medium: 0,
    large: 0,
    huge: 0
  },
  timeSavedMs: 0,
  
  reset() {
    this.calls = 0;
    for (const key in this.byCategory) {
      this.byCategory[key] = 0;
    }
    this.timeSavedMs = 0;
  },
  
  record(category, timeSaved = 0) {
    this.calls++;
    if (this.byCategory[category] !== undefined) {
      this.byCategory[category]++;
    }
    this.timeSavedMs += timeSaved;
  },
  
  getStats() {
    return {
      calls: this.calls,
      byCategory: { ...this.byCategory },
      timeSavedMs: this.timeSavedMs,
      avgTimeSavedPerCall: this.calls > 0 ? this.timeSavedMs / this.calls : 0
    };
  }
};