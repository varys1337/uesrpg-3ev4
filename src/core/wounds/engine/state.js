/**
 * src/core/wounds/engine/state.js
 *
 * State transition logic for wound engine.
 * Pure decision functions - no document mutations.
 */

import { isActorUndead } from "../../traits/trait-registry.js";
import { findEffectsByKind, findFirstEffectByKind, toNumber } from "./calc.js";
import { FLAG_SCOPE } from "../../constants.js";

export const WOUND_STATES = Object.freeze({
  NONE: "none",
  SHOCK_PENDING: "shockPending",
  ACTIVE: "active",
  SUPPRESSED: "suppressed",
  TREATED: "treated"
});

function _isSuppressedByImmunity(actor) {
  try {
    const raw = actor?.system?.traits?.immunity?.passiveWounds;
    if (raw === true) return true;
    const n = Number(raw);
    if (Number.isFinite(n) && n !== 0) return true;
    const s = String(raw ?? "").trim().toLowerCase();
    return s === "true" || s === "yes" || s === "on";
  } catch (_e) {
    return false;
  }
}

function _isSuppressedByMarkers(actor) {
  const forestall = findFirstEffectByKind(actor, "forestall");
  if (forestall) {
    const r = Math.max(0, toNumber(forestall?.getFlag?.(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0, 0));
    if (r > 0) return true;
  }
  const firstAid = findFirstEffectByKind(actor, "firstAid");
  if (firstAid) return true;
  return false;
}

function _readForestallInfo(actor) {
  const forestall = findFirstEffectByKind(actor, "forestall");
  if (!forestall) return { present: false, rounds: 0 };
  const rounds = Math.max(0, toNumber(forestall?.getFlag?.(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0, 0));
  return { present: true, rounds };
}

function _readFirstAidInfo(actor) {
  const firstAid = findFirstEffectByKind(actor, "firstAid");
  return { present: Boolean(firstAid) };
}

function _reasonLabel(reason) {
  if (reason === "firstAid") return "First Aid";
  if (reason === "forestall") return "Forestall";
  if (reason === "trait-immunity") return "Trait Immunity";
  if (reason === "undead") return "Undead";
  return "Unknown";
}

export function getWoundState(actor) {
  if (!actor) return WOUND_STATES.NONE;
  const wounds = findEffectsByKind(actor, "wound");
  if (!wounds.length) return WOUND_STATES.NONE;

  const anyShockPending = wounds.some((ef) => {
    const w = ef?.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
    return w.shockResolved !== true;
  });
  if (anyShockPending) return WOUND_STATES.SHOCK_PENDING;

  const allTreated = wounds.every((ef) => {
    const w = ef?.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
    return w.treated === true;
  });

  if (_isSuppressedByImmunity(actor) || _isSuppressedByMarkers(actor)) {
    return WOUND_STATES.SUPPRESSED;
  }

  return allTreated ? WOUND_STATES.TREATED : WOUND_STATES.ACTIVE;
}

export function isDerivedWounded(actor) {
  return getWoundState(actor) !== WOUND_STATES.NONE;
}

/**
 * Check if wound penalty should be suppressed
 */
export function isWoundPenaltySuppressed(actor) {
  if (isActorUndead(actor)) return true;
  return _isSuppressedByImmunity(actor) || _isSuppressedByMarkers(actor);
}

export function getWoundSuppressionInfo(actor) {
  const reasons = [];
  const forestall = _readForestallInfo(actor);
  const firstAid = _readFirstAidInfo(actor);

  if (isActorUndead(actor)) reasons.push("undead");
  if (_isSuppressedByImmunity(actor)) reasons.push("trait-immunity");
  if (firstAid.present) reasons.push("firstAid");
  if (forestall.present && forestall.rounds > 0) reasons.push("forestall");

  const unique = Array.from(new Set(reasons));
  const primaryReason = unique[0] ?? null;
  return {
    suppressed: unique.length > 0,
    reasons: unique,
    primaryReason,
    primaryLabel: primaryReason ? _reasonLabel(primaryReason) : "",
    forestallRounds: forestall.rounds,
    hasFirstAid: firstAid.present,
  };
}

export function getBloodLossStatus(actor) {
  const bloodLoss = findFirstEffectByKind(actor, "bloodLoss");
  const remainingRounds = Math.max(0, toNumber(bloodLoss?.getFlag?.(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0, 0));
  const suppression = getWoundSuppressionInfo(actor);

  return {
    hasEffect: Boolean(bloodLoss),
    remainingRounds,
    paused: Boolean(bloodLoss) && suppression.suppressed,
    pauseReason: suppression.primaryReason,
    pauseLabel: suppression.primaryLabel,
    suppression,
  };
}

/**
 * Resolve actor-like input to Actor instance
 */
export async function resolveActorLike(actorLike) {
  // Accept: Actor, TokenDocument/Token, UUID string, Actor ID, Actor name.
  // If omitted, use the first controlled token's actor, else the user's assigned character.
  try {
    if (!actorLike) {
      return canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null;
    }

    // Actor instance
    if (actorLike?.documentName === "Actor") return actorLike;

    // Token or TokenDocument
    if (actorLike?.actor?.documentName === "Actor") return actorLike.actor;

    // UUID / id / name
    if (typeof actorLike === "string") {
      const s = actorLike.trim();
      if (!s) return null;

      // Try UUID first (e.g. Actor.xxxxx)
      if (s.includes(".")) {
        const doc = await fromUuid(s).catch(() => null);
        if (doc?.documentName === "Actor") return doc;
      }

      // Try ID then name
      return game.actors?.get?.(s) ?? game.actors?.getName?.(s) ?? null;
    }

    return null;
  } catch (_err) {
    return null;
  }
}
