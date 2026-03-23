/**
 * src/core/actors/types.js
 *
 * Central actor type constants and predicates.
 * Single source of truth for actor type string checks used across the system.
 */

import { getHomebrewSetting } from "../homebrew/settings.js";

/** Canonical actor type string constants. */
export const ACTOR_TYPES = Object.freeze({
  PC: "Player Character",
  NPC: "NPC",
  GROUP: "Group",
  WARFARE_UNIT: "Warfare Unit",
});

/** Set of all known actor type strings. */
export const ACTOR_TYPE_SET = Object.freeze(new Set(Object.values(ACTOR_TYPES)));

/** @param {string} type @returns {boolean} */
export function isPCActorType(type) {
  return type === ACTOR_TYPES.PC;
}

/** @param {string} type @returns {boolean} */
export function isNPCActorType(type) {
  return type === ACTOR_TYPES.NPC;
}

/** @param {string} type @returns {boolean} */
export function isGroupActorType(type) {
  return type === ACTOR_TYPES.GROUP;
}

/** @param {string} type @returns {boolean} */
export function isWarfareUnitActorType(type) {
  return type === ACTOR_TYPES.WARFARE_UNIT;
}

/**
 * Returns true for actor types that represent individual humanoid characters
 * (Player Character and NPC). These types share characteristics, skills,
 * combat styles, HP, stamina, magicka, etc.
 * @param {string} type @returns {boolean}
 */
export function isHumanoidActorType(type) {
  return type === ACTOR_TYPES.PC || type === ACTOR_TYPES.NPC;
}

/**
 * Returns true when the Mass Combat homebrew subsystem is enabled.
 * @returns {boolean}
 */
export function isMassCombatEnabled() {
  return Boolean(getHomebrewSetting("homebrew.massCombat.enabled", false));
}
