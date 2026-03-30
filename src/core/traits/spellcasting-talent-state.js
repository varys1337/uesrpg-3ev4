/**
 * @module traits/spellcasting-talent-state
 * @description Internal state helpers for spellcasting-talent priming.
 */

import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { _num } from "./_primitives.js";

export const SPELLCASTING_PRIMED_FLAG = "spellcasting.primed";

/**
 * Read the current primed talent state from actor flags.
 *
 * @param {Actor} actor
 * @returns {object|null}
 */
export function getSpellcastingTalentState(actor) {
  if (!actor) return null;
  const primed = actor.getFlag?.(FLAG_SCOPE, SPELLCASTING_PRIMED_FLAG) ?? null;
  if (!primed || typeof primed !== "object" || !primed.slug) return null;

  if (primed.expiresAtWorldTime != null) {
    const worldTime = game.time?.worldTime ?? 0;
    if (worldTime > primed.expiresAtWorldTime) return null;
  }

  return primed;
}

/**
 * Persist a primed spellcasting-talent state.
 *
 * @param {Actor} actor
 * @param {object} state
 * @returns {Promise<void>}
 */
export async function setSpellcastingPrimedState(actor, state) {
  if (!actor || !state?.slug) return;
  await requestUpdateDocument(actor, {
    [`flags.${FLAG_SCOPE}.${SPELLCASTING_PRIMED_FLAG}`]: {
      slug: String(state.slug),
      expiresAtWorldTime: state.expiresAtWorldTime ?? null,
      usesRemaining: state.usesRemaining ?? 1,
      options: state.options ?? {},
      primedAt: Date.now()
    }
  });
}

/**
 * Clear the primed spellcasting-talent state.
 *
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function clearSpellcastingPrimedState(actor) {
  if (!actor) return;
  try {
    await requestUpdateDocument(actor, {
      [`flags.${FLAG_SCOPE}.-=${SPELLCASTING_PRIMED_FLAG}`]: null
    });
  } catch (_e) {
    // Safe no-op when the flag is already absent.
  }
}

/**
 * Consume one primed use. Clears the state when it reaches zero.
 *
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function consumeSpellcastingPrimedState(actor) {
  const state = getSpellcastingTalentState(actor);
  if (!state) return;

  const remaining = _num(state.usesRemaining, 1) - 1;
  if (remaining <= 0) {
    await clearSpellcastingPrimedState(actor);
    return;
  }

  await setSpellcastingPrimedState(actor, { ...state, usesRemaining: remaining });
}
