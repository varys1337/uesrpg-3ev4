import { registerOnce } from "../_internal/hook-registry.js";
import { invalidateActorDerivedCache } from "../../core/actors/derived-cache/actor-derived-cache.js";

/**
 * Helper A: Resolve the owning Actor for an embedded Item.
 * @param {Item} item - The item to check
 * @returns {Actor|null} The owning actor, or null if not owned by an actor
 */
function resolveOwningActor(item) {
  if (item?.parent?.documentName === "Actor") return item.parent;
  return null;
}

/**
 * Helper B: Check if an item currently has at least one embedded ActiveEffect with transfer === true.
 * @param {Item} item - The item to check
 * @returns {boolean} True if the item has any transfer effect
 */
function hasTransferEffect(item) {
  return item?.effects?.some(effect => effect.transfer === true) ?? false;
}

/**
 * Helper C: Check if an update payload can change whether transfer effects from that item apply.
 * @param {object} changed - The update payload (changed data)
 * @returns {boolean} True if the update touches transfer activation lanes
 */
function updateTouchesTransferActivation(changed) {
  if (!changed || typeof changed !== "object") return false;

  // Check system paths: system.equipped, system.active, system.isActive
  const systemPaths = ["system.equipped", "system.active", "system.isActive"];
  for (const path of systemPaths) {
    if (foundry.utils.hasProperty(changed, path)) return true;
  }

  // Check flag paths ending with .activeSpell or .featureConfig.suppressSelfTransfer
  const flagSuffixes = [".activeSpell", ".featureConfig.suppressSelfTransfer"];
  
  /**
   * Recursively check if any key in the object ends with one of the target suffixes.
   * @param {object} obj - The object to check
   * @param {string} currentPath - Current path (for debugging)
   * @param {number} depth - Current recursion depth
   * @returns {boolean} True if a matching suffix is found
   */
  function checkObject(obj, currentPath = "", depth = 0) {
    // Safety: limit recursion depth
    if (depth > 10) return false;
    
    if (!obj || typeof obj !== "object") return false;
    
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = currentPath ? `${currentPath}.${key}` : key;
      
      // Check if this key ends with any target suffix
      for (const suffix of flagSuffixes) {
        if (fullKey.endsWith(suffix)) return true;
      }
      
      // Recursively check nested objects
      if (value && typeof value === "object") {
        if (checkObject(value, fullKey, depth + 1)) return true;
      }
    }
    
    return false;
  }
  
  // Only check the flags portion of the changed object
  if (changed.flags && typeof changed.flags === "object") {
    return checkObject(changed.flags);
  }
  
  return false;
}

/**
 * Helper D: Invalidate items and prepare lanes for an actor.
 * @param {Actor} actor - The actor whose cache to invalidate
 */
function invalidateItemsPrepare(actor) {
  if (!actor || actor.documentName !== "Actor") return;
  invalidateActorDerivedCache(actor, { lanes: ["items", "prepare"] });
}

/**
 * Helper E: Invalidate items, prepare, and ae lanes for an actor.
 * @param {Actor} actor - The actor whose cache to invalidate
 */
function invalidateItemsPrepareAE(actor) {
  if (!actor || actor.documentName !== "Actor") return;
  invalidateActorDerivedCache(actor, { lanes: ["items", "prepare", "ae"] });
}

/**
 * Register item/prepare cache invalidation hooks.
 * Follows the same pattern as registerAECacheInvalidation.
 */
export function registerItemPrepareCacheInvalidation() {
  registerOnce("hooks:item-prepare-cache-invalidation", () => {
    // Hook for item creation
    Hooks.on("createItem", (item) => {
      const actor = resolveOwningActor(item);
      if (!actor) return;
      
      if (hasTransferEffect(item)) {
        invalidateItemsPrepareAE(actor);
      } else {
        invalidateItemsPrepare(actor);
      }
    });
    
    // Hook for item updates
    Hooks.on("updateItem", (item, changed) => {
      const actor = resolveOwningActor(item);
      if (!actor) return;
      
      const hasTransfer = hasTransferEffect(item);
      const touchesTransfer = updateTouchesTransferActivation(changed);
      
      if (hasTransfer && touchesTransfer) {
        invalidateItemsPrepareAE(actor);
      } else {
        invalidateItemsPrepare(actor);
      }
    });
    
    // Hook for item deletion
    Hooks.on("deleteItem", (item) => {
      const actor = resolveOwningActor(item);
      if (!actor) return;
      
      if (hasTransferEffect(item)) {
        invalidateItemsPrepareAE(actor);
      } else {
        invalidateItemsPrepare(actor);
      }
    });
  });
}