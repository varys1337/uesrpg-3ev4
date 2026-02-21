/**
 * @module enchanting/tests
 *
 * src/core/enchanting/tests.js
 *
 * Enchant test execution for the Enchanting Workshop.
 *
 * Wraps doTestRoll() with enchanting-specific semantics:
 *  - TN = actor's Enchant skill value + penalty
 *  - Result includes binding strength (DoS on success, or Enchant rank via Procedural Enchanting)
 *  - Salvage Energy sub-roll on failure
 *
 * Target: Foundry VTT v13.351
 */

import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { getEnchantTN } from "./penalties.js";
import { hasTalent } from "../traits/talents-api.js";

/**
 * Execute a single Enchant test.
 *
 * @param {Actor} actor
 * @param {number} penalty - negative TN modifier (from computeCastPenalty etc.)
 * @param {{ effectiveEnchantRank: number }} opts
 * @returns {Promise<EnchantTestResult>}
 *
 * @typedef {object} EnchantTestResult
 * @property {number} tn - Final TN used
 * @property {number} roll - d100 roll total
 * @property {boolean} success
 * @property {boolean} isCritSuccess
 * @property {boolean} isCritFailure
 * @property {number} degrees - DoS or DoF
 * @property {number} bindingStrength - DoS on success (or chosen rank via Procedural Enchanting)
 * @property {boolean} hasProcedural - whether actor has Procedural Enchanting talent
 * @property {number} enchantRankAlternative - Enchant rank (for Procedural Enchanting choice)
 */
export async function executeEnchantTest(actor, penalty, { effectiveEnchantRank = 0 } = {}) {
  const baseTN = getEnchantTN(actor);
  const finalTN = Math.max(1, baseTN + Number(penalty ?? 0));

  const result = await doTestRoll(actor, {
    target: finalTN,
    allowLucky: false,  // Enchanting is a crafting test — no lucky/unlucky numbers apply
    allowUnlucky: false,
  });

  const degrees = result.degree ?? 1;
  const isSuccess = result.isSuccess;
  const isCritSuccess = result.isCriticalSuccess ?? false;
  const isCritFailure = result.isCriticalFailure ?? false;

  // Binding Strength = DoS on success.
  // Critical success: max possible DoS + 1 (RAW: exceptional result).
  let bindingStrength = 0;
  if (isSuccess) {
    bindingStrength = isCritSuccess ? (degrees + 1) : degrees;
  }

  const hasProcedural = hasTalent(actor, "proceduralenchanting");

  return {
    tn: finalTN,
    roll: result.rollTotal,
    success: isSuccess,
    isCritSuccess,
    isCritFailure,
    degrees,
    bindingStrength,
    hasProcedural,
    enchantRankAlternative: effectiveEnchantRank,
  };
}

/**
 * Compute the max possible DoS for a given TN (for display/preview purposes).
 * At TN > 10, rolling a 10 (or 01) gives the best DoS = floor(TN / 10) + floor(TN/10)...
 * For simplicity: max DoS is roughly floor(TN / 10).
 *
 * @param {number} tn
 * @returns {number}
 */
export function estimateMaxDoS(tn) {
  return Math.max(1, Math.floor(Math.max(1, tn) / 10));
}

/**
 * Execute the Salvage Energy sub-roll (Salvage Energy talent).
 *
 * RAW: On a failed Enchant test, the actor may make a follow-up test to preserve
 * the soul gem. If successful, the gem is not consumed.
 *
 * The sub-roll is a straight Enchant test (same TN, no additional penalty).
 *
 * @param {Actor} actor
 * @param {number} baseTN - The same TN used for the original (failed) test
 * @returns {Promise<{ success: boolean, roll: number, degrees: number }>}
 */
export async function executeSalvageEnergyRoll(actor, baseTN) {
  const result = await doTestRoll(actor, {
    target: Math.max(1, baseTN),
    allowLucky: false,
    allowUnlucky: false,
  });

  return {
    success: result.isSuccess,
    roll: result.rollTotal,
    degrees: result.degree ?? 1,
  };
}
