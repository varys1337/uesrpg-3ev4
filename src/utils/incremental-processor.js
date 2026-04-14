/**
 * Incremental processor for very large datasets.
 * 
 * This module provides a framework for processing large arrays of items
 * incrementally using requestIdleCallback or time-slicing to avoid blocking
 * the main thread.
 * 
 * @module incremental-processor
 */

/**
 * Incremental processor for large datasets.
 * 
 * Features:
 * - Time-sliced processing using requestIdleCallback
 * - Progress tracking and reporting
 * - Pause/resume capability
 * - Configurable batch sizes
 * - Error handling and recovery
 * 
 * Usage:
 * const processor = new IncrementalProcessor(items, processFn, {
 *   batchSize: 25,
 *   onProgress: (progress) => console.log(`${progress.percent}% complete`)
 * });
 * const results = await processor.process();
 */
export class IncrementalProcessor {
  constructor(items, processFn, options = {}) {
    this.items = Array.isArray(items) ? items : [];
    this.processFn = processFn;
    
    // Options with defaults
    this.options = {
      batchSize: 25,
      useIdleCallback: true,
      idleTimeout: 1000,
      minTimeRemaining: 1, // ms
      onProgress: null,
      onComplete: null,
      onError: null,
      autoStart: false,
      ...options
    };
    
    // State
    this.results = [];
    this.processed = 0;
    this.total = this.items.length;
    this.isProcessing = false;
    this.isPaused = false;
    this.error = null;
    this.startTime = null;
    this.endTime = null;
    
    // Promise resolution
    this.resolvePromise = null;
    this.rejectPromise = null;
    this.processPromise = null;
  }
  
  /**
   * Start processing.
   * @returns {Promise<Array>} - Promise resolving to processed results
   */
  async process() {
    if (this.isProcessing) {
      return this.processPromise;
    }
    
    this.isProcessing = true;
    this.isPaused = false;
    this.startTime = performance.now();
    this.error = null;
    
    this.processPromise = new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
      
      if (this.total === 0) {
        this._complete();
        return;
      }
      
      if (this.options.useIdleCallback && typeof requestIdleCallback === 'function') {
        this._processIdleBatch();
      } else {
        this._processBatch();
      }
    });
    
    return this.processPromise;
  }
  
  /**
   * Process a batch using requestIdleCallback.
   * @private
   */
  _processIdleBatch() {
    if (this.isPaused || this.processed >= this.total || this.error) {
      return;
    }
    
    requestIdleCallback(
      (deadline) => this._processWithDeadline(deadline),
      { timeout: this.options.idleTimeout }
    );
  }
  
  /**
   * Process with idle deadline.
   * @private
   */
  _processWithDeadline(deadline) {
    if (this.isPaused || this.error) {
      return;
    }
    
    const batchStart = this.processed;
    let batchEnd = batchStart;
    
    // Process as many items as we can in the current idle period
    while (
      batchEnd < this.total &&
      (deadline.timeRemaining() > this.options.minTimeRemaining || deadline.didTimeout)
    ) {
      batchEnd = Math.min(batchEnd + this.options.batchSize, this.total);
    }
    
    // Process the batch
    try {
      for (let i = batchStart; i < batchEnd; i++) {
        this.results.push(this.processFn(this.items[i], i, this.items));
        this.processed++;
      }
    } catch (err) {
      this._handleError(err);
      return;
    }
    
    // Report progress
    this._reportProgress();
    
    if (this.processed >= this.total) {
      this._complete();
    } else if (!this.isPaused) {
      // Schedule next batch
      this._processIdleBatch();
    }
  }
  
  /**
   * Process a batch synchronously (fallback).
   * @private
   */
  _processBatch() {
    if (this.isPaused || this.error) {
      return;
    }
    
    const batchStart = this.processed;
    const batchEnd = Math.min(batchStart + this.options.batchSize, this.total);
    
    // Process the batch
    try {
      for (let i = batchStart; i < batchEnd; i++) {
        this.results.push(this.processFn(this.items[i], i, this.items));
        this.processed++;
      }
    } catch (err) {
      this._handleError(err);
      return;
    }
    
    // Report progress
    this._reportProgress();
    
    if (this.processed >= this.total) {
      this._complete();
    } else if (!this.isPaused) {
      // Schedule next batch with setTimeout to yield to event loop
      setTimeout(() => this._processBatch(), 0);
    }
  }
  
  /**
   * Report progress to callback.
   * @private
   */
  _reportProgress() {
    if (this.options.onProgress && typeof this.options.onProgress === 'function') {
      const percent = Math.round((this.processed / this.total) * 100);
      const elapsed = performance.now() - this.startTime;
      const itemsPerSecond = elapsed > 0 ? (this.processed / elapsed) * 1000 : 0;
      const estimatedRemaining = itemsPerSecond > 0 
        ? (this.total - this.processed) / itemsPerSecond * 1000 
        : 0;
      
      this.options.onProgress({
        processed: this.processed,
        total: this.total,
        percent,
        elapsedMs: elapsed,
        itemsPerSecond,
        estimatedRemainingMs: estimatedRemaining,
        results: this.results.slice() // Copy to avoid mutation
      });
    }
  }
  
  /**
   * Handle processing error.
   * @private
   */
  _handleError(err) {
    this.error = err;
    this.endTime = performance.now();
    
    if (this.options.onError && typeof this.options.onError === 'function') {
      this.options.onError(err, {
        processed: this.processed,
        total: this.total,
        results: this.results
      });
    }
    
    if (this.rejectPromise) {
      this.rejectPromise(err);
    }
    
    this.isProcessing = false;
  }
  
  /**
   * Complete processing.
   * @private
   */
  _complete() {
    this.endTime = performance.now();
    this.isProcessing = false;
    
    const elapsed = this.endTime - this.startTime;
    const itemsPerSecond = elapsed > 0 ? (this.total / elapsed) * 1000 : 0;
    
    const completionData = {
      results: this.results,
      processed: this.processed,
      total: this.total,
      elapsedMs: elapsed,
      itemsPerSecond,
      startTime: this.startTime,
      endTime: this.endTime
    };
    
    if (this.options.onComplete && typeof this.options.onComplete === 'function') {
      this.options.onComplete(completionData);
    }
    
    if (this.resolvePromise) {
      this.resolvePromise(this.results);
    }
  }
  
  /**
   * Pause processing.
   */
  pause() {
    this.isPaused = true;
  }
  
  /**
   * Resume processing.
   */
  resume() {
    if (this.isProcessing && this.isPaused) {
      this.isPaused = false;
      
      if (this.options.useIdleCallback && typeof requestIdleCallback === 'function') {
        this._processIdleBatch();
      } else {
        this._processBatch();
      }
    }
  }
  
  /**
   * Stop processing (cannot be resumed).
   */
  stop() {
    this.isProcessing = false;
    this.isPaused = false;
    
    if (this.rejectPromise) {
      this.rejectPromise(new Error('Processing stopped by user'));
    }
  }
  
  /**
   * Get current processing statistics.
   * @returns {Object}
   */
  getStats() {
    const elapsed = this.isProcessing 
      ? performance.now() - this.startTime 
      : (this.endTime ? this.endTime - this.startTime : 0);
    
    const itemsPerSecond = elapsed > 0 ? (this.processed / elapsed) * 1000 : 0;
    const estimatedRemaining = itemsPerSecond > 0 
      ? (this.total - this.processed) / itemsPerSecond * 1000 
      : 0;
    
    return {
      processed: this.processed,
      total: this.total,
      percent: this.total > 0 ? Math.round((this.processed / this.total) * 100) : 0,
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      hasError: !!this.error,
      elapsedMs: elapsed,
      itemsPerSecond,
      estimatedRemainingMs: estimatedRemaining,
      batchSize: this.options.batchSize,
      useIdleCallback: this.options.useIdleCallback
    };
  }
  
  /**
   * Reset processor to initial state.
   * @param {Array} [newItems] - Optional new items to process
   * @param {Function} [newProcessFn] - Optional new processing function
   */
  reset(newItems = null, newProcessFn = null) {
    this.stop();
    
    if (newItems !== null) {
      this.items = Array.isArray(newItems) ? newItems : [];
      this.total = this.items.length;
    }
    
    if (newProcessFn !== null) {
      this.processFn = newProcessFn;
    }
    
    this.results = [];
    this.processed = 0;
    this.isProcessing = false;
    this.isPaused = false;
    this.error = null;
    this.startTime = null;
    this.endTime = null;
    this.resolvePromise = null;
    this.rejectPromise = null;
    this.processPromise = null;
  }
}

/**
 * Specialized incremental processor for actor item processing.
 * 
 * Optimized for common actor operations like:
 * - Filtering items by type
 * - Calculating aggregates
 * - Building UI data structures
 */
export class ActorItemProcessor extends IncrementalProcessor {
  constructor(actor, processFn, options = {}) {
    const items = actor?.items ?? [];
    super(items, processFn, {
      batchSize: 50,
      onProgress: null,
      ...options
    });
    
    this.actor = actor;
    this.actorId = actor?.id;
  }
  
  /**
   * Process items by type incrementally.
   * @param {string|string[]} types - Item type(s) to process
   * @param {Function} processFn - Processing function (item) -> result
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} - Promise resolving to processed results
   */
  static async processByType(actor, types, processFn, options = {}) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    const items = actor?.items?.filter(item => item && typeSet.has(item.type)) ?? [];
    
    const processor = new IncrementalProcessor(items, processFn, {
      batchSize: 100,
      ...options
    });
    
    return processor.process();
  }
  
  /**
   * Process equipped items incrementally.
   * @param {Actor} actor - The actor
   * @param {Function} processFn - Processing function (item) -> result
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} - Promise resolving to processed results
   */
  static async processEquippedItems(actor, processFn, options = {}) {
    const items = actor?.items?.filter(item => item?.system?.equipped === true) ?? [];
    
    const processor = new IncrementalProcessor(items, processFn, {
      batchSize: 50,
      ...options
    });
    
    return processor.process();
  }
  
  /**
   * Process talents incrementally.
   * @param {Actor} actor - The actor
   * @param {Function} processFn - Processing function (talent) -> result
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} - Promise resolving to processed results
   */
  static async processTalents(actor, processFn, options = {}) {
    return this.processByType(actor, 'talent', processFn, options);
  }
  
  /**
   * Process effects incrementally.
   * @param {Actor} actor - The actor
   * @param {Function} processFn - Processing function (effect) -> result
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} - Promise resolving to processed results
   */
  static async processEffects(actor, processFn, options = {}) {
    const effects = actor?.effects ?? [];
    
    const processor = new IncrementalProcessor(effects, processFn, {
      batchSize: 100,
      ...options
    });
    
    return processor.process();
  }
}

/**
 * Progress indicator UI component for incremental processing.
 * 
 * Creates a simple progress bar that can be shown during long operations.
 */
export class ProgressIndicator {
  constructor(options = {}) {
    this.options = {
      container: null,
      showPercentage: true,
      showTimeRemaining: true,
      showItemsPerSecond: false,
      autoRemove: true,
      removeDelay: 2000,
      ...options
    };
    
    this.element = null;
    this.progressBar = null;
    this.textElement = null;
    this.startTime = null;
  }
  
  /**
   * Create and show the progress indicator.
   * @param {string} title - Progress title
   */
  show(title = 'Processing...') {
    this._createElement(title);
    
    if (this.options.container) {
      this.options.container.appendChild(this.element);
    } else {
      document.body.appendChild(this.element);
    }
    
    this.startTime = performance.now();
  }
  
  /**
   * Update progress.
   * @param {Object} progress - Progress data
   * @param {number} progress.processed - Items processed
   * @param {number} progress.total - Total items
   * @param {number} progress.percent - Completion percentage
   * @param {number} progress.elapsedMs - Elapsed time in ms
   * @param {number} progress.itemsPerSecond - Processing rate
   * @param {number} progress.estimatedRemainingMs - Estimated remaining time
   */
  update(progress) {
    if (!this.element || !this.progressBar || !this.textElement) {
      return;
    }
    
    const percent = progress.percent || 0;
    
    // Update progress bar
    this.progressBar.style.width = `${Math.min(100, percent)}%`;
    
    // Update text
    const parts = [];
    
    if (this.options.showPercentage) {
      parts.push(`${percent}%`);
    }
    
    if (this.options.showTimeRemaining && progress.estimatedRemainingMs) {
      const remainingSeconds = Math.ceil(progress.estimatedRemainingMs / 1000);
      if (remainingSeconds > 0) {
        parts.push(`${remainingSeconds}s remaining`);
      }
    }
    
    if (this.options.showItemsPerSecond && progress.itemsPerSecond) {
      parts.push(`${Math.round(progress.itemsPerSecond)}/s`);
    }
    
    this.textElement.textContent = parts.join(' · ');
  }
  
  /**
   * Complete processing and optionally hide indicator.
   * @param {string} message - Completion message
   */
  complete(message = 'Complete') {
    if (!this.element) {
      return;
    }
    
    // Update to 100%
    if (this.progressBar) {
      this.progressBar.style.width = '100%';
      this.progressBar.classList.add('complete');
    }
    
    // Show completion message
    if (this.textElement) {
      this.textElement.textContent = message;
    }
    
    // Auto-remove after delay
    if (this.options.autoRemove) {
      setTimeout(() => this.remove(), this.options.removeDelay);
    }
  }
  
  /**
   * Remove the progress indicator.
   */
  remove() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.progressBar = null;
    this.textElement = null;
  }
  
  /**
   * Create the DOM element.
   * @private
   */
  _createElement(title) {
    this.element = document.createElement('div');
    this.element.className = 'uesrpg-incremental-progress';
    this.element.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      min-width: 300px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
    `;
    
    // Title
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      font-weight: bold;
      margin-bottom: 8px;
      font-size: 15px;
    `;
    this.element.appendChild(titleEl);
    
    // Progress bar container
    const barContainer = document.createElement('div');
    barContainer.style.cssText = `
      height: 6px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 8px;
    `;
    
    // Progress bar
    this.progressBar = document.createElement('div');
    this.progressBar.style.cssText = `
      height: 100%;
      background: linear-gradient(90deg, #4CAF50, #8BC34A);
      width: 0%;
      transition: width 0.3s ease;
      border-radius: 3px;
    `;
    barContainer.appendChild(this.progressBar);
    this.element.appendChild(barContainer);
    
    // Text
    this.textElement = document.createElement('div');
    this.textElement.style.cssText = `
      font-size: 12px;
      opacity: 0.8;
      text-align: center;
    `;
    this.element.appendChild(this.textElement);
  }
}

/**
 * Utility function for simple incremental processing.
 * 
 * @param {Array} items - Items to process
 * @param {Function} processFn - Processing function (item) -> result
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} - Promise resolving to processed results
 */
export async function processIncrementally(items, processFn, options = {}) {
  const processor = new IncrementalProcessor(items, processFn, options);
  return processor.process();
}

/**
 * Check if incremental processing should be used based on dataset size.
 * 
 * @param {Array} items - Items to check
 * @param {number} threshold - Item count threshold (default: 200)
 * @returns {boolean} - True if incremental processing is recommended
 */
export function shouldUseIncrementalProcessing(items, threshold = 200) {
  return Array.isArray(items) && items.length > threshold;
}