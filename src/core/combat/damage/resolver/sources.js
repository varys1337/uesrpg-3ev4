/**
 * src/core/combat/damage/resolver/sources.js
 *
 * Source type detection utilities for damage resolution.
 */

import { itemHasToken } from "../tokens.js";

/**
 * Check if an item is a natural weapon source (hand-to-hand).
 * @param {Item|null} item
 * @returns {boolean}
 */
export function isNaturalWeaponSource(item) {
  if (!item) return false;
  return itemHasToken(item, "handToHand");
}

/**
 * Check if an item is a silver source.
 * @param {Item|null} item
 * @returns {boolean}
 */
export function isSilverSource(item) {
  if (!item) return false;
  return itemHasToken(item, "silver") || itemHasToken(item, "silvered");
}

/**
 * Check if an item is a sunlight source.
 * @param {Item|null} item
 * @returns {boolean}
 */
export function isSunlightSource(item) {
  if (!item) return false;
  return itemHasToken(item, "sunlight");
}

/**
 * Get the system ID.
 * @returns {string}
 */
export function getSystemId() {
  return String(game?.system?.id ?? "uesrpg-3ev4");
}
