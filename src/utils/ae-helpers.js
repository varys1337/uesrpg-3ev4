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
import { FLAG_SCOPE } from "../core/constants.js";
import {
  requestDeleteEmbeddedDocuments
} from "./authority-proxy.js";
import {
  hasEmbeddedDocument,
  isMissingDocumentError,
  normalizeEmbeddedDocumentIds
} from "./authority-proxy/embedded-docs.js";
import { claimRecentEmbeddedDeletes, settleRecentEmbeddedDeletes } from "./embedded-delete-guard.js";
import { resolveUuidSync } from "./uuid-cache.js";
import { applyGenericStackPolicy } from "../core/active-effects/stack-policy.js";

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

  try {
    const effect = resolveUuidSync(uuid);
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
  return isMissingDocumentError(err);
}

export async function safeDeleteEmbeddedDocuments(parent, embeddedName, docIds, { context = "AE Lifecycle", logUnexpected = true, deleteOptions = {} } = {}) {
  if (!parent || !embeddedName) return false;
  const normalizedIds = normalizeEmbeddedDocumentIds(docIds);
  if (!normalizedIds.length) return false;

  const liveIds = normalizedIds.filter((docId) => hasEmbeddedDocument(parent, embeddedName, docId));
  if (!liveIds.length) return false;
  const claimedIds = claimRecentEmbeddedDeletes(parent, embeddedName, liveIds, { source: context });
  if (!claimedIds.length) return false;

  try {
    const deleted = await requestDeleteEmbeddedDocuments(parent, embeddedName, claimedIds, { deleteOptions });
    if (deleted) return true;
  } catch (err) {
    if (isMissingDocError(err)) return false;
    if (claimedIds.every((docId) => !hasEmbeddedDocument(parent, embeddedName, docId))) return true;
    if (!logUnexpected) return false;
    console.error(`${context} | Failed to delete embedded documents`, {
      parentUuid: parent?.uuid ?? null,
      embeddedName,
      docIds: claimedIds,
      err
    });
    return false;
  } finally {
    settleRecentEmbeddedDeletes(parent, embeddedName, claimedIds, { source: context });
  }

  const survivingIds = claimedIds.filter((docId) => hasEmbeddedDocument(parent, embeddedName, docId));
  if (!survivingIds.length) return true;
  if (logUnexpected) {
    console.error(`${context} | Failed to delete embedded documents`, {
      parentUuid: parent?.uuid ?? null,
      embeddedName,
      docIds: claimedIds,
      survivingIds
    });
  }
  return false;
}

export async function safeDeleteEmbeddedDocument(parent, embeddedName, docId, { context = "AE Lifecycle", logUnexpected = true, deleteOptions = {} } = {}) {
  if (!parent || !embeddedName || !docId) return false;
  return safeDeleteEmbeddedDocuments(parent, embeddedName, [docId], { context, logUnexpected, deleteOptions });
}

// ── Effect Grouping & Stacking (merged from ae-grouping.js) ─────────────────

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
  return await applyGenericStackPolicy(actor, effectData, { timeout });
}
