/**
 * @module enchanting/builders/build-constant
 *
 * src/core/enchanting/builders/build-constant.js
 *
 * Builder for Constant Enchantments (passive effects).
 *
 * RAW constraints:
 *  - Effects must have the Upkeep attribute and a listed duration.
 *  - Cannot use Become Ethereal.
 *  - Cannot use Conjuration or Necromancy effects.
 *  - Without Manifold Enchanter: max 1 effect.
 *  - With Manifold Enchanter: up to 3 effects.
 *  - Minimum soul energy determined by Total Spell Levels threshold table.
 *  - If dispelled, returns after 1d4 rounds.
 *  - Wearer can toggle enabled/disabled.
 *  - Optional: Cursed Constant (if setting enabled) — cannot be disabled.
 *
 * Target: Foundry VTT v13.351
 */

import { hasTalent } from "../../traits/talents-api.js";
import { getEffectiveEnchantRank, computeStrikeConstantPenalty } from "../penalties.js";
import { computePoolMax } from "../enchant-level.js";
import { executeEnchantTest, executeSalvageEnergyRoll } from "../tests.js";
import { resolveSoulGemData } from "../soul-gems.js";

const MAX_EFFECTS_NO_MANIFOLD = 1;
const MAX_EFFECTS_MANIFOLD = 3;

/**
 * Total Spell Level minimum soul energy threshold table.
 * RAW: if totalSL >= threshold, the minimum gem soul energy required = minEnergy.
 * Sorted descending so the first match is the highest applicable threshold.
 */
const CONSTANT_SL_THRESHOLDS = [
  { totalSL: 7, minEnergy: 1500 },  // Grand / Black
  { totalSL: 5, minEnergy: 1000 },  // Greater
  { totalSL: 3, minEnergy: 500  },  // Common
  { totalSL: 2, minEnergy: 250  },  // Lesser
  { totalSL: 1, minEnergy: 100  },  // Petty
];

/**
 * Look up the minimum soul energy required for a given Total Spell Level.
 *
 * @param {number} totalSL
 * @returns {number}
 */
export function getConstantMinSoulEnergy(totalSL) {
  const tsl = Math.max(0, Number(totalSL ?? 0));
  for (const row of CONSTANT_SL_THRESHOLDS) {
    if (tsl >= row.totalSL) return row.minEnergy;
  }
  return 100; // Petty minimum
}

const BANNED_CONSTANT_EFFECTS = new Set(["becomeEthereal"]);
const BANNED_CONSTANT_SCHOOLS = new Set(["conjuration", "necromancy"]);

/**
 * @typedef {object} ConstantEffectEntry
 * @property {string} effectKey - spell-effects.json key
 * @property {number} sl - Spell level for this effect
 * @property {object} params - Additional params (e.g., { fortifyAttr: "strength" })
 * @property {number} cost - Soul energy cost
 * @property {string[]} attributes - From spell-effects.json
 * @property {string} school - From spell-effects.json
 * @property {boolean} allowConstant - From spell-effects.json
 */

/**
 * @typedef {object} BuildConstantConfig
 * @property {Actor} actor
 * @property {Item} targetItem
 * @property {Item} soulGemItem
 * @property {ConstantEffectEntry[]} effects
 * @property {boolean} [cursed] - Requires enchanting.enableCursedConstant
 * @property {boolean} [skipRolls]
 */

/**
 * Validate and (optionally) roll the enchant test for a constant enchantment.
 *
 * @param {BuildConstantConfig} cfg
 * @returns {Promise<object>}
 */
export async function buildConstant(cfg) {
  const { actor, targetItem, soulGemItem, effects = [], cursed = false, skipRolls = false } = cfg;
  const errors = [];

  if (!actor) errors.push("No actor provided.");
  if (!targetItem) errors.push("No target item provided.");
  if (!soulGemItem) errors.push("No soul gem provided.");
  if (!effects.length) errors.push("At least one effect is required.");

  // Cursed setting gate
  if (cursed) {
    const cursedEnabled = game.settings.get("uesrpg-3ev4", "enchanting.enableCursedConstant") ?? false;
    if (!cursedEnabled) errors.push("Cursed Constant Enchantments are not enabled (enchanting.enableCursedConstant = false).");
  }

  const hasManifold = hasTalent(actor, "manifoldenchanter");
  const maxEffects = hasManifold ? MAX_EFFECTS_MANIFOLD : MAX_EFFECTS_NO_MANIFOLD;
  if (effects.length > maxEffects) {
    errors.push(
      hasManifold
        ? `Manifold Enchanter allows up to 3 effects (${effects.length} provided).`
        : `Without Manifold Enchanter, only 1 effect is allowed. Acquire Manifold Enchanter to use up to 3.`
    );
  }

  // Per-effect validation (RAW restrictions)
  for (const effect of effects) {
    const key = String(effect.effectKey ?? "");
    const school = String(effect.school ?? "").toLowerCase();
    const hasUpkeep = Array.isArray(effect.attributes) && effect.attributes.includes("upkeep");
    const allowConstant = Boolean(effect.allowConstant);

    if (BANNED_CONSTANT_EFFECTS.has(key)) {
      errors.push(`"${effect.effectKey}" cannot be used in constant enchantments (RAW).`);
    }
    if (BANNED_CONSTANT_SCHOOLS.has(school)) {
      errors.push(`${school.charAt(0).toUpperCase() + school.slice(1)} effects cannot be used in constant enchantments (RAW).`);
    }
    if (!hasUpkeep) {
      errors.push(`Effect "${key || effect.effectKey}" does not have the Upkeep attribute. Only Upkeep effects are eligible for constant enchantments.`);
    }
    if (!allowConstant) {
      errors.push(`Effect "${key || effect.effectKey}" is not eligible for constant enchantments.`);
    }
  }

  const gemData = resolveSoulGemData(soulGemItem);
  if (!gemData) errors.push("Soul gem item has invalid soul gem flags.");

  const itemEL = Number(targetItem?.system?.enchantLevel ?? targetItem?.flags?.["uesrpg-3ev4"]?.itemEL ?? 10);
  const totalSL = effects.reduce((sum, e) => sum + Number(e.sl ?? 0), 0);
  const totalCost = effects.reduce((sum, e) => sum + Number(e.cost ?? 0), 0);

  const minSoulEnergy = getConstantMinSoulEnergy(totalSL);

  const { poolMax, energyLost } = gemData
    ? computePoolMax(itemEL, gemData.soulEnergy)
    : { poolMax: 0, energyLost: 0 };

  if (gemData && gemData.soulEnergy < minSoulEnergy) {
    errors.push(`Total SL ${totalSL} requires a minimum of ${minSoulEnergy} soul energy. The selected gem only has ${gemData.soulEnergy}.`);
  }

  const effectiveEnchantRank = gemData ? getEffectiveEnchantRank(actor, gemData) : 0;
  const penalty = computeStrikeConstantPenalty(totalSL, effectiveEnchantRank);

  const gemAudit = gemData
    ? {
        gemName: soulGemItem.name,
        gemUuid: gemData.uuid,
        soulType: gemData.soulType,
        soulSize: gemData.soulSize,
        soulEnergyInGem: gemData.soulEnergy,
        itemEL,
        poolMax,
        energyLost,
        minSoulEnergyRequired: minSoulEnergy,
      }
    : {};

  if (errors.length) {
    return { valid: false, errors, itemEL, poolMax, energyLost, totalSL, totalCost, minSoulEnergy, penalty, gemAudit, testResult: null, anySuccess: false, gemPreserved: false };
  }

  let testResult = null;
  let anySuccess = false;
  let gemPreserved = false;
  let salvageResult = null;

  const hasSalvage = hasTalent(actor, "salvageenergy");

  if (!skipRolls) {
    testResult = await executeEnchantTest(actor, penalty, { effectiveEnchantRank });
    anySuccess = testResult.success;

    if (!anySuccess && hasSalvage) {
      salvageResult = await executeSalvageEnergyRoll(actor, testResult.tn);
      if (salvageResult.success) gemPreserved = true;
    }
  }

  return {
    valid: true,
    errors: [],
    itemEL,
    poolMax,
    energyLost,
    totalSL,
    totalCost,
    minSoulEnergy,
    penalty,
    effectiveEnchantRank,
    gemAudit,
    testResult,
    salvageResult,
    anySuccess: skipRolls ? true : anySuccess,
    gemPreserved,
    cursed,
  };
}

/**
 * Build the constant enchantment flags payload.
 *
 * @param {object} result - From buildConstant()
 * @param {Actor} actor
 * @param {Item} soulGemItem
 * @param {Item} targetItem
 * @param {ConstantEffectEntry[]} effects
 * @returns {object}
 */
export function buildConstantFlagsPayload(result, actor, soulGemItem, targetItem, effects) {
  const gemData = resolveSoulGemData(soulGemItem);

  return {
    version: 2,
    enchantType: "constant",
    createdByActorUuid: actor?.uuid ?? null,
    createdAt: Date.now(),

    sourceSoul: gemData
      ? {
          gemUuid: gemData.uuid,
          soulType: gemData.soulType,
          soulEnergySpent: result.poolMax,
          gemMax: gemData.soulEnergy,
          usedEnergyCap: result.poolMax,
        }
      : null,

    itemEL: result.itemEL,

    constant: {
      effects: effects.map(e => ({
        effectKey: e.effectKey,
        sl: e.sl,
        params: e.params ?? {},
        cost: e.cost,
      })),
      enabled: true,
      suppressedUntilRound: null,
      cursed: result.cursed ?? false,
    },
  };
}
