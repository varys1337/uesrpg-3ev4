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
 * Resolution order:
 *  1. magicSkill "Enchant" — getMagicSkillLevel returns 1-7 (0 if untrained).
 *  2. Regular skill "Enchant" — getNamedItemRank returns 0 (Novice) through 5 (Master).
 *     Novice rank (0) is treated as untrained for penalty purposes; untrained actors
 *     who only have the skill at Novice will have rank 0.
 *
 * @param {Actor} actor
 * @returns {number} Enchant rank on a 0–7 scale; 0 = untrained.
 */
export function getEnchantRank(actor) {
  if (!actor) return 0;

  // Try as a magicSkill first (getMagicSkillLevel gives 0-7 where 0 = untrained).
  const magicLevel = getMagicSkillLevel(actor, "enchant");
  if (magicLevel > 0) return magicLevel;

  // Fallback: regular skill (getNamedItemRank gives SKILL_RANK_TO_NUMBER: novice=0...master=5).
  // No shift applied; novice rank (0) is treated as equivalent to untrained for penalty purposes.
  const skillRank = getNamedItemRank(actor, "Enchant", { types: ["skill"] });
  return Math.max(0, skillRank);
}

/**
 * Resolve the actor's Necromancy magic skill rank.
 *
 * @param {Actor} actor
 * @returns {number} Necromancy rank on a 0–7 scale; 0 = untrained.
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
 * @returns {number} Negative penalty (e.g., -20), or 0 if rank >= spellLevel.
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
 * @returns {number} Negative penalty (e.g., -10), or 0 if rank >= totalSpellLevels.
 */
export function computeStrikeConstantPenalty(totalSpellLevels, effectiveEnchantRank) {
  const tsl = Math.max(0, Number(totalSpellLevels ?? 0));
  const rank = Math.max(0, Number(effectiveEnchantRank ?? 0));
  return -10 * Math.max(0, tsl - rank);
}

/**
 * Retrieve the actor's Enchant skill TN (for use in doTestRoll and preview display).
 *
 * Searches for a skill or magicSkill item named "Enchant" or "Enchanting" (case-insensitive).
 *
 * @param {Actor} actor
 * @returns {number} The TN value (system.value) of the Enchant skill, or 0 if not found.
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
