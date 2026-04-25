/**
 * Guardrails for ranged attacks that require ammunition and/or reload state.
 * This gate must run BEFORE committing ammo and before finalizing the attack resolution.
 *
 * Returns an object:
 *  - ok: boolean
 *  - reason: string (for user-facing notifications)
 *  - code: short code for debugging/telemetry
 */
import { getWeaponCombatCapabilities } from "../../combat-utils.js";

export function gateRangedAttackAmmoAndLoad({ actor, weapon, ammoItem } = {}) {
  const capabilities = getWeaponCombatCapabilities(weapon);
  if (!capabilities.rangedCapable) return { ok: true, reason: "", code: "NOT_RANGED" };

  // If weapon consumes ammo, ammoId should exist. Treat empty ammoId as "no ammo binding".
  const ammoId = String(weapon?.system?.ammoId ?? "").trim();
  const consumeAmmo = capabilities.consumesAmmo;

  // Reload requirement is derived from reloadAPCost > 0; require loaded state if so.
  const requiresReload = capabilities.requiresReload;
  const isLoaded = weapon?.system?.reloadState?.isLoaded === true;

  if (requiresReload && !isLoaded) {
    return { ok: false, reason: "Weapon is not loaded. Reload before firing.", code: "NOT_LOADED" };
  }

  // Ammo gating
  if (consumeAmmo) {
    if (!ammoId) {
      return { ok: false, reason: "No ammunition selected for this weapon.", code: "AMMO_MISSING" };
    }
    // If there's a binding but ammo cannot be resolved, we must block.
    if (!ammoItem) {
      return { ok: false, reason: "No ammunition available for this weapon.", code: "AMMO_MISSING" };
    }
    // If there's an ammo item but quantity is not enough, block.
    const qty = Number(ammoItem?.system?.quantity ?? ammoItem?.system?.qty ?? 0);
    if (ammoItem && (!Number.isFinite(qty) || qty <= 0)) {
      return { ok: false, reason: "Ammunition quantity is 0.", code: "AMMO_EMPTY" };
    }
  }

  return { ok: true, reason: "", code: "OK" };
}
