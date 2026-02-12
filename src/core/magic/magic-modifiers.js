/**
 * @module magic/magic-modifiers
 *
 * src/core/magic/magic-modifiers.js
 *
 * Package 4 — Magic Rules Parity and Talent Hooks
 *
 * Provides deterministic, data-driven modifier resolution for magic casting,
 * cost, and damage bonuses based on Talents/Traits.
 *
 * IMPORTANT:
 * - Talents and Traits are represented as embedded Items (type "talent" or "trait").
 * - This module must not mutate actor or item data.
 */

import { _num, _str } from "./_primitives.js";

function _hasItemNamed(actor, type, name) {
  const target = _str(name).trim().toLowerCase();
  if (!actor?.items || !target) return false;
  return actor.items.some(i => _str(i?.type).toLowerCase() === _str(type).toLowerCase() && _str(i?.name).trim().toLowerCase() === target);
}

/**
 * Check whether an actor owns an embedded Talent by name (case-insensitive).
 *
 * @param {Actor} actor - The actor to inspect
 * @param {string} name - Talent name to look for
 * @returns {boolean} `true` if a matching talent item exists
 */
export function actorHasTalent(actor, name) {
  return _hasItemNamed(actor, "talent", name);
}

/**
 * Check whether an actor owns an embedded Trait by name (case-insensitive).
 *
 * @param {Actor} actor - The actor to inspect
 * @param {string} name - Trait name to look for
 * @returns {boolean} `true` if a matching trait item exists
 */
export function actorHasTrait(actor, name) {
  return _hasItemNamed(actor, "trait", name);
}

/**
 * Compute an actor's Willpower Bonus (WB = WP total ÷ 10, rounded down).
 *
 * @param {Actor} actor - The actor whose WP to read
 * @returns {number} The integer willpower bonus
 */
export function getActorWillpowerBonus(actor) {
  return Math.floor(_num(actor?.system?.characteristics?.wp?.total, 0) / 10);
}

/**
 * Whether the spell is of the "conventional" casting type.
 *
 * @param {Item} spell - The spell item to check
 * @returns {boolean}
 */
export function isSpellConventional(spell) {
  return _str(spell?.system?.spellType).toLowerCase() === "conventional";
}

/**
 * Whether the spell is of the "unconventional" casting type.
 *
 * @param {Item} spell - The spell item to check
 * @returns {boolean}
 */
export function isSpellUnconventional(spell) {
  return _str(spell?.system?.spellType).toLowerCase() === "unconventional";
}

/**
 * Whether the given damage type is one of the three elemental types
 * (fire, frost, shock).
 *
 * @param {string} damageType - Damage type string to check
 * @returns {boolean}
 */
export function isElementalDamageType(damageType) {
  const dt = _str(damageType).toLowerCase();
  return dt === "fire" || dt === "frost" || dt === "shock";
}

/**
 * Compute the effective WP bonus used for Spell Restraint benefit.
 *
 * RAW (Chapter 6 + Chapter 4):
 * - Spell Restraint reduces cost by WP Bonus (WB), minimum 1.
 * - Creative (Apprentice, Willpower): +1 WB for restraint when casting unconventional spells.
 * - Methodical (Apprentice, Willpower): +1 WB for restraint when casting conventional spells.
 * - Magicka Cycling (Expert, Willpower): +2 WB for restraint purposes.
 * - Stunted Magicka (Trait): halve benefits (round down) from Spell Restraint.
 * - Critical success, non-damaging spells: double Magicka cost reduction from Spell Restraint.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} options
 * @param {boolean} options.isCritical
 * @param {boolean} options.isDamaging
 * @returns {{reduction:number, baseWB:number, adjustedWB:number, breakdown:string[]}}
 */
export function computeSpellRestraintReduction(actor, spell, options = {}) {
  const breakdown = [];
  const baseWB = getActorWillpowerBonus(actor);
  let wb = baseWB;

  // Talent: Magicka Cycling (+2 WB for restraint).
  if (actorHasTalent(actor, "Magicka Cycling")) {
    wb += 2;
    breakdown.push("Magicka Cycling: +2 WB (restraint)");
  }

  // Talent: Creative (+1 WB for unconventional spells)
  if (actorHasTalent(actor, "Creative") && isSpellUnconventional(spell)) {
    wb += 1;
    breakdown.push("Creative: +1 WB (unconventional restraint)");
  }

  // Talent: Methodical (+1 WB for conventional spells)
  if (actorHasTalent(actor, "Methodical") && isSpellConventional(spell)) {
    wb += 1;
    breakdown.push("Methodical: +1 WB (conventional restraint)");
  }

  // Critical success, non-damaging spells: double restraint reduction.
  const isCritical = options.isCritical === true;
  const isDamaging = options.isDamaging === true;
  let reduction = Math.max(0, wb);

  if (isCritical && !isDamaging) {
    reduction *= 2;
    breakdown.push("Critical Success (non-damaging): double restraint reduction");
  }

  // Trait: Stunted Magicka halves restraint benefit (round down).
  if (actorHasTrait(actor, "Stunted Magicka")) {
    reduction = Math.floor(reduction / 2);
    breakdown.push("Stunted Magicka: halve restraint benefit (round down)");
  }

  return {
    reduction,
    baseWB,
    adjustedWB: wb,
    breakdown
  };
}

/**
 * Determine whether the caster can gain overload effects while restraining.
 * RAW: Overload effects apply when NOT restraining.
 * Talent (Chapter 4): Overcharge — can overload a spell with the overload attribute even if they restrain.
 */
export function canOverloadWhileRestrained(actor) {
  return actorHasTalent(actor, "Overcharge");
}

/**
 * Elemental damage bonus talents (Chapter 4):
 * - Pyromancer: +1 to fire spells
 * - Cryomancer: +1 to frost spells
 * - Electromancer: +1 to shock spells
 */
export function computeElementalDamageBonus(actor, damageType) {
  const dt = _str(damageType).toLowerCase();
  if (dt === "fire" && actorHasTalent(actor, "Pyromancer")) return { bonus: 1, label: "Pyromancer: +1" };
  if (dt === "frost" && actorHasTalent(actor, "Cryomancer")) return { bonus: 1, label: "Cryomancer: +1" };
  if (dt === "shock" && actorHasTalent(actor, "Electromancer")) return { bonus: 1, label: "Electromancer: +1" };
  return { bonus: 0, label: "" };
}

/**
 * Master of Magicka (Chapter 4): can double the cost paid (after restraint) to roll damage twice and keep the highest.
 */
export function canUseMasterOfMagicka(actor) {
  return actorHasTalent(actor, "Master of Magicka");
}
