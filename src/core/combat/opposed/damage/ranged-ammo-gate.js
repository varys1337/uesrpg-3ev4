/**
 * Guardrails for ranged attacks that require ammunition and/or reload state.
 * This gate must run BEFORE committing ammo and before finalizing the attack resolution.
 *
 * Returns an object:
 *  - ok: boolean
 *  - reason: string (for user-facing notifications)
 *  - code: short code for debugging/telemetry
 */
export function gateRangedAttackAmmoAndLoad({ actor, weapon, ammoItem } = {}) {
  const mode = String(weapon?.system?.attackMode ?? "").toLowerCase();
  if (mode !== "ranged") return { ok: true, reason: "", code: "NOT_RANGED" };

  // If weapon consumes ammo, ammoId should exist. Treat empty ammoId as "no ammo binding".
  const ammoId = String(weapon?.system?.ammoId ?? "").trim();
  const consumeAmmo = weapon?.system?.consumeAmmo !== false;

  // Reload requirement is derived from reloadAPCost > 0; require loaded state if so.
  const requiresReload = weapon?.system?.reloadState?.requiresReload === true;
  const isLoaded = weapon?.system?.reloadState?.isLoaded === true;

  if (requiresReload && !isLoaded) {
    return { ok: false, reason: "Weapon is not loaded. Reload before firing.", code: "NOT_LOADED" };
  }

  // Ammo gating
  if (consumeAmmo) {
    // If there's a binding but ammo cannot be resolved, we must block.
    if (ammoId && !ammoItem) {
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

