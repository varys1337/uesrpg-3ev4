/**
 * Optimized Template Registration
 * 
 * Enhanced template preloading with caching and progressive loading.
 * 
 * @module hooks/init/register-templates-optimized
 */

import { initializeTemplateCache } from "../../utils/template-cache.js";
import { initializeOptimizedHelpers, registerCommonOptimizedHelpers } from "../../utils/handlebars-optimizer.js";
import { initializeTemplateRenderer } from "../../utils/template-renderer.js";

/**
 * Critical templates that must be loaded before first paint
 */
const CRITICAL_TEMPLATES = [
  // Essential partials (these definitely exist and are used by sheets)
  "systems/uesrpg-3ev4/templates/partials/sheets/fixed-header.hbs",
  "systems/uesrpg-3ev4/templates/partials/sheets/feature-inspector.hbs",
  "systems/uesrpg-3ev4/templates/partials/sheets/effects-tab.hbs",
  
  // Core item sheet that definitely exists
  "systems/uesrpg-3ev4/templates/v2/sheets/item-sheet.hbs",
];

/**
 * Deferred templates (can load in background)
 */
const DEFERRED_TEMPLATES = [
  // Additional partials
  "systems/uesrpg-3ev4/templates/partials/sheets/feature-config-tab.hbs",
  "systems/uesrpg-3ev4/templates/partials/sheets/automation-tab.hbs",
  "systems/uesrpg-3ev4/templates/partials/sheets/feature-stat-sections.hbs",
  "systems/uesrpg-3ev4/templates/partials/sheets/feature-activation.hbs",
  
  // App templates
  "systems/uesrpg-3ev4/templates/v2/apps/enchanting-workshop.hbs",
  "systems/uesrpg-3ev4/templates/v2/apps/alchemy-workshop.hbs",
  
  // Additional sheet templates (with correct paths)
  "systems/uesrpg-3ev4/templates/v2/sheets/ammunition-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/armor-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/combatStyle-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/container-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/equipment-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/invocation-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/magicSkill-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/power-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/scroll-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/shield-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/skill-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/spell-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/talent-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/trait-sheet.hbs",
  "systems/uesrpg-3ev4/templates/v2/sheets/weapon-sheet.hbs",
  
  // Dialog templates that exist
  "systems/uesrpg-3ev4/templates/v2/dialogs/burn-luck-dialog.hbs",
  "systems/uesrpg-3ev4/templates/v2/dialogs/hp-temp-hp-dialog.hbs",
  "systems/uesrpg-3ev4/templates/v2/dialogs/magicka-barrier-dialog.hbs",
  "systems/uesrpg-3ev4/templates/v2/dialogs/piety-points-dialog.hbs",
  "systems/uesrpg-3ev4/templates/v2/dialogs/stamina-dialog.hbs",
  
  // Startup templates
  "systems/uesrpg-3ev4/templates/v2/startup/startup-dialog.hbs",
  "systems/uesrpg-3ev4/templates/v2/startup/changelog.hbs",
  
  // Shared templates
  "systems/uesrpg-3ev4/templates/v2/sheets/shared/sidebar.hbs",
];

/**
 * Load templates using Foundry's template loader (for compatibility)
 */
async function loadTemplatesWithFoundry(templatePaths) {
  try {
    // Foundry v14: use the namespaced template loader
    const loader = foundry?.applications?.handlebars?.loadTemplates;
    if (typeof loader === "function") {
      await loader(templatePaths);
      return true;
    }
    
    // Fallback for older versions
    console.warn("UESRPG | Foundry template loader not available, using fallback");
    return false;
  } catch (err) {
    console.error("UESRPG | Failed to load templates with Foundry loader", err);
    return false;
  }
}

/**
 * Preload critical templates (blocking)
 */
async function preloadCriticalTemplates() {
  const startTime = Date.now();
  
  try {
    // Initialize template cache
    const templateCache = await initializeTemplateCache({
      preload: false, // We'll handle preloading manually
      debug: game.settings.get("uesrpg-3ev4", "templateDebug") || false
    });
    
    // Preload critical templates
    await templateCache.precompileBatch(CRITICAL_TEMPLATES);
    
    // Also load with Foundry for compatibility
    await loadTemplatesWithFoundry(CRITICAL_TEMPLATES);
    
    const elapsed = Date.now() - startTime;
    console.log(`UESRPG | Preloaded ${CRITICAL_TEMPLATES.length} critical templates in ${elapsed}ms`);
    
    return true;
  } catch (err) {
    console.error("UESRPG | Failed to preload critical templates", err);
    return false;
  }
}

/**
 * Preload deferred templates in background
 */
async function preloadDeferredTemplates() {
  try {
    const templateCache = await initializeTemplateCache();
    
    // Use requestIdleCallback for non-critical loading
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(async () => {
        const startTime = Date.now();
        
        try {
          await templateCache.precompileBatch(DEFERRED_TEMPLATES);
          
          // Also load with Foundry for compatibility
          await loadTemplatesWithFoundry(DEFERRED_TEMPLATES);
          
          const elapsed = Date.now() - startTime;
          console.log(`UESRPG | Preloaded ${DEFERRED_TEMPLATES.length} deferred templates in ${elapsed}ms (background)`);
        } catch (err) {
          console.error("UESRPG | Failed to preload deferred templates in background", err);
        }
      }, { timeout: 10000 }); // Max 10 second timeout
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(async () => {
        const startTime = Date.now();
        
        try {
          await templateCache.precompileBatch(DEFERRED_TEMPLATES);
          await loadTemplatesWithFoundry(DEFERRED_TEMPLATES);
          
          const elapsed = Date.now() - startTime;
          console.log(`UESRPG | Preloaded ${DEFERRED_TEMPLATES.length} deferred templates in ${elapsed}ms (setTimeout)`);
        } catch (err) {
          console.error("UESRPG | Failed to preload deferred templates", err);
        }
      }, 2000); // Wait 2 seconds before starting
    }
    
    return true;
  } catch (err) {
    console.error("UESRPG | Failed to schedule deferred template loading", err);
    return false;
  }
}

/**
 * Initialize optimized helpers with defensive programming
 */
function initializeOptimizedHandlebars() {
  try {
    // Check if game.settings is available
    if (!game.settings) {
      console.warn("UESRPG | game.settings not available, skipping handlebars optimization");
      return false;
    }
    
    // Check if we should enable helper optimization
    // Disable by default due to compatibility issues
    const enableHelperOptimization = game.settings.get("uesrpg-3ev4", "templateDebug") === true;
    
    if (!enableHelperOptimization) {
      console.log("UESRPG | Helper optimization disabled (safe mode), skipping");
      return true; // Return true but don't actually optimize helpers
    }
    
    // Initialize optimized helper registry only if enabled
    const helperRegistry = initializeOptimizedHelpers({
      debug: game.settings.get("uesrpg-3ev4", "templateDebug") || false,
      safeMode: true
    });
    
    if (!helperRegistry) {
      console.warn("UESRPG | Failed to create optimized helper registry");
      return false;
    }
    
    // Register common optimized helpers with conservative settings
    // to avoid compatibility issues
    try {
      registerCommonOptimizedHelpers({
        cacheSize: 50, // Very conservative cache size
        ttl: 3000, // 3 seconds TTL
        enabled: true
      });
    } catch (helperError) {
      console.warn("UESRPG | Failed to register common optimized helpers, continuing without them", helperError);
      // Continue without common helpers - optimization will still work for templates
    }
    
    console.log("UESRPG | Initialized optimized Handlebars helpers (safe mode)");
    return true;
  } catch (err) {
    console.error("UESRPG | Failed to initialize optimized Handlebars helpers", err);
    return false;
  }
}

/**
 * Safely patch Foundry's renderTemplate to use optimized renderer
 * with proper descriptor checking and duplicate patching prevention
 */
async function patchFoundryRenderTemplate() {
  try {
    // Check if Foundry API is available
    if (!foundry?.applications?.handlebars?.renderTemplate) {
      console.warn("UESRPG | Foundry renderTemplate API not available for patching");
      return false;
    }
    
    const target = foundry.applications.handlebars;
    const propertyName = 'renderTemplate';
    
    // 1. Check if already patched by us (look for our marker)
    if (target._uesrpgRenderTemplatePatched) {
      console.debug("UESRPG | renderTemplate already patched, skipping");
      return true;
    }
    
    // 2. Get current property descriptor
    const descriptor = Object.getOwnPropertyDescriptor(target, propertyName);
    
    // 3. Check if we can modify the property
    if (descriptor) {
      // Property has a descriptor - check if we can modify it
      if (descriptor.configurable === false) {
        // Property is non-configurable, but might still be writable
        if (descriptor.writable === true) {
          if (game.settings.get("uesrpg-3ev4", "templateDebug")) {
            console.warn("UESRPG | renderTemplate property is non-configurable but writable - attempting assignment");
          }
          // We can assign to it even though we can't reconfigure it
          // Continue with normal patching flow (will use assignment at line 297)
        } else {
          // Property is non-configurable AND non-writable - cannot modify
          if (game.settings.get("uesrpg-3ev4", "templateDebug")) {
            console.warn("UESRPG | renderTemplate property is non-configurable and non-writable, cannot patch directly");
          }
          
          // Alternative approach: Create a wrapper function
          return await createWrapperInsteadOfPatch(target, propertyName, descriptor);
        }
      }
      // If configurable is true or writable is true, continue with normal patching
    }
    
    // 4. Store original function
    const originalRenderTemplate = target.renderTemplate;
    
    // 5. Import our renderer
    const { renderTemplate: optimizedRenderTemplate } = await import("../../utils/template-renderer.js");
    
    // 6. Define patched function with caching and metrics
    const patchedRenderTemplate = async function(templatePath, data = {}) {
      const startTime = performance.now();
      
      try {
        // Use optimized renderer with caching
        const result = await optimizedRenderTemplate(templatePath, data);
        
        // Record performance metrics
        const duration = performance.now() - startTime;
        if (duration > 100) { // Log slow renders
          console.debug(`UESRPG | Template render took ${duration.toFixed(1)}ms: ${templatePath}`);
        }
        
        return result;
      } catch (error) {
        // Fall back to original if our renderer fails
        console.warn(`UESRPG | Optimized renderer failed for ${templatePath}, falling back`, error);
        return originalRenderTemplate.call(this, templatePath, data);
      }
    };
    
    // 7. Add metadata to patched function for identification
    patchedRenderTemplate._uesrpgPatched = true;
    patchedRenderTemplate._original = originalRenderTemplate;
    
    // 8. Safely define or assign the property
    if (descriptor && descriptor.configurable) {
      // Property exists and is configurable - redefine it
      Object.defineProperty(target, propertyName, {
        value: patchedRenderTemplate,
        writable: true,
        configurable: true,
        enumerable: true
      });
    } else {
      // Property doesn't exist or we can't redefine - assign directly
      target[propertyName] = patchedRenderTemplate;
    }
    
    // 9. Mark as patched
    target._uesrpgRenderTemplatePatched = true;
    
    console.log("UESRPG | Successfully patched foundry.applications.handlebars.renderTemplate");
    return true;
    
  } catch (err) {
    console.error("UESRPG | Failed to patch Foundry renderTemplate", err);
    
    // Don't throw - allow system to boot with unpatched renderer
    return false;
  }
}

/**
 * Alternative wrapper approach when direct patching is not possible
 * Uses proxy-based interception when property is non-configurable and non-writable
 */
async function createWrapperInsteadOfPatch(target, propertyName, descriptor) {
  try {
    const original = target[propertyName];
    
    // Import our renderer
    const { renderTemplate: optimizedRenderTemplate } = await import("../../utils/template-renderer.js");
    
    // Create a wrapper that intercepts calls
    const wrapper = async function(templatePath, data = {}) {
      const startTime = performance.now();
      
      // Check if we should use optimized renderer for this template
      const useOptimized = templatePath?.includes('systems/uesrpg-3ev4/');
      
      if (useOptimized) {
        try {
          // Use optimized renderer for system templates
          const result = await optimizedRenderTemplate(templatePath, data);
          
          const duration = performance.now() - startTime;
          if (duration > 100) {
            console.debug(`UESRPG | Optimized render took ${duration.toFixed(1)}ms: ${templatePath}`);
          }
          
          return result;
        } catch (error) {
          console.warn(`UESRPG | Optimized renderer failed for ${templatePath}, using original`, error);
        }
      }
      
      // Use original for non-system templates or on failure
      return original.call(this, templatePath, data);
    };
    
    // Store reference to original
    wrapper._uesrpgWrapper = true;
    wrapper._original = original;
    
    // Try to replace the property if possible (even if non-configurable but writable)
    // This handles the case where descriptor.writable might be true even if configurable is false
    if (descriptor && descriptor.writable === true) {
      try {
        // Try to assign the wrapper directly
        target[propertyName] = wrapper;
        if (game.settings.get("uesrpg-3ev4", "templateDebug")) {
          console.warn("UESRPG | Successfully assigned wrapper to non-configurable but writable property");
        }
        return true;
      } catch (assignError) {
        if (game.settings.get("uesrpg-3ev4", "templateDebug")) {
          console.warn("UESRPG | Failed to assign wrapper to writable property", assignError);
        }
        // Continue to fallback approaches
      }
    }
    
    // If we can't replace the property, try to create a proxy for the entire object
    try {
      // Create a proxy that intercepts calls to the property
      const proxy = new Proxy(target, {
        get(obj, prop) {
          if (prop === propertyName) {
            // Return our wrapper when renderTemplate is accessed
            return wrapper;
          }
          // For all other properties, return the original
          return obj[prop];
        },
        set(obj, prop, value) {
          if (prop === propertyName) {
            // Allow setting the property (though it might not work)
            obj[prop] = value;
            return true;
          }
          // For all other properties, allow setting
          obj[prop] = value;
          return true;
        }
      });
      
      // Try to replace the reference to the object
      // This only works if we can modify the parent reference
      if (foundry?.applications && foundry.applications.handlebars === target) {
        foundry.applications.handlebars = proxy;
        console.warn("UESRPG | Created proxy for foundry.applications.handlebars to intercept renderTemplate calls");
        return true;
      }
    } catch (proxyError) {
      if (game.settings.get("uesrpg-3ev4", "templateDebug")) {
        console.warn("UESRPG | Proxy creation failed", proxyError);
      }
    }
    
    // Last resort: Store wrapper for manual use
    // Check if target object is extensible before adding properties
    if (Object.isExtensible(target)) {
      // We can add property to target object
      target._uesrpgRenderTemplateWrapper = wrapper;
      if (game.settings.get("uesrpg-3ev4", "templateDebug")) {
        console.warn("UESRPG | Created wrapper instead of patching (property non-configurable) - wrapper available at target._uesrpgRenderTemplateWrapper");
      }
    } else {
      // Target is not extensible - use alternative storage
      // Store wrapper in a separate registry
      if (!window._uesrpgTemplateWrappers) {
        window._uesrpgTemplateWrappers = new WeakMap();
      }
      window._uesrpgTemplateWrappers.set(target, wrapper);
      if (game.settings.get("uesrpg-3ev4", "templateDebug")) {
        console.warn("UESRPG | Created wrapper in external registry (target not extensible) - wrapper available via window._uesrpgTemplateWrappers");
      }
    }
    
    // Note: This is a partial solution - the wrapper won't intercept all calls
    // but at least it's available for our system to use
    return true;
    
  } catch (err) {
    console.error("UESRPG | Failed to create wrapper", err);
    return false;
  }
}

/**
 * Initialize template renderer
 */
function initializeOptimizedRenderer() {
  try {
    const renderer = initializeTemplateRenderer({
      debug: game.settings.get("uesrpg-3ev4", "templateDebug") || false
    });
    
    // Make renderer available globally for other modules
    game.uesrpg = game.uesrpg || {};
    game.uesrpg.templateRenderer = renderer;
    
    console.log("UESRPG | Initialized optimized template renderer");
    return true;
  } catch (err) {
    console.error("UESRPG | Failed to initialize optimized template renderer", err);
    return false;
  }
}

/**
 * Main function: preload Handlebars templates with optimization
 */
export async function preloadHandlebarsTemplatesOptimized() {
  const startTime = Date.now();
  
  console.log("UESRPG | Starting optimized template preloading...");
  
  try {
    // Check if template optimization is enabled via setting
    const optimizationEnabled = game.settings?.get("uesrpg-3ev4", "templateOptimization") !== false;
    if (!optimizationEnabled) {
      console.log("UESRPG | Template optimization disabled by setting, using fallback");
      return preloadHandlebarsTemplatesFallback();
    }
    
    // Phase 1: Initialize optimization systems with safety timeout
    let optimizationInitialized = false;
    try {
      initializeOptimizedHandlebars();
      initializeOptimizedRenderer();
      optimizationInitialized = true;
    } catch (initError) {
      console.warn("UESRPG | Failed to initialize template optimization systems", initError);
      // Continue without optimization - we'll use fallback rendering
    }
    
    // Only attempt to patch renderTemplate if optimization was successfully initialized
    if (optimizationInitialized) {
      await patchFoundryRenderTemplate();
    } else {
      console.log("UESRPG | Skipping renderTemplate patching due to initialization failure");
    }
    
    // Phase 2: Preload critical templates (blocking)
    const criticalSuccess = await preloadCriticalTemplates();
    
    if (!criticalSuccess) {
      console.warn("UESRPG | Critical template preloading failed, falling back to original");
      return preloadHandlebarsTemplatesFallback();
    }
    
    // Phase 3: Schedule deferred template loading (non-blocking)
    preloadDeferredTemplates();
    
    const totalElapsed = Date.now() - startTime;
    console.log(`UESRPG | Optimized template preloading completed in ${totalElapsed}ms`);
    
    return true;
  } catch (err) {
    console.error("UESRPG | Optimized template preloading failed, falling back", err);
    return preloadHandlebarsTemplatesFallback();
  }
}

/**
 * Fallback to original template loading
 */
async function preloadHandlebarsTemplatesFallback() {
  try {
    // Use the original template paths
    const templatePaths = [
      "systems/uesrpg-3ev4/templates/partials/sheets/fixed-header.hbs",
      "systems/uesrpg-3ev4/templates/partials/sheets/feature-inspector.hbs",
      "systems/uesrpg-3ev4/templates/partials/sheets/effects-tab.hbs",
      "systems/uesrpg-3ev4/templates/partials/sheets/feature-config-tab.hbs",
      "systems/uesrpg-3ev4/templates/partials/sheets/automation-tab.hbs",
      "systems/uesrpg-3ev4/templates/partials/sheets/feature-stat-sections.hbs",
      "systems/uesrpg-3ev4/templates/partials/sheets/feature-activation.hbs",
      "systems/uesrpg-3ev4/templates/v2/apps/enchanting-workshop.hbs",
      "systems/uesrpg-3ev4/templates/v2/apps/alchemy-workshop.hbs",
    ];
    
    const loader = foundry?.applications?.handlebars?.loadTemplates;
    if (typeof loader !== "function") {
      throw new Error("foundry.applications.handlebars.loadTemplates is not available");
    }
    
    await loader(templatePaths);
    console.log("UESRPG | Fallback template loading completed");
    
    return true;
  } catch (err) {
    console.error("UESRPG | Fallback template loading also failed", err);
    return false;
  }
}

/**
 * Get template optimization statistics
 */
export function getTemplateOptimizationStats() {
  try {
    const templateCache = game.uesrpg?.templateCache;
    const templateRenderer = game.uesrpg?.templateRenderer;
    
    if (!templateCache || !templateRenderer) {
      return { available: false, message: "Template optimization not initialized" };
    }
    
    const cacheStats = templateCache.getStats();
    const rendererStats = templateRenderer.getStats();
    
    return {
      available: true,
      cache: cacheStats,
      renderer: rendererStats,
      criticalTemplates: CRITICAL_TEMPLATES.length,
      deferredTemplates: DEFERRED_TEMPLATES.length,
      totalTemplates: CRITICAL_TEMPLATES.length + DEFERRED_TEMPLATES.length
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

/**
 * Clear template caches
 */
export function clearTemplateCaches() {
  try {
    const templateCache = game.uesrpg?.templateCache;
    const templateRenderer = game.uesrpg?.templateRenderer;
    
    if (templateCache) {
      templateCache.clear();
    }
    
    if (templateRenderer) {
      templateRenderer.clearRenderCache();
    }
    
    console.log("UESRPG | Cleared all template caches");
    return true;
  } catch (err) {
    console.error("UESRPG | Failed to clear template caches", err);
    return false;
  }
}

/**
 * Toggle template optimization
 */
export function setTemplateOptimizationEnabled(enabled) {
  try {
    game.settings.set("uesrpg-3ev4", "templateOptimization", enabled);
    console.log(`UESRPG | Template optimization ${enabled ? "enabled" : "disabled"}`);
    return true;
  } catch (err) {
    console.error("UESRPG | Failed to toggle template optimization", err);
    return false;
  }
}

/**
 * Check if template optimization is enabled
 */
export function isTemplateOptimizationEnabled() {
  try {
    return game.settings.get("uesrpg-3ev4", "templateOptimization") !== false;
  } catch (err) {
    return true; // Default to enabled
  }
}