/**
 * src/core/wounds/engine/state.js
 *
 * State transition logic for wound engine.
 * Pure decision functions - no document mutations.
 */

import { isActorUndead } from "../../traits/trait-registry.js";
import { findFirstEffectByKind, getWoundsFlag, toNumber } from "./calc.js";

const FLAG_SCOPE = "uesrpg-3ev4";

/**
 * Check if wound penalty should be suppressed
 */
export function isWoundPenaltySuppressed(actor) {
  if (isActorUndead(actor)) return true;
  // Passive wound effect suppression immunity (e.g. Frenzy, Adrenaline Burst).
  try {
    const raw = actor?.system?.traits?.immunity?.passiveWounds;
    if (raw === true) return true;
    const n = Number(raw);
    if (Number.isFinite(n) && n !== 0) return true;
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "on") return true;
  } catch (_e) {
    // ignore
  }

  // ActiveEffect-backed explicit suppression marker.
  try {
    const scope = game?.system?.id ?? FLAG_SCOPE;
    const effects = Array.isArray(actor?.effects) ? actor.effects : Array.from(actor?.effects ?? []);
    const hasExplicit = effects.some((e) => {
      if (!e || e.disabled) return false;
      const flags = e?.flags?.[scope] ?? e?.flags?.[FLAG_SCOPE] ?? null;
      const wounds = flags?.wounds ?? null;
      return wounds?.suppressWoundPenalty === true;
    });
    if (hasExplicit) return true;
  } catch (_e) {
    // ignore
  }

  // Suppression if:
  //  - Forestall remainingRounds > 0
  //  - First Aid present
  const forestall = findFirstEffectByKind(actor, "forestall");
  if (forestall) {
    const r = Math.max(0, toNumber(forestall?.getFlag?.(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0, 0));
    if (r > 0) return true;
  }
  const firstAid = findFirstEffectByKind(actor, "firstAid");
  if (firstAid) return true;
  return false;
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
