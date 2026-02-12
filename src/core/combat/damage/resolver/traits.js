/**
 * src/core/combat/damage/resolver/traits.js
 *
 * Trait value aggregation utilities for damage resolution.
 */

import { getActorTraitValue } from "../../../traits/trait-registry.js";

/**
 * Sum all instances of a trait value across an actor's traits.
 * @param {Actor} actor
 * @param {string} key
 * @returns {number}
 */
export function sumTraitValue(actor, key) {
  return Math.max(0, Number(getActorTraitValue(actor, key, { mode: "sum" })) || 0);
}

/**
 * Get the maximum trait value for a given key.
 * @param {Actor} actor
 * @param {string} key
 * @returns {number}
 */
export function maxTraitValue(actor, key) {
  return Math.max(0, Number(getActorTraitValue(actor, key, { mode: "max" })) || 0);
}
