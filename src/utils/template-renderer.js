/**
 * Template Renderer Service
 * 
 * Provides optimized template rendering with caching for sheets and dialogs.
 * 
 * @module utils/template-renderer
 */

import { getTemplateCache } from './template-cache.js';
import { getOptimizedHelperRegistry } from './handlebars-optimizer.js';

/**
 * Template renderer class
 */
export class TemplateRenderer {
  constructor() {
    this.templateCache = getTemplateCache();
    this.helperRegistry = getOptimizedHelperRegistry();
    
    // Render cache (context-based)
    this.renderCache = new WeakMap(); // context -> rendered HTML
    
    // Sheet-specific render cache
    this.sheetRenderCache = new WeakMap(); // sheet instance -> context -> HTML
    
    // Performance tracking
    this.stats = {
      sheetRenders: 0,
      dialogRenders: 0,
      cacheHits: 0,
      cacheMisses: 0,
      renderTime: 0
    };
  }
  
  /**
   * Render a sheet template with caching
   * @param {Object} sheet - Sheet instance
   * @param {string} templatePath - Path to template file
   * @param {Object} context - Template context
   * @param {Object} options - Rendering options
   * @returns {Promise<string>} Rendered HTML
   */
  async renderSheet(sheet, templatePath, context, options = {}) {
    const startTime = Date.now();
    
    const {
      forceRender = false,
      cacheKey = null,
      debug = false
    } = options;
    
    // Generate cache key
    const effectiveCacheKey = cacheKey || this._generateContextKey(context);
    
    // Check sheet-specific cache
    if (!forceRender && this.sheetRenderCache.has(sheet)) {
      const sheetCache = this.sheetRenderCache.get(sheet);
      if (sheetCache.has(effectiveCacheKey)) {
        this.stats.cacheHits++;
        this.stats.sheetRenders++;
        this.stats.renderTime += Date.now() - startTime;
        
        if (debug) {
          console.debug(`TemplateRenderer: Sheet cache hit for ${templatePath}`);
        }
        
        return sheetCache.get(effectiveCacheKey);
      }
    }
    
    this.stats.cacheMisses++;
    
    try {
      // Get or compile template
      const template = await this.templateCache.precompile(templatePath);
      
      // Render with optimized helpers
      const html = template(context, {
        helpers: this._getOptimizedHelpers(),
        partials: this._getCachedPartials(),
        allowProtoPropertiesByDefault: false,
        allowProtoMethodsByDefault: false,
      });
      
      // Cache the render
      this._cacheSheetRender(sheet, effectiveCacheKey, html);
      
      this.stats.sheetRenders++;
      const renderTime = Date.now() - startTime;
      this.stats.renderTime += renderTime;
      
      if (debug) {
        console.debug(`TemplateRenderer: Rendered ${templatePath} in ${renderTime}ms`);
      }
      
      return html;
    } catch (error) {
      console.error(`TemplateRenderer: Failed to render sheet template ${templatePath}`, error);
      throw error;
    }
  }
  
  /**
   * Render a dialog template
   * @param {string} templatePath - Path to template file
   * @param {Object} context - Template context
   * @param {Object} options - Rendering options
   * @returns {Promise<string>} Rendered HTML
   */
  async renderDialog(templatePath, context, options = {}) {
    const startTime = Date.now();
    
    const {
      forceRender = false,
      debug = false
    } = options;
    
    // Check general render cache
    if (!forceRender && this.renderCache.has(context)) {
      this.stats.cacheHits++;
      this.stats.dialogRenders++;
      this.stats.renderTime += Date.now() - startTime;
      
      if (debug) {
        console.debug(`TemplateRenderer: Dialog cache hit for ${templatePath}`);
      }
      
      return this.renderCache.get(context);
    }
    
    this.stats.cacheMisses++;
    
    try {
      // Get or compile template
      const template = await this.templateCache.precompile(templatePath);
      
      // Render with optimized helpers
      const html = template(context, {
        helpers: this._getOptimizedHelpers(),
        partials: this._getCachedPartials(),
        allowProtoPropertiesByDefault: false,
        allowProtoMethodsByDefault: false,
      });
      
      // Cache the render
      this.renderCache.set(context, html);
      
      this.stats.dialogRenders++;
      const renderTime = Date.now() - startTime;
      this.stats.renderTime += renderTime;
      
      if (debug) {
        console.debug(`TemplateRenderer: Rendered dialog ${templatePath} in ${renderTime}ms`);
      }
      
      return html;
    } catch (error) {
      console.error(`TemplateRenderer: Failed to render dialog template ${templatePath}`, error);
      throw error;
    }
  }
  
  /**
   * Render a generic template
   * @param {string} templatePath - Path to template file
   * @param {Object} context - Template context
   * @param {Object} options - Rendering options
   * @returns {Promise<string>} Rendered HTML
   */
  async renderTemplate(templatePath, context, options = {}) {
    const startTime = Date.now();
    
    const {
      forceRender = false,
      debug = false
    } = options;
    
    // Check general render cache
    if (!forceRender && this.renderCache.has(context)) {
      this.stats.cacheHits++;
      this.stats.renderTime += Date.now() - startTime;
      return this.renderCache.get(context);
    }
    
    this.stats.cacheMisses++;
    
    try {
      // Get or compile template
      const template = await this.templateCache.precompile(templatePath);
      
      // Render with optimized helpers
      const html = template(context, {
        helpers: this._getOptimizedHelpers(),
        partials: this._getCachedPartials(),
        allowProtoPropertiesByDefault: false,
        allowProtoMethodsByDefault: false,
      });
      
      // Cache the render
      this.renderCache.set(context, html);
      
      const renderTime = Date.now() - startTime;
      this.stats.renderTime += renderTime;
      
      if (debug) {
        console.debug(`TemplateRenderer: Rendered ${templatePath} in ${renderTime}ms`);
      }
      
      return html;
    } catch (error) {
      console.error(`TemplateRenderer: Failed to render template ${templatePath}`, error);
      throw error;
    }
  }
  
  /**
   * Clear render cache for a sheet
   * @param {Object} sheet - Sheet instance
   */
  invalidateSheetCache(sheet) {
    if (this.sheetRenderCache.has(sheet)) {
      this.sheetRenderCache.delete(sheet);
      console.debug('TemplateRenderer: Invalidated sheet cache');
    }
  }
  
  /**
   * Clear all render caches
   */
  clearRenderCache() {
    this.renderCache = new WeakMap();
    this.sheetRenderCache = new WeakMap();
    console.debug('TemplateRenderer: Cleared all render caches');
  }
  
  /**
   * Get renderer statistics
   * @returns {Object}
   */
  getStats() {
    const templateStats = this.templateCache.getStats();
    const helperStats = this.helperRegistry.getStats();
    
    return {
      ...this.stats,
      templateCache: templateStats,
      helperOptimization: helperStats,
      averageRenderTime: this.stats.renderTime / (this.stats.sheetRenders + this.stats.dialogRenders) || 0,
      cacheHitRate: this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) || 0
    };
  }
  
  /**
   * Generate cache key from context
   * @private
   */
  _generateContextKey(context) {
    try {
      // Simple hash of context properties
      const keys = Object.keys(context).sort();
      const keyParts = keys.map(key => {
        const value = context[key];
        
        // Handle common types
        if (value == null) return `${key}:null`;
        if (typeof value === 'string') return `${key}:${value.length}`;
        if (typeof value === 'number') return `${key}:${value}`;
        if (typeof value === 'boolean') return `${key}:${value}`;
        if (Array.isArray(value)) return `${key}:array[${value.length}]`;
        if (typeof value === 'object') {
          if (value.id) return `${key}:${value.constructor?.name || 'object'}:${value.id}`;
          return `${key}:object`;
        }
        
        return `${key}:${typeof value}`;
      });
      
      return keyParts.join('|');
    } catch (error) {
      // Fallback to simple string
      return String(context);
    }
  }
  
  /**
   * Cache sheet render
   * @private
   */
  _cacheSheetRender(sheet, cacheKey, html) {
    if (!this.sheetRenderCache.has(sheet)) {
      this.sheetRenderCache.set(sheet, new Map());
    }
    
    const sheetCache = this.sheetRenderCache.get(sheet);
    sheetCache.set(cacheKey, html);
    
    // Limit cache size per sheet
    if (sheetCache.size > 10) {
      const firstKey = sheetCache.keys().next().value;
      sheetCache.delete(firstKey);
    }
  }
  
  /**
   * Get optimized helpers
   * @private
   */
  _getOptimizedHelpers() {
    // Handlebars helpers are registered globally
    // This method is for future extension
    return {};
  }
  
  /**
   * Get cached partials
   * @private
   */
  _getCachedPartials() {
    // Partials are registered globally with Handlebars
    // This method is for future extension
    return {};
  }
}

/**
 * Singleton instance
 */
let singletonRenderer = null;

/**
 * Get the singleton TemplateRenderer instance
 * @returns {TemplateRenderer}
 */
export function getTemplateRenderer() {
  if (!singletonRenderer) {
    singletonRenderer = new TemplateRenderer();
  }
  return singletonRenderer;
}

/**
 * Initialize template renderer
 * @param {Object} options
 * @returns {TemplateRenderer}
 */
export function initializeTemplateRenderer(options = {}) {
  const renderer = getTemplateRenderer();
  
  const { debug = false } = options;
  
  if (debug) {
    console.log('TemplateRenderer: Initialized', renderer.getStats());
  }
  
  return renderer;
}

/**
 * Render sheet using template renderer
 * @param {Object} sheet - Sheet instance
 * @param {string} templatePath - Path to template file
 * @param {Object} context - Template context
 * @param {Object} options - Rendering options
 * @returns {Promise<string>} Rendered HTML
 */
export async function renderSheet(sheet, templatePath, context, options = {}) {
  const renderer = getTemplateRenderer();
  return renderer.renderSheet(sheet, templatePath, context, options);
}

/**
 * Render dialog using template renderer
 * @param {string} templatePath - Path to template file
 * @param {Object} context - Template context
 * @param {Object} options - Rendering options
 * @returns {Promise<string>} Rendered HTML
 */
export async function renderDialog(templatePath, context, options = {}) {
  const renderer = getTemplateRenderer();
  return renderer.renderDialog(templatePath, context, options);
}

/**
 * Render template using template renderer
 * @param {string} templatePath - Path to template file
 * @param {Object} context - Template context
 * @param {Object} options - Rendering options
 * @returns {Promise<string>} Rendered HTML
 */
export async function renderTemplate(templatePath, context, options = {}) {
  const renderer = getTemplateRenderer();
  return renderer.renderTemplate(templatePath, context, options);
}

/**
 * Invalidate sheet cache
 * @param {Object} sheet - Sheet instance
 */
export function invalidateSheetCache(sheet) {
  const renderer = getTemplateRenderer();
  renderer.invalidateSheetCache(sheet);
}

/**
 * Clear all render caches
 */
export function clearRenderCache() {
  const renderer = getTemplateRenderer();
  renderer.clearRenderCache();
}

/**
 * Get template renderer statistics
 * @returns {Object}
 */
export function getTemplateRendererStats() {
  const renderer = getTemplateRenderer();
  return renderer.getStats();
}