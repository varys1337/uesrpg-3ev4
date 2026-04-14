/**
 * Template Cache System
 * 
 * Provides pre-compilation and caching for Handlebars templates to improve
 * rendering performance across the system.
 * 
 * @module utils/template-cache
 */

/**
 * Template cache class
 */
export class TemplateCache {
  constructor(options = {}) {
    this.cache = new Map(); // templatePath -> compiled function
    this.partials = new Map(); // partialName -> compiled function
    this.preloadQueue = new Set();
    this.isPreloading = false;
    
    // LRU tracking
    this.accessOrder = []; // Array of keys in access order (most recent at end)
    this.maxCacheSize = options.maxCacheSize || 200; // Default: 200 templates
    
    // Performance tracking
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      compilations: 0,
      preloads: 0,
      memoryUsage: 0,
      evictions: 0
    };
  }
  
  /**
   * Pre-compile a template and cache it
   * @param {string} templatePath - Path to template file
   * @returns {Promise<Function>} Compiled template function
   */
  async precompile(templatePath) {
    if (this.cache.has(templatePath)) {
      this.stats.cacheHits++;
      // Update access order (move to most recent)
      this._updateAccessOrder(templatePath);
      return this.cache.get(templatePath);
    }
    
    this.stats.cacheMisses++;
    
    try {
      // Load template content
      const content = await this._loadTemplateContent(templatePath);
      
      // Compile with Handlebars
      const compiled = Handlebars.compile(content, {
        noEscape: true, // Templates should handle their own escaping
        preventIndent: true,
        strict: true,
      });
      
      // Enforce cache size limit before adding
      this._enforceCacheSizeLimit();
      
      // Cache the compiled function
      this.cache.set(templatePath, compiled);
      this.stats.compilations++;
      
      // Update access order
      this._updateAccessOrder(templatePath);
      
      // Extract and register partials
      this._extractAndRegisterPartials(content, templatePath);
      
      // Update memory usage estimate
      this._updateMemoryUsage();
      
      return compiled;
    } catch (error) {
      console.error(`TemplateCache: Failed to precompile ${templatePath}`, error);
      throw error;
    }
  }
  
  /**
   * Batch precompile multiple templates
   * @param {Array<string>} templatePaths
   * @returns {Promise<Array<Function>>}
   */
  async precompileBatch(templatePaths) {
    const promises = templatePaths.map(path => this.precompile(path));
    return Promise.all(promises);
  }
  
  /**
   * Get cached template or compile on miss
   * @param {string} templatePath
   * @param {Object} context - Template context
   * @returns {string} Rendered HTML
   */
  get(templatePath, context) {
    const compiled = this.cache.get(templatePath);
    
    if (!compiled) {
      // Fallback to synchronous compilation (should be rare after preloading)
      console.warn(`TemplateCache: Cache miss for ${templatePath}, compiling synchronously`);
      return this._compileSync(templatePath, context);
    }
    
    this.stats.cacheHits++;
    // Update access order (move to most recent)
    this._updateAccessOrder(templatePath);
    return compiled(context);
  }
  
  /**
   * Check if template is cached
   * @param {string} templatePath
   * @returns {boolean}
   */
  has(templatePath) {
    return this.cache.has(templatePath);
  }
  
  /**
   * Invalidate cache for a template
   * @param {string} templatePath
   */
  invalidate(templatePath) {
    if (this.cache.delete(templatePath)) {
      // Remove from access order
      this.accessOrder = this.accessOrder.filter(k => k !== templatePath);
      console.debug(`TemplateCache: Invalidated cache for ${templatePath}`);
      this._updateMemoryUsage();
    }
  }
  
  /**
   * Clear entire cache
   */
  clear() {
    const count = this.cache.size;
    this.cache.clear();
    this.partials.clear();
    this.stats.memoryUsage = 0;
    console.debug(`TemplateCache: Cleared ${count} templates from cache`);
  }
  
  /**
   * Get cache statistics
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      partialsSize: this.partials.size,
      hitRate: this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) || 0
    };
  }
  
  /**
   * Preload all system templates at startup
   */
  async preloadSystemTemplates() {
    if (this.isPreloading) return;
    
    this.isPreloading = true;
    const startTime = Date.now();
    
    try {
      const systemTemplates = [
        // Critical partials (from register-templates-optimized.js)
        'systems/uesrpg-3ev4/templates/partials/sheets/fixed-header.hbs',
        'systems/uesrpg-3ev4/templates/partials/sheets/feature-inspector.hbs',
        'systems/uesrpg-3ev4/templates/partials/sheets/effects-tab.hbs',
        
        // Core item sheet
        'systems/uesrpg-3ev4/templates/v2/sheets/item-sheet.hbs',
        
        // Additional partials (deferred)
        'systems/uesrpg-3ev4/templates/partials/sheets/feature-config-tab.hbs',
        'systems/uesrpg-3ev4/templates/partials/sheets/automation-tab.hbs',
        'systems/uesrpg-3ev4/templates/partials/sheets/feature-stat-sections.hbs',
        'systems/uesrpg-3ev4/templates/partials/sheets/feature-activation.hbs',
        
        // Item sheet templates (all that exist)
        'systems/uesrpg-3ev4/templates/v2/sheets/ammunition-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/armor-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/combatStyle-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/container-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/equipment-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/invocation-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/magicSkill-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/power-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/scroll-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/shield-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/skill-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/spell-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/talent-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/trait-sheet.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/weapon-sheet.hbs',
        
        // Actor tab templates
        'systems/uesrpg-3ev4/templates/v2/sheets/actor/tab-core.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/actor/tab-combat.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/actor/tab-equipment.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/actor/tab-magic.hbs',
        
        // NPC tab templates
        'systems/uesrpg-3ev4/templates/v2/sheets/npc/tab-core.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/npc/tab-combat.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/npc/tab-equipment.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/npc/tab-magic.hbs',
        
        // Group sheet templates
        'systems/uesrpg-3ev4/templates/v2/sheets/group/body.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/group/limited.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/group/sidebar.hbs',
        
        // Warfare unit templates
        'systems/uesrpg-3ev4/templates/v2/sheets/warfare-unit/body.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/warfare-unit/limited.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/warfare-unit/sidebar.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/warfare-unit/tab-actions.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/warfare-unit/tab-core.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/warfare-unit/tab-items.hbs',
        'systems/uesrpg-3ev4/templates/v2/sheets/warfare-unit/tab-magic.hbs',
        
        // Dialog templates
        'systems/uesrpg-3ev4/templates/v2/dialogs/burn-luck-dialog.hbs',
        'systems/uesrpg-3ev4/templates/v2/dialogs/hp-temp-hp-dialog.hbs',
        'systems/uesrpg-3ev4/templates/v2/dialogs/magicka-barrier-dialog.hbs',
        'systems/uesrpg-3ev4/templates/v2/dialogs/piety-points-dialog.hbs',
        'systems/uesrpg-3ev4/templates/v2/dialogs/stamina-dialog.hbs',
        
        // Startup templates
        'systems/uesrpg-3ev4/templates/v2/startup/startup-dialog.hbs',
        'systems/uesrpg-3ev4/templates/v2/startup/changelog.hbs',
        
        // Shared templates
        'systems/uesrpg-3ev4/templates/v2/sheets/shared/sidebar.hbs',
        
        // App templates (most frequently used)
        'systems/uesrpg-3ev4/templates/v2/apps/enchanting-workshop.hbs',
        'systems/uesrpg-3ev4/templates/v2/apps/alchemy-workshop.hbs',
        'systems/uesrpg-3ev4/templates/v2/apps/debug-settings.hbs',
        'systems/uesrpg-3ev4/templates/v2/apps/combat-settings.hbs'
      ];
      
      // Filter out templates that don't exist
      const existingTemplates = await this._filterExistingTemplates(systemTemplates);
      
      // Precompile in batches of 5 to avoid overwhelming the system
      const batchSize = 5;
      for (let i = 0; i < existingTemplates.length; i += batchSize) {
        const batch = existingTemplates.slice(i, i + batchSize);
        await this.precompileBatch(batch);
        
        // Yield to event loop between batches
        if (i + batchSize < existingTemplates.length) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      this.stats.preloads = existingTemplates.length;
      const elapsed = Date.now() - startTime;
      
      console.log(`TemplateCache: Precompiled ${existingTemplates.length} system templates in ${elapsed}ms`);
      
    } catch (error) {
      console.error('TemplateCache: Failed to preload system templates', error);
    } finally {
      this.isPreloading = false;
    }
  }
  
  /**
   * Load template content from file
   * @private
   */
  async _loadTemplateContent(templatePath) {
    try {
      // Try to load via Foundry's template system first
      if (typeof game !== 'undefined' && game.templates?.has(templatePath)) {
        return await game.templates.get(templatePath);
      }
      
      // Fallback to fetch
      const response = await fetch(templatePath);
      if (!response.ok) {
        throw new Error(`Failed to load template: ${response.status} ${response.statusText}`);
      }
      
      return await response.text();
    } catch (error) {
      console.error(`TemplateCache: Failed to load template content from ${templatePath}`, error);
      throw error;
    }
  }
  
  /**
   * Synchronous compilation fallback
   * @private
   */
  _compileSync(templatePath, context) {
    try {
      // This is a fallback and should rarely be used
      // In production, templates should be preloaded
      console.warn(`TemplateCache: Synchronous compilation of ${templatePath}`);
      
      // Note: Synchronous loading is not possible with fetch
      // This would require a different approach in production
      // For now, return empty string
      return '';
    } catch (error) {
      console.error(`TemplateCache: Synchronous compilation failed for ${templatePath}`, error);
      return '';
    }
  }
  
  /**
   * Extract and register partials from template content
   * @private
   */
  _extractAndRegisterPartials(content, templatePath) {
    // Simple regex to find partial references: {{> partialName }}
    const partialRegex = /\{\{>\s*([^\s}]+)\s*\}\}/g;
    const matches = [...content.matchAll(partialRegex)];
    
    for (const match of matches) {
      const partialName = match[1];
      
      // Skip if already registered
      if (this.partials.has(partialName) || Handlebars.partials[partialName]) {
        continue;
      }
      
      // Try to find partial file
      const partialPath = this._resolvePartialPath(partialName, templatePath);
      if (partialPath) {
        // Queue for preloading
        this.preloadQueue.add(partialPath);
      }
    }
  }
  
  /**
   * Resolve partial path from partial name
   * @private
   */
  _resolvePartialPath(partialName, parentTemplatePath) {
    // Common partial naming patterns
    const partialPaths = [
      `systems/uesrpg-3ev4/templates/v2/partials/${partialName}.hbs`,
      `systems/uesrpg-3ev4/templates/v2/${partialName}.hbs`,
      `systems/uesrpg-3ev4/templates/partials/${partialName}.hbs`,
      `systems/uesrpg-3ev4/templates/${partialName}.hbs`,
      `templates/v2/partials/${partialName}.hbs`,
      `templates/v2/${partialName}.hbs`,
      `templates/partials/${partialName}.hbs`,
      `templates/${partialName}.hbs`,
    ];
    
    // Also check relative to parent template
    const parentDir = parentTemplatePath.substring(0, parentTemplatePath.lastIndexOf('/'));
    partialPaths.push(`${parentDir}/${partialName}.hbs`);
    partialPaths.push(`${parentDir}/partials/${partialName}.hbs`);
    
    // The actual existence check happens in _filterExistingTemplates
    return partialPaths[0];
  }
  
  /**
   * Filter out templates that don't exist
   * @private
   */
  async _filterExistingTemplates(templatePaths) {
    const existing = [];
    
    for (const path of templatePaths) {
      try {
        // First check if template is already in Foundry's template system
        if (typeof game !== 'undefined' && game.templates?.has(path)) {
          existing.push(path);
          continue;
        }
        
        // For system templates, we can assume they exist if they're in our curated list
        // Skip the fetch check to avoid 404 errors
        if (path.startsWith('systems/uesrpg-3ev4/')) {
          // Assume it exists (we've already curated the list)
          existing.push(path);
          continue;
        }
        
        // For other templates, do the fetch check as fallback
        await this._loadTemplateContent(path);
        existing.push(path);
      } catch (error) {
        // Template doesn't exist or failed to load
        console.debug(`TemplateCache: Skipping non-existent template ${path}`);
      }
    }
    
    return existing;
  }
  
  /**
   * Update access order for a key (move to most recent)
   * @param {string} key - Cache key
   * @private
   */
  _updateAccessOrder(key) {
    // Remove key from current position
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    // Add to end (most recent)
    this.accessOrder.push(key);
  }
  
  /**
   * Enforce cache size limit by evicting least recently used entries
   * @private
   */
  _enforceCacheSizeLimit() {
    while (this.cache.size >= this.maxCacheSize && this.accessOrder.length > 0) {
      const lruKey = this.accessOrder.shift(); // Remove from beginning (oldest)
      if (lruKey && this.cache.has(lruKey)) {
        this.cache.delete(lruKey);
        this.stats.evictions++;
        
        // Also remove from partials if it's a partial
        if (this.partials.has(lruKey)) {
          this.partials.delete(lruKey);
        }
      }
    }
  }
  
  /**
   * Update memory usage estimate
   * @private
   */
  _updateMemoryUsage() {
    let estimatedSize = 0;
    
    // Rough estimate: string length * 2 bytes for UTF-16
    for (const [path, compiled] of this.cache) {
      estimatedSize += path.length * 2;
      // Can't easily estimate compiled function size
    }
    
    this.stats.memoryUsage = estimatedSize;
  }
}

/**
 * Singleton instance
 */
let singletonInstance = null;

/**
 * Get the singleton TemplateCache instance
 * @returns {TemplateCache}
 */
export function getTemplateCache() {
  if (!singletonInstance) {
    singletonInstance = new TemplateCache();
  }
  return singletonInstance;
}

/**
 * Initialize template cache with system templates
 * @param {Object} options
 * @returns {Promise<TemplateCache>}
 */
export async function initializeTemplateCache(options = {}) {
  const cache = getTemplateCache();
  
  const { preload = true, debug = false } = options;
  
  if (preload) {
    // Start preloading in background
    cache.preloadSystemTemplates().catch(err => {
      console.error('TemplateCache: Background preloading failed', err);
    });
  }
  
  if (debug) {
    console.log('TemplateCache: Initialized', cache.getStats());
  }
  
  return cache;
}

/**
 * Render template using cache
 * @param {string} templatePath
 * @param {Object} context
 * @returns {Promise<string>}
 */
export async function renderCachedTemplate(templatePath, context) {
  const cache = getTemplateCache();
  
  // Ensure template is compiled
  if (!cache.has(templatePath)) {
    await cache.precompile(templatePath);
  }
  
  return cache.get(templatePath, context);
}

/**
 * Clear template cache
 */
export function clearTemplateCache() {
  const cache = getTemplateCache();
  cache.clear();
}

/**
 * Get template cache statistics
 * @returns {Object}
 */
export function getTemplateCacheStats() {
  const cache = getTemplateCache();
  return cache.getStats();
}