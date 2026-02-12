/**
 * src/core/combat/ward-defense.js
 *
 * Ward spell defense utility functions.
 *
 * Ward may be cast as a reaction to an attack in place of the character's
 * normal defense. It acts as a shield granting [Spell Strength] Magical and
 * Physical BR. Power Block is incompatible with this shield.
 *
 * Detection strategy: look for Active Effects on the defender whose origin
 * name matches the Ward pattern (from a spell with activeSpell flag).
 * Fall back to spell items on the actor named "Ward" with activeSpell flag.
 */

const _SYSTEM_ID = "uesrpg-3ev4";

/**
 * Detect whether the actor has an active Ward spell available for defense.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasActiveWard(actor) {
  if (!actor) return false;
  return Boolean(_findActiveWardSpell(actor));
}

/**
 * Get the Ward spell's Block Rating (= Spell Strength) for the active Ward.
 * Ward provides equal Physical and Magical BR (unlike normal shields).
 *
 * @param {Actor} actor
 * @param {string} [damageType="physical"] - Ignored for Ward (same BR for all types).
 * @returns {number} The Block Rating (Spell Strength), or 0 if no active Ward.
 */
export function getWardBlockRating(actor, damageType = "physical") {
  const ward = _findActiveWardSpell(actor);
  if (!ward) return 0;
  return Math.max(0, Number(ward.system?.spell_str ?? 0) || 0);
}

/**
 * Get the active Ward spell item on the actor (if any).
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function getActiveWardSpell(actor) {
  return _findActiveWardSpell(actor);
}

/**
 * Internal: find the highest-SS active Ward spell on the actor.
 *
 * Detection heuristic:
 *  1. Look for spell items named "Ward" (case-insensitive) with the activeSpell flag.
 *  2. If multiple, pick the one with the highest spell_str.
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
function _findActiveWardSpell(actor) {
  if (!actor?.items) return null;
  let best = null;
  let bestSS = -1;

  for (const item of actor.items) {
    if (item.type !== "spell") continue;
    // Name must be exactly "Ward" (case-insensitive) to avoid false positives
    // like "Magic Ward", "Warden's Oath", etc.
    if (String(item.name ?? "").trim().toLowerCase() !== "ward") continue;
    // Must be flagged as active
    const active = item.getFlag?.(_SYSTEM_ID, "activeSpell")
      ?? foundry.utils.getProperty(item, `flags.${_SYSTEM_ID}.activeSpell`);
    if (!active) continue;

    const ss = Number(item.system?.spell_str ?? 0) || 0;
    if (ss > bestSS) {
      best = item;
      bestSS = ss;
    }
  }
  return best;
}
