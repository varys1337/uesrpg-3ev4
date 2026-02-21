/**
 * @module enchanting/penalties
 *
 * src/core/enchanting/penalties.js
 *
 * Enchant test penalty computation for the Enchanting Workshop.
 *
 * RAW penalty formulas:
 *  - Cast:            -10 * max(0, spellLevel - effectiveEnchantRank)
 *  - Strike/Constant: -10 * max(0, totalSpellLevels - effectiveEnchantRank)
 *
 * Black Soul Gem constraint:
 *  - effectiveEnchantRank = min(enchantRank, necromancyRank)
 *
 * Enchant rank is resolved from the actor's Enchant skill.
 * Necromancy rank is resolved from the actor's Necromancy magic skill.
 *
 * Target: Foundry VTT v13.351
 */

import { getNamedItemRank } from "../traits/talents-api.js";
import { getMagicSkillLevel } from "../magic/magicka-utils.js";

/**
 * Resolve the actor's effective Enchant rank (1-7 scale matching spell levels).
 *
 * Tries magicSkill first (rank 1-7), then regular skill (SKILL_RANK_TO_NUMBER 0-5).
 * Returns 0 if not found (untrained).
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function getEnchantRank(actor) {
  if (!actor) return 0;

  // Try as a magicSkill first (getMagicSkillLevel gives 0-7 where 0=untrained).
  const magicLevel = getMagicSkillLevel(actor, "enchant");
  if (magicLevel > 0) return magicLevel;

  // Fallback: regular skill (getNamedItemRank gives SKILL_RANK_TO_NUMBER: novice=0...master=5).
  // Shift by 1 so novice=1 matches the spell level scale.
  const skillRank = getNamedItemRank(actor, "Enchant", { types: ["skill"] });
  return Math.max(0, skillRank);
}

/**
 * Resolve the actor's Necromancy magic skill rank (0-7).
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function getNecromancyRank(actor) {
  if (!actor) return 0;
  return getMagicSkillLevel(actor, "necromancy");
}

/**
 * Compute the effective Enchant rank, capped by Necromancy when using a Black Soul Gem.
 *
 * @param {Actor} actor
 * @param {{ soulType: string }} gemData
 * @returns {number}
 */
export function getEffectiveEnchantRank(actor, gemData) {
  const enchantRank = getEnchantRank(actor);
  if (String(gemData?.soulType ?? "white").toLowerCase() === "black") {
    const necroRank = getNecromancyRank(actor);
    return Math.min(enchantRank, necroRank);
  }
  return enchantRank;
}

/**
 * Compute the cast enchantment penalty for a single spell.
 *
 * @param {number} spellLevel - 1-7
 * @param {number} effectiveEnchantRank
 * @returns {number} Negative penalty (e.g., -20), or 0.
 */
export function computeCastPenalty(spellLevel, effectiveEnchantRank) {
  const sl = Math.max(1, Number(spellLevel ?? 1));
  const rank = Math.max(0, Number(effectiveEnchantRank ?? 0));
  return -10 * Math.max(0, sl - rank);
}

/**
 * Compute the strike or constant enchantment penalty.
 *
 * @param {number} totalSpellLevels - Sum of all effect SLs
 * @param {number} effectiveEnchantRank
 * @returns {number} Negative penalty (e.g., -10), or 0.
 */
export function computeStrikeConstantPenalty(totalSpellLevels, effectiveEnchantRank) {
  const tsl = Math.max(0, Number(totalSpellLevels ?? 0));
  const rank = Math.max(0, Number(effectiveEnchantRank ?? 0));
  return -10 * Math.max(0, tsl - rank);
}

/**
 * Retrieve the actor's Enchant skill TN (for use in doTestRoll).
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function getEnchantTN(actor) {
  if (!actor?.items) return 0;

  // Look for a skill or magicSkill item named "Enchant" or "Enchanting"
  const names = new Set(["enchant", "enchanting"]);
  for (const item of actor.items) {
    if (item.type !== "skill" && item.type !== "magicSkill") continue;
    const n = String(item.name ?? "").toLowerCase().trim();
    if (names.has(n)) {
      return Math.max(0, Number(item.system?.value ?? 0));
    }
  }
  return 0;
}

/**
 * Check whether the actor is trained in Enchanting (rank > 0).
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isEnchantTrained(actor) {
  return getEnchantRank(actor) > 0;
}
