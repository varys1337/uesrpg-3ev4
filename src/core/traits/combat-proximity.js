/**
 * @module traits/combat-proximity
 * @description Deterministic proximity helpers for combat-talent automation.
 *
 * Scope:
 * - Provide small, reusable token-distance utilities.
 * - Avoid persistent state; compute from live canvas token data.
 *
 * Notes:
 * - This file intentionally does not depend on UI sheets or workflows.
 * - All functions are defensive and return safe defaults when the canvas is unavailable.
 */

import { hasTalent } from "./talents-api.js";
import { _num as _asNumber } from "./_primitives.js";

function _distanceMeters(tokenA, tokenB) {
  try {
    if (!canvas?.grid || !tokenA?.center || !tokenB?.center) return Infinity;

    // Foundry v13+: prefer the grid implementation's measurePath.
    // This avoids the deprecated SquareGrid#measureDistances pathway.
    const gridImpl = canvas.grid;
    if (gridImpl?.measurePath) {
      const result = gridImpl.measurePath([tokenA.center, tokenB.center]);
      const d = Number(result?.distance);
      return Number.isFinite(d) ? d : Infinity;
    }

    // Defensive fallback (should not be hit on v13).
    const d = Number(canvas.grid.measureDistance?.(tokenA.center, tokenB.center));
    return Number.isFinite(d) ? d : Infinity;
  } catch (_e) {
    return Infinity;
  }
}

function _iterPlaceables() {
  try {
    return Array.from(canvas?.tokens?.placeables ?? []);
  } catch (_e) {
    return [];
  }
}

function _sameDisposition(aToken, bToken) {
  const a = aToken?.document?.disposition;
  const b = bToken?.document?.disposition;
  return a != null && b != null && a === b;
}

function _isHiddenOrNeutral(token) {
  const disp = token?.document?.disposition;
  const hidden = token?.document?.hidden === true;
  return hidden || disp === 0;
}

function _isOpponent(selfToken, otherToken) {
  // Deterministic opponent definition for combat-talent proximity:
  // - Ignore neutral tokens (disposition 0): they should not gate duel/solo checks.
  // - Ignore hidden/secret tokens: they should not gate duel/solo checks.
  // - Opponent = opposite disposition.
  const a = selfToken?.document?.disposition;
  const b = otherToken?.document?.disposition;

  if (_isHiddenOrNeutral(otherToken)) return false;

  if (a != null && b != null) {
    if (a === 0 || b === 0) return false;
    return a !== b;
  }
  // Fallback: treat non-self as opponent.
  return true;
}

/**
 * Resolve a canvas token for an actor.
 *
 * Preference:
 * 1) Controlled token for that actor (if any)
 * 2) First scene token for that actor
 */
export function getActorCanvasToken(actor) {
  if (!actor || !canvas?.tokens) return null;
  const controlled = canvas.tokens.controlled ?? [];
  const ownedControlled = controlled.find(t => t?.actor?.id === actor.id) ?? null;
  if (ownedControlled) return ownedControlled;
  const placeables = canvas.tokens.placeables ?? [];
  return placeables.find(t => t?.actor?.id === actor.id) ?? null;
}

/**
 * Determine melee reach in meters.
 *
 * Source-of-truth note:
 * - The system does not currently expose a single documented melee reach field.
 * - We use a conservative fallback of 2 meters, which is a common melee adjacency.
 */
export function getMeleeReachMeters(actor) {
  const direct = _asNumber(actor?.system?.meleeReachMeters, NaN);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const fromSystem = _asNumber(actor?.system?.combat?.meleeReachMeters, NaN);
  if (Number.isFinite(fromSystem) && fromSystem > 0) return fromSystem;
  return 2;
}

export function isWithinMeleeRange(tokenA, tokenB, reachMeters = 2) {
  const reach = Math.max(0, _asNumber(reachMeters, 2));
  if (!tokenA || !tokenB) return false;
  return _distanceMeters(tokenA, tokenB) <= reach;
}

/**
 * Count opponents within melee range of the given token.
 */
export function countOpponentsInMeleeRange(token, { reachMeters = 2 } = {}) {
  if (!token) return 0;
  const reach = Math.max(0, _asNumber(reachMeters, 2));
  let count = 0;
  for (const t of _iterPlaceables()) {
    if (!t || t.id === token.id) continue;
    if (!_isOpponent(token, t)) continue;
    if (isWithinMeleeRange(token, t, reach)) count++;
  }
  return count;
}

/**
 * True if ANY other token (friend or foe) is within melee range of either combatant.
 *
 * This supports constraints like: "no other characters within melee range of either one".
 */
export function anyOtherTokensInMeleeOfEither(tokenA, tokenB, { reachMetersA = 2, reachMetersB = 2 } = {}) {
  if (!tokenA || !tokenB) return false;
  const rA = Math.max(0, _asNumber(reachMetersA, 2));
  const rB = Math.max(0, _asNumber(reachMetersB, 2));

  for (const t of _iterPlaceables()) {
    if (!t) continue;
    if (t.id === tokenA.id || t.id === tokenB.id) continue;

    // Neutral or hidden/secret tokens do not gate "isolated duel" style constraints.
    if (_isHiddenOrNeutral(t)) continue;

    if (isWithinMeleeRange(tokenA, t, rA)) return true;
    if (isWithinMeleeRange(tokenB, t, rB)) return true;
  }

  return false;
}

/**
 * Check if an ally (same disposition as `allyToken`) with a given talent is in melee range of the opponent.
 */
export function hasAllyWithTalentInMeleeOfOpponent(allyToken, opponentToken, talentSlug, { reachMetersForAlly = 2 } = {}) {
  if (!allyToken || !opponentToken || !talentSlug) return false;
  const reach = Math.max(0, _asNumber(reachMetersForAlly, 2));

  for (const t of _iterPlaceables()) {
    if (!t) continue;
    if (t.id === allyToken.id || t.id === opponentToken.id) continue;
    if (_isHiddenOrNeutral(t)) continue;
    if (!_sameDisposition(allyToken, t)) continue;
    if (!hasTalent(t.actor, talentSlug)) continue;
    if (isWithinMeleeRange(t, opponentToken, reach)) return true;
  }

  return false;
}

/**
 * Check if any opponent with a given talent is in melee range of the token.
 *
 * Uses the opponent's melee reach for the range check to respect reach differences.
 *
 * @param {Token} selfToken
 * @param {string} talentSlug
 * @returns {boolean}
 */
export function hasOpponentWithTalentInMeleeRange(selfToken, talentSlug, { actorPredicate = null } = {}) {
  if (!selfToken) return false;

  for (const t of _iterPlaceables()) {
    if (!t) continue;
    if (!_isOpponent(selfToken, t)) continue;
    const actor = t.actor ?? null;
    const matchesTalent = talentSlug ? hasTalent(actor, talentSlug) : false;
    const matchesPredicate = typeof actorPredicate === "function" ? actorPredicate(actor, t) === true : false;
    if (!matchesTalent && !matchesPredicate) continue;
    const reach = getMeleeReachMeters(t.actor);
    if (isWithinMeleeRange(t, selfToken, reach)) return true;
  }

  return false;
}
