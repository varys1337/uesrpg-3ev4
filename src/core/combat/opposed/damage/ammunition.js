/**
 * @file src/core/combat/opposed/damage/ammunition.js
 * Ammunition consumption and reload tracking for opposed combat workflow.
 * @module opposed/damage/ammunition
 *
 * Extracted from monolithic opposed-workflow.js Phase 16 (2025-01-27).
 * Consolidated with ammo.js in Phase 17 (2026-02-03).
 *
 * Provides:
 * - Post-attack ammunition consumption with robust UUID resolution
 * - Reload state tracking for ranged weapons
 *
 * Dependencies:
 * - Foundry VTT fromUuid(), Actor.updateEmbeddedDocuments()
 * - Permission-aware: works with synthetic (unlinked) tokens
 *
 * Consumption strategy:
 * 1. Prefer Actor + embedded Item ID (handles synthetic tokens)
 * 2. Fallback to direct UUID resolution
 * 3. Error handling with user notifications
 */

import { setOwnedItemQuantityOrDelete } from "../../../items/owned-item-quantity.js";

/**
 * Resolve an actor from a UUID, handling token/actor edge cases.
 *
 * @param {string} uuid - Actor or TokenDocument UUID
 * @returns {Promise<Actor|null>} Resolved actor or null
 * @private
 */
async function _resolveActor(uuid) {
  if (!uuid) return null;
  const doc = await fromUuid(uuid);
  if (!doc) return null;

  // Actor document
  if (doc.documentName === "Actor") return doc;

  // TokenDocument (synthetic Actor lives here)
  if (doc.documentName === "Token" && doc.actor) return doc.actor;

  // TokenDocument in some contexts may resolve as a Scene or other parent; fall through
  return doc.actor ?? null;
}

/**
 * Consume pending ammunition after a ranged attack.
 *
 * **Timing**: Ammunition is consumed at attack time (prior to the attack roll).
 * This function is called to finalize consumption stored in `pendingAmmo` object.
 *
 * **Strategy**:
 * - Attempt 1: Update via Actor + embedded Item ID (handles synthetic tokens)
 * - Attempt 2: Update via direct Item UUID resolution
 * - Error handling: Logs failures, notifies user
 *
 * @param {Object} pendingAmmo - Pending ammunition consumption details
 * @param {string} pendingAmmo.ammoUuid - Full UUID of ammunition item
 * @param {string} pendingAmmo.actorUuid - UUID of parent actor
 * @param {string} pendingAmmo.ammoId - Embedded document ID
 * @param {number} pendingAmmo.qtyAfter - Quantity after consumption
 * @param {string} pendingAmmo.ammoName - Ammunition name for notifications
 * @returns {Promise<boolean>} True if consumed successfully, false otherwise
 */
export async function consumePendingAmmo(pendingAmmo) {
  if (!pendingAmmo) return true;

  const { ammoUuid, actorUuid, ammoId, qtyAfter, ammoName } = pendingAmmo;

  try {
    // Attempt 1: consume via Actor + embedded Item id
    if (actorUuid && ammoId) {
      const actor = await _resolveActor(actorUuid);
      const ammo = actor?.items?.get?.(ammoId) ?? null;

      if (ammo && ammo.type === "ammunition") {
        const qty = Number(ammo.system?.quantity ?? 0);
        const next = Math.min(qty, Math.max(0, Number(qtyAfter ?? 0)));
        if (next !== qty) {
          await setOwnedItemQuantityOrDelete({ actor, itemId: ammoId, item: ammo, quantity: next });
        }
        return true;
      }
    }

    // Attempt 2: consume by resolving the embedded Item UUID directly
    if (ammoUuid) {
      const doc = await fromUuid(ammoUuid);
      if (!doc) {
        ui.notifications.warn(`${ammoName || "Ammunition"}: could not be resolved for consumption.`);
        return false;
      }
      const qty = Number(doc.system?.quantity ?? 0);
      const next = Math.min(qty, Math.max(0, Number(qtyAfter ?? 0)));
      if (next !== qty) {
        await setOwnedItemQuantityOrDelete({ actor: doc.parent, itemId: doc.id, item: doc, quantity: next });
      }
      return true;
    }

    ui.notifications.warn(`${ammoName || "Ammunition"}: could not be resolved for consumption.`);
    return false;
  } catch (err) {
    console.error("UESRPG | Failed to consume ammo", { pendingAmmo, err });
    ui.notifications.error(`${ammoName || "Ammunition"}: failed to consume. See console for details.`);
    return false;
  }
}

/**
 * Mark a ranged weapon as needing reload after it's fired.
 * Called immediately after firing a reload-required weapon.
 * 
 * @param {Item} weapon - The ranged weapon that was fired
 * @returns {Promise<boolean>} True if successfully marked, false otherwise
 */
export async function markWeaponNeedsReload(weapon) {
  if (!weapon || weapon.type !== "weapon") return false;
  if (String(weapon.system?.attackMode ?? "").toLowerCase() !== "ranged") return false;
  if (!weapon.system?.reloadState?.requiresReload) return false;

  try {
    const success = await requestUpdateDocument(weapon, {
      "system.reloadState.isLoaded": false
    });
    return success !== false;
  } catch (err) {
    console.warn("UESRPG | Failed to mark weapon as needing reload:", err);
    return false;
  }
}
