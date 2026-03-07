/**
 * @module enchanting/builders/build-strike
 *
 * src/core/enchanting/builders/build-strike.js
 *
 * Builder for Strike Enchantments (on-hit effects).
 *
 * RAW:
 *  - Strike effects and costs are defined by the Strike Enchantments catalog (table-driven).
 *  - Default: no pool and no recharge.
 *  - With Charged Strike Variant setting: pool.max = floor(totalCost / 10).
 *  - Without Manifold Enchanter: max 1 effect.
 *  - With Manifold Enchanter: up to 3 effects.
 *  - One Enchant test per strike session (not per effect).
 *
 * Target: Foundry VTT v13.351
 */

import { hasTalent } from "../../traits/talents-api.js";
import { getEffectiveEnchantRank, computeStrikeConstantPenalty } from "../penalties.js";
import { computePoolMax, getItemEL } from "../enchant-level.js";
import { executeEnchantTest, executeSalvageEnergyRoll } from "../tests.js";
import { resolveSoulGemData } from "../soul-gems.js";
import { getEnchantingSettings } from "../settings.js";

const MAX_EFFECTS_NO_MANIFOLD = 1;
const MAX_EFFECTS_MANIFOLD = 3;

/**
 * @typedef {object} StrikeEffectEntry
 * @property {string} key - Strike catalog key
 * @property {number} sl - Spell level parameter
 * @property {number} [y] - Optional Y parameter (drain amount)
 * @property {string} [type] - Optional type parameter (e.g., "weapon"|"armor" for disintegrate)
 * @property {number} cost - Soul energy cost for this effect
 */

/**
 * @typedef {object} BuildStrikeConfig
 * @property {Actor} actor
 * @property {Item} targetItem - Weapon or ammo
 * @property {Item} soulGemItem
 * @property {StrikeEffectEntry[]} effects
 * @property {boolean} [skipRolls]
 */

/**
 * @typedef {object} BuildStrikeResult
 * @property {boolean} valid
 * @property {string[]} errors - Empty when valid === true.
 * @property {number} itemEL
 * @property {number} poolMax
 * @property {number} energyLost
 * @property {number} totalCost
 * @property {number} totalSL
 * @property {number} penalty
 * @property {number} effectiveEnchantRank
 * @property {object} gemAudit
 * @property {object|null} testResult
 * @property {object|null} salvageResult
 * @property {boolean} anySuccess
 * @property {boolean} gemPreserved
 * @property {boolean} useCharges
 * @property {number|null} chargePoolMax
 */

/**
 * Validate and (optionally) roll the enchant test for a strike enchantment.
 *
 * @param {BuildStrikeConfig} cfg
 * @returns {Promise<BuildStrikeResult>}
 */
export async function buildStrike(cfg) {
  const { actor, targetItem, soulGemItem, effects = [], skipRolls = false } = cfg;
  const errors = [];

  if (!actor) errors.push("No actor provided.");
  if (!targetItem) errors.push("No target item provided.");
  if (!soulGemItem) errors.push("No soul gem provided.");
  if (!effects.length) errors.push("At least one strike effect is required.");

  const hasManifold = hasTalent(actor, "manifoldenchanter");
  const maxEffects = hasManifold ? MAX_EFFECTS_MANIFOLD : MAX_EFFECTS_NO_MANIFOLD;
  if (effects.length > maxEffects) {
    errors.push(
      hasManifold
        ? `Manifold Enchanter allows up to 3 strike effects (${effects.length} provided).`
        : `Without Manifold Enchanter, only 1 strike effect is allowed. Acquire Manifold Enchanter to use up to 3.`
    );
  }

  const gemData = resolveSoulGemData(soulGemItem);
  if (!gemData) errors.push("Soul gem item has invalid soul gem flags.");

  const itemEL = getItemEL(targetItem);
  const totalCost = effects.reduce((sum, e) => sum + Number(e.cost ?? 0), 0);
  const totalSL = effects.reduce((sum, e) => sum + Number(e.sl ?? 0), 0);

  const { poolMax, energyLost } = gemData
    ? computePoolMax(itemEL, gemData.soulEnergy)
    : { poolMax: 0, energyLost: 0 };

  if (totalCost > poolMax && !errors.length) {
    errors.push(`Total strike cost (${totalCost}) exceeds pool cap (${poolMax}). Reduce effects or use a higher-tier gem.`);
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
      }
    : {};

  if (errors.length) {
    return {
      valid: false, errors,
      itemEL, poolMax, energyLost, totalCost, totalSL, penalty, effectiveEnchantRank,
      gemAudit, testResult: null, salvageResult: null,
      anySuccess: false, gemPreserved: false, useCharges: false, chargePoolMax: null,
    };
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

  // Charged strike variant: pool.max = floor(totalCost / 10).
  const { enableChargedStrikeVariant } = getEnchantingSettings();
  const chargePoolMax = enableChargedStrikeVariant ? Math.floor(totalCost / 10) : null;

  return {
    valid: true,
    errors: [],
    itemEL,
    poolMax,
    energyLost,
    totalCost,
    totalSL,
    penalty,
    effectiveEnchantRank,
    gemAudit,
    testResult,
    salvageResult,
    anySuccess: skipRolls ? true : anySuccess,
    gemPreserved,
    useCharges: enableChargedStrikeVariant,
    chargePoolMax,
  };
}

/**
 * Build the strike enchantment flags payload.
 *
 * @param {BuildStrikeResult} result - From buildStrike()
 * @param {Actor} actor
 * @param {Item} soulGemItem
 * @param {Item} targetItem
 * @param {StrikeEffectEntry[]} effects
 * @returns {object}
 */
export function buildStrikeFlagsPayload(result, actor, soulGemItem, targetItem, effects) {
  const gemData = resolveSoulGemData(soulGemItem);

  return {
    version: 2,
    enchantType: "strike",
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

    strike: {
      effects: effects.map(e => ({
        key: e.key,
        sl: e.sl,
        y: e.y ?? undefined,
        type: e.type ?? undefined,
        cost: e.cost,
      })),
      useCharges: result.useCharges ?? false,
      pool: result.useCharges && result.chargePoolMax != null
        ? { value: result.chargePoolMax, max: result.chargePoolMax }
        : undefined,
    },
  };
}
