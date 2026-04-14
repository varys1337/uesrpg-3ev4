/**
 * Memoization cache invalidation hooks.
 * 
 * This module registers hooks to clear memoization caches when data changes,
 * ensuring cache consistency without stale data.
 * 
 * @module register-memoization-cache-invalidation
 */

import { registerOnce } from "../_internal/hook-registry.js";
import { clearAllMemoizationCaches } from "../../utils/memoization.js";

/**
 * Resolve the owning actor for a document.
 * 
 * @param {Document} doc - The document (item, effect, actor)
 * @returns {Actor|null} - The owning actor, if any
 */
function resolveOwningActor(doc) {
  if (!doc) return null;
  
  // If it's already an actor
  if (doc.documentName === "Actor") return doc;
  
  // If it's an item, get its parent
  if (doc.documentName === "Item") {
    return doc.parent;
  }
  
  // If it's an active effect, get its parent's parent
  if (doc.documentName === "ActiveEffect") {
    return doc.parent?.parent || null;
  }
  
  return null;
}

/**
 * Check if a change affects actor-derived data that should invalidate caches.
 * 
 * @param {Object} changed - The changed data
 * @returns {boolean} - True if the change affects derived data
 */
function changeAffectsDerivedData(changed) {
  if (!changed || typeof changed !== "object") return false;
  
  // Check for changes to system data (most derived data comes from system)
  if (changed.system) return true;
  
  // Check for changes to flags (which can affect derived data)
  if (changed.flags) return true;
  
  // Check for specific fields that affect derived data
  const derivedFields = [
    "type", "name", "img", "effects", "items",
    "system.skills", "system.attributes", "system.traits",
    "system.equipment", "system.inventory", "system.magic"
  ];
  
  for (const field of derivedFields) {
    if (field in changed) return true;
  }
  
  return false;
}

/**
 * Register hooks to clear memoization caches when data changes.
 */
export function registerMemoizationCacheInvalidation() {
  registerOnce("hooks:memoization-cache-invalidation", () => {
    // Clear all caches when any actor changes significantly
    Hooks.on("updateActor", (actor, changed) => {
      if (!changeAffectsDerivedData(changed)) return;
      
      // Clear memoization caches for this actor
      if (actor._uesrpgMemoizationCaches) {
        actor._uesrpgMemoizationCaches.clear();
      }
      
      // Also clear global caches that might be affected
      clearAllMemoizationCaches();
    });
    
    // Clear caches when items change
    Hooks.on("createItem", (item) => {
      const actor = resolveOwningActor(item);
      if (!actor) return;
      
      // Clear actor-specific caches
      if (actor._uesrpgMemoizationCaches) {
        actor._uesrpgMemoizationCaches.clear();
      }
      
      // Clear global item-related caches
      clearAllMemoizationCaches();
    });
    
    Hooks.on("updateItem", (item, changed) => {
      const actor = resolveOwningActor(item);
      if (!actor) return;
      
      if (!changeAffectsDerivedData(changed)) return;
      
      // Clear actor-specific caches
      if (actor._uesrpgMemoizationCaches) {
        actor._uesrpgMemoizationCaches.clear();
      }
      
      // Clear global item-related caches
      clearAllMemoizationCaches();
    });
    
    Hooks.on("deleteItem", (item) => {
      const actor = resolveOwningActor(item);
      if (!actor) return;
      
      // Clear actor-specific caches
      if (actor._uesrpgMemoizationCaches) {
        actor._uesrpgMemoizationCaches.clear();
      }
      
      // Clear global item-related caches
      clearAllMemoizationCaches();
    });
    
    // Clear caches when effects change
    Hooks.on("createActiveEffect", (effect) => {
      const actor = resolveOwningActor(effect);
      if (!actor) return;
      
      // Clear actor-specific caches
      if (actor._uesrpgMemoizationCaches) {
        actor._uesrpgMemoizationCaches.clear();
      }
      
      // Clear global effect-related caches
      clearAllMemoizationCaches();
    });
    
    Hooks.on("updateActiveEffect", (effect, changed) => {
      const actor = resolveOwningActor(effect);
      if (!actor) return;
      
      if (!changeAffectsDerivedData(changed)) return;
      
      // Clear actor-specific caches
      if (actor._uesrpgMemoizationCaches) {
        actor._uesrpgMemoizationCaches.clear();
      }
      
      // Clear global effect-related caches
      clearAllMemoizationCaches();
    });
    
    Hooks.on("deleteActiveEffect", (effect) => {
      const actor = resolveOwningActor(effect);
      if (!actor) return;
      
      // Clear actor-specific caches
      if (actor._uesrpgMemoizationCaches) {
        actor._uesrpgMemoizationCaches.clear();
      }
      
      // Clear global effect-related caches
      clearAllMemoizationCaches();
    });
    
    // Clear caches when combat changes (affects many derived values)
    Hooks.on("updateCombat", (combat, changed) => {
      if (changed.combatant || changed.round || changed.turn) {
        clearAllMemoizationCaches();
      }
    });
    
    // Clear caches when scene changes (affects token positions, etc.)
    Hooks.on("updateScene", (scene, changed) => {
      if (changed.tokens || changed.dimensions || changed.grid) {
        clearAllMemoizationCaches();
      }
    });
    
    // Clear caches when settings change (could affect derived data)
    Hooks.on("updateSetting", (setting) => {
      if (setting.key?.includes("uesrpg")) {
        clearAllMemoizationCaches();
      }
    });
    
    // Debug command to manually clear caches
    Hooks.once("ready", () => {
      if (game.user.isGM) {
        game.socket?.on("system.uesrpg-3ev4", (data) => {
          if (data.type === "clearMemoizationCaches") {
            clearAllMemoizationCaches();
            console.log("UESRPG | Cleared all memoization caches via socket command");
          }
        });
        
        // Add console command for debugging
        globalThis.clearUESRPGMemoizationCaches = clearAllMemoizationCaches;
      }
    });
    
    console.log("UESRPG | Registered memoization cache invalidation hooks");
  });
}

/**
 * Get or create actor-specific memoization cache registry.
 * 
 * @param {Actor} actor - The actor
 * @returns {Map} - Actor-specific cache registry
 */
export function getActorMemoizationCache(actor) {
  if (!actor._uesrpgMemoizationCaches) {
    actor._uesrpgMemoizationCaches = new Map();
  }
  return actor._uesrpgMemoizationCaches;
}

/**
 * Clear memoization caches for a specific actor.
 * 
 * @param {Actor} actor - The actor
 */
export function clearActorMemoizationCaches(actor) {
  if (actor._uesrpgMemoizationCaches) {
    actor._uesrpgMemoizationCaches.clear();
  }
}

/**
 * Check if memoization cache invalidation is registered.
 * 
 * @returns {boolean} - True if registered
 */
export function isMemoizationCacheInvalidationRegistered() {
  const registry = game.uesrpg?._internal?.hooks;
  return registry?.has("hooks:memoization-cache-invalidation") || false;
}