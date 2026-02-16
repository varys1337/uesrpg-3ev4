/**
 * src/utils/ae-helpers.js
 * UESRPG 3ev4 — Active Effect Lifecycle Helpers
 *
 * Defensive utilities for safely interacting with Active Effects in a multi-user
 * environment where effects may be deleted concurrently.
 *
 * CRITICAL: Always use these helpers instead of direct actor.effects.get() or
 * fromUuid() when the effect might have been deleted by another user or workflow.
 */
import { isDebugEnabled } from "./debug.js";
import {
  requestCreateEmbeddedDocuments,
  requestUpdateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments
} from "./authority-proxy.js";

/**
 * Safely retrieve an Active Effect by ID from an actor, returning null if not found.
 * Double-checks the effect exists and is not a deleted stub.
 *
 * @param {Actor} actor
 * @param {string} effectId
 * @returns {ActiveEffect|null}
 */
export function safeGetEffect(actor, effectId) {
  const debug = isDebugEnabled("aeLifecycleDebug");
  
  if (!actor?.effects) {
    if (debug) console.debug(`[AE Lifecycle] Actor has no effects collection`);
    return null;
  }
  
  const effect = actor.effects.get(effectId);
  if (!effect?.id) {
    if (debug) console.debug(`[AE Lifecycle] Effect ${effectId} not found on ${actor.name}`);
    return null;
  }
  
  return effect;
}

/**
 * Safely retrieve an Active Effect by UUID, returning null on any error.
 * Useful for async workflows that may race with effect deletion.
 *
 * @param {string} uuid
 * @returns {Promise<ActiveEffect|null>}
 */
async function safeGetEffectByUuid(uuid) {
  if (!uuid || typeof uuid !== "string") return null;
  
  const debug = isDebugEnabled("aeLifecycleDebug");
  
  try {
    const effect = await fromUuid(uuid);
    if (!(effect instanceof ActiveEffect)) {
      if (debug) console.debug(`[AE Lifecycle] UUID ${uuid} is not an ActiveEffect`);
      return null;
    }
    return effect;
  } catch (err) {
    if (debug) {
      console.debug(`[AE Lifecycle] Effect UUID ${uuid} not found (expected if deleted):`, err.message);
    }
    return null;
  }
}

/**
 * Synchronously retrieve an Active Effect by UUID, returning null on any error.
 * Use with caution - prefer safeGetEffectByUuid() for async contexts.
 *
 * @param {string} uuid
 * @returns {ActiveEffect|null}
 */
export function safeGetEffectByUuidSync(uuid) {
  if (!uuid || typeof uuid !== "string") return null;
  
  const debug = isDebugEnabled("aeLifecycleDebug");
  const resolver = foundry?.utils?.fromUuidSync ?? globalThis.fromUuidSync;
  
  if (typeof resolver !== "function") {
    if (debug) console.debug(`[AE Lifecycle] fromUuidSync not available`);
    return null;
  }
  
  try {
    const effect = resolver(uuid);
    if (!(effect instanceof ActiveEffect)) {
      if (debug) console.debug(`[AE Lifecycle] UUID ${uuid} is not an ActiveEffect`);
      return null;
    }
    return effect;
  } catch (err) {
    if (debug) {
      console.debug(`[AE Lifecycle] Effect UUID ${uuid} not found (expected if deleted):`, err.message);
    }
    return null;
  }
}

/**
 * Check if an effect still exists on its parent actor.
 * Useful for validating cached effect references before mutations.
 *
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function effectExists(effect) {
  if (!effect?.parent?.effects) return false;
  return effect.parent.effects.has(effect.id);
}

/**
 * Check if an error is due to a missing/deleted document.
 * Use to distinguish expected "does not exist" errors from real failures.
 *
 * @param {Error|string} err
 * @returns {boolean}
 */
export function isMissingDocError(err) {
  const msg = String(err?.message ?? err ?? "");
  return msg.includes("does not exist") || 
         msg.includes("No Document") || 
         msg.includes("not found") ||
         msg.includes("Invalid document");
}

// ── Effect Grouping & Stacking (merged from ae-grouping.js) ─────────────────

const FLAG_SCOPE = "uesrpg-3ev4";

/**
 * Get the effect group identifier from an ActiveEffect.
 * @param {ActiveEffect|object} effect - The ActiveEffect document or effect data object
 * @returns {string|null} - The effectGroup string, or null if not set
 */
export function getEffectGroup(effect) {
  if (!effect) return null;
  
  try {
    const flags = effect?.flags ?? {};
    const scopeFlags = flags[FLAG_SCOPE] ?? {};
    const group = scopeFlags?.effectGroup;
    
    if (typeof group === "string" && group.trim().length > 0) {
      return group.trim();
    }
    
    return null;
  } catch (_e) {
    return null;
  }
}

/**
 * Apply a grouped ActiveEffect with stacking/override behavior.
 *
 * When effectData.flags.uesrpg-3ev4.stackRule is defined:
 * - "override": remove/disable other enabled effects with the same effectGroup
 * - "refresh": update existing effect instead of creating a new one
 * - "stack": no special grouping behavior (create normally)
 *
 * If stackRule is absent, no special behavior applies (legacy-safe).
 *
 * @param {Actor} actor - The target actor
 * @param {object} effectData - ActiveEffect data object (name, changes, flags, etc.)
 * @param {object} options - Optional configuration
 * @param {number} options.timeout - Timeout for proxy operations (default: 5000)
 * @returns {Promise<ActiveEffect|null>} - The created or updated effect, or null on failure
 */
export async function applyGroupedEffect(actor, effectData, { timeout = 5000 } = {}) {
  if (!actor || !effectData) return null;
  
  try {
    const flags = effectData?.flags ?? {};
    const scopeFlags = flags[FLAG_SCOPE] ?? {};
    const stackRule = scopeFlags?.stackRule;
    const effectGroup = scopeFlags?.effectGroup;
    
    // If no stackRule is defined, use legacy behavior (create normally)
    if (!stackRule || !effectGroup) {
      const created = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effectData], { timeout });
      return Array.isArray(created) ? (created[0] ?? null) : null;
    }
    
    // Find existing effects with the same group
    const existingEffects = actor.effects?.filter((e) => {
      if (!e || e.disabled) return false;
      const existingGroup = getEffectGroup(e);
      return existingGroup === effectGroup;
    }) ?? [];
    
    if (stackRule === "override") {
      // Remove or disable all existing effects in the group
      if (existingEffects.length > 0) {
        const idsToDelete = existingEffects.map((e) => e.id).filter(Boolean);
        if (idsToDelete.length > 0) {
          await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", idsToDelete, { timeout });
        }
      }
      
      // Create the new effect
      const created = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effectData], { timeout });
      return Array.isArray(created) ? (created[0] ?? null) : null;
    }
    
    if (stackRule === "refresh") {
      // Update existing effect if found, otherwise create new
      if (existingEffects.length > 0) {
        const existing = existingEffects[0];
        
        // Prepare update data (merge with existing where appropriate)
        const updateData = {
          _id: existing.id,
          name: effectData.name ?? existing.name,
          img: effectData.img ?? effectData.icon ?? existing.img,
          changes: Array.isArray(effectData.changes) ? effectData.changes : (existing.changes ?? []),
          flags: effectData.flags ?? existing.flags,
          duration: effectData.duration ?? existing.duration,
          disabled: effectData.disabled ?? false,
          origin: effectData.origin ?? existing.origin,
          statuses: effectData.statuses ?? existing.statuses,
          tint: effectData.tint ?? existing.tint,
          transfer: effectData.transfer ?? existing.transfer
        };
        
        const updated = await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", [updateData], { timeout });
        if (updated) {
          // Reload the effect to return the updated document
          try {
            return actor.effects?.get?.(existing.id) ?? existing;
          } catch (_e) {
            return existing;
          }
        }
        return existing;
      }
      
      // No existing effect found, create new
      const created = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effectData], { timeout });
      return Array.isArray(created) ? (created[0] ?? null) : null;
    }
    
    if (stackRule === "stack") {
      // No special behavior, create normally
      const created = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effectData], { timeout });
      return Array.isArray(created) ? (created[0] ?? null) : null;
    }
    
    // Unknown stackRule value, fall back to legacy behavior
    console.warn(`UESRPG | ae-grouping | Unknown stackRule value: ${stackRule}. Using legacy behavior.`);
    const created = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effectData], { timeout });
    return Array.isArray(created) ? (created[0] ?? null) : null;
  } catch (err) {
    console.error("UESRPG | ae-grouping | applyGroupedEffect failed", { actorUuid: actor?.uuid, err });
    return null;
  }
}
