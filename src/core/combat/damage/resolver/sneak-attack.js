/**
 * src/core/combat/damage/resolver/sneak-attack.js
 *
 * Sneak attack pending state management for damage resolution.
 */

import { getSystemId } from "./sources.js";

/**
 * Time-to-live for pending sneak attack flags (30 seconds).
 */
export const PENDING_SNEAK_TTL_MS = 30000;

/**
 * Consume a pending sneak attack flag if it matches the current attack context.
 * @param {Actor} attackerActor
 * @param {object} options
 * @param {Item|null} options.weapon
 * @param {string|null} options.attackMode
 * @returns {boolean} True if a pending sneak attack was consumed
 */
export function consumePendingSneakAttack(attackerActor, { weapon = null, attackMode = null } = {}) {
  try {
    if (!attackerActor || typeof attackerActor.getFlag !== "function") return false;
    const systemId = getSystemId();
    const pending = attackerActor.getFlag(systemId, "combat.pendingSneakAttack");
    if (!pending || typeof pending !== "object") return false;

    const ageMs = Date.now() - Number(pending.at ?? 0);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > PENDING_SNEAK_TTL_MS) {
      if (typeof attackerActor.unsetFlag === "function") {
        attackerActor.unsetFlag(systemId, "combat.pendingSneakAttack").catch(() => {});
      }
      return false;
    }

    const pendingWeapon = String(pending.weaponUuid ?? "").trim();
    const weaponUuid = String(weapon?.uuid ?? "").trim();
    if (pendingWeapon) {
      if (!weaponUuid || pendingWeapon !== weaponUuid) return false;
    }

    const pendingMode = String(pending.attackMode ?? "").trim().toLowerCase();
    const mode = String(attackMode ?? "").trim().toLowerCase();
    if (pendingMode) {
      if (!mode || pendingMode !== mode) return false;
    }

    if (typeof attackerActor.unsetFlag === "function") {
      attackerActor.unsetFlag(systemId, "combat.pendingSneakAttack").catch(() => {});
    }
    return true;
  } catch (_e) {
    return false;
  }
}
