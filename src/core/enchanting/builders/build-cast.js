/**
 * @module enchanting/builders/build-cast
 *
 * src/core/enchanting/builders/build-cast.js
 *
 * Builder for Cast Enchantments (stored spells).
 *
 * RAW:
 *  - Stored spell may be conventional (existing spell item) or unconventional
 *    (built from spell effects/forms — blueprint).
 *  - Without Manifold Enchanter: max 1 stored spell.
 *  - With Manifold Enchanter: up to 3 stored spells.
 *  - Pool max = min(itemEL, gemSoulEnergy).
 *  - Each spell requires a separate Enchant test.
 *  - Binding Strength = DoS on success (or Enchant rank via Procedural Enchanting).
 *  - On failure with Salvage Energy: follow-up test to preserve gem.
 *
 * Target: Foundry VTT v13.351
 */

import { hasTalent } from "../../traits/talents-api.js";
import { getEffectiveEnchantRank, computeCastPenalty } from "../penalties.js";
import { computePoolMax } from "../enchant-level.js";
import { executeEnchantTest, executeSalvageEnergyRoll } from "../tests.js";
import { resolveSoulGemData } from "../soul-gems.js";

const MAX_SPELLS_NO_MANIFOLD = 1;
const MAX_SPELLS_MANIFOLD = 3;

/**
 * @typedef {object} CastSpellEntry
 * @property {string} id - Client-generated UUID for this spell slot
 * @property {"conventional"|"unconventional"} source
 * @property {string} label
 * @property {number} level - 1-7
 * @property {number} cost - Soul energy cost
 * @property {string[]} attributes
 * @property {string} [spellUuid] - For conventional
 * @property {object} [snapshot] - Snapshot of conventional spell data
 * @property {object} [spellDefinition] - For unconventional (blueprint)
 */

/**
 * @typedef {object} BuildCastConfig
 * @property {Actor} actor
 * @property {Item} targetItem
 * @property {Item} soulGemItem
 * @property {CastSpellEntry[]} spells
 * @property {boolean} [skipRolls] - For preview/validation mode
 */

/**
 * @typedef {object} BuildCastResult
 * @property {boolean} valid
 * @property {string[]} errors
 * @property {number} itemEL
 * @property {number} poolMax
 * @property {number} energyLost
 * @property {object} gemAudit
 * @property {object[]} spellResults
 * @property {boolean} anySuccess
 * @property {boolean} gemPreserved - true if Salvage Energy preserved the gem
 */

/**
 * Validate and (optionally) roll enchant tests for a cast enchantment.
 *
 * @param {BuildCastConfig} cfg
 * @returns {Promise<BuildCastResult>}
 */
export async function buildCast(cfg) {
  const { actor, targetItem, soulGemItem, spells = [], skipRolls = false } = cfg;
  const errors = [];

  // ── Validate inputs ──────────────────────────────────────────────────────────
  if (!actor) errors.push("No actor provided.");
  if (!targetItem) errors.push("No target item provided.");
  if (!soulGemItem) errors.push("No soul gem provided.");
  if (!spells.length) errors.push("At least one spell is required.");

  // Manifold Enchanter gating
  const hasManifold = hasTalent(actor, "manifoldenchanter");
  const maxSpells = hasManifold ? MAX_SPELLS_MANIFOLD : MAX_SPELLS_NO_MANIFOLD;
  if (spells.length > maxSpells) {
    errors.push(
      hasManifold
        ? `Manifold Enchanter allows up to 3 stored spells (${spells.length} provided).`
        : `Without Manifold Enchanter, only 1 stored spell is allowed (${spells.length} provided). Acquire the Manifold Enchanter talent to store up to 3 spells.`
    );
  }

  // Resolve gem data
  const gemData = resolveSoulGemData(soulGemItem);
  if (!gemData) errors.push("Soul gem item has invalid soul gem flags.");

  // EL and pool computation
  const itemEL = Number(targetItem?.system?.enchantLevel ?? targetItem?.flags?.["uesrpg-3ev4"]?.itemEL ?? 10);
  const { poolMax, energyLost } = gemData
    ? computePoolMax(itemEL, gemData.soulEnergy)
    : { poolMax: 0, energyLost: 0 };

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

  // Effective rank (accounts for Black Soul Gem Necromancy cap)
  const effectiveEnchantRank = gemData
    ? getEffectiveEnchantRank(actor, gemData)
    : 0;

  if (errors.length) {
    return { valid: false, errors, itemEL, poolMax, energyLost, gemAudit, spellResults: [], anySuccess: false, gemPreserved: false };
  }

  // ── Per-spell tests ──────────────────────────────────────────────────────────
  const spellResults = [];
  let anySuccess = false;
  let gemPreserved = !skipRolls ? false : true; // if no rolls, gem is consumed regardless

  const hasSalvage = hasTalent(actor, "salvageenergy");
  const hasProcedural = hasTalent(actor, "proceduralenchanting");

  for (const spell of spells) {
    const spellLevel = Math.max(1, Math.min(7, Number(spell.level ?? 1)));
    const penalty = computeCastPenalty(spellLevel, effectiveEnchantRank);

    let testResult = null;
    let salvageResult = null;
    let bindingStrength = 0;
    let proceduralChoice = null; // "dos" | "enchantrank" — chosen after success

    if (!skipRolls) {
      testResult = await executeEnchantTest(actor, penalty, { effectiveEnchantRank });
      anySuccess = anySuccess || testResult.success;

      if (testResult.success) {
        bindingStrength = testResult.bindingStrength;
        // Procedural Enchanting: actor may choose DoS or enchantRank
        // (the UI will prompt this; we store both options and the flag)
        proceduralChoice = hasProcedural
          ? "dos" // default; UI can let them pick "enchantrank"
          : "dos";
      } else if (hasSalvage && !gemPreserved) {
        // One salvage attempt per enchanting session (per RAW intent)
        salvageResult = await executeSalvageEnergyRoll(actor, testResult.tn);
        if (salvageResult.success) {
          gemPreserved = true;
        }
      }
    } else {
      // Preview mode: just compute the TN for display
      const baseTN = Number(actor?.items
        ?.find(i => ["skill", "magicSkill"].includes(i.type) &&
          ["enchant", "enchanting"].includes(String(i.name ?? "").toLowerCase().trim()))
        ?.system?.value ?? 0);
      testResult = {
        tn: Math.max(1, baseTN + penalty),
        roll: null,
        success: null,
        isCritSuccess: false,
        isCritFailure: false,
        degrees: 0,
        bindingStrength: 0,
        hasProcedural,
        enchantRankAlternative: effectiveEnchantRank,
      };
    }

    spellResults.push({
      id: spell.id,
      label: spell.label,
      source: spell.source,
      level: spellLevel,
      cost: Number(spell.cost ?? 0),
      attributes: spell.attributes ?? [],
      spellUuid: spell.spellUuid ?? null,
      snapshot: spell.snapshot ?? null,
      spellDefinition: spell.spellDefinition ?? null,
      penalty,
      effectiveEnchantRank,
      bindingStrength,
      proceduralChoice,
      hasProcedural,
      testResult,
      salvageResult,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    itemEL,
    poolMax,
    energyLost,
    gemAudit,
    spellResults,
    anySuccess: skipRolls ? true : anySuccess,
    gemPreserved,
  };
}

/**
 * Build the cast enchantment flags payload from a completed buildCast result.
 *
 * @param {BuildCastResult} result
 * @param {Actor} actor
 * @param {Item} soulGemItem
 * @param {Item} targetItem
 * @param {{ proceduralChoices?: Record<string, "dos"|"enchantrank"> }} [opts]
 * @returns {object} flags["uesrpg-3ev4"].enchanting payload
 */
export function buildCastFlagsPayload(result, actor, soulGemItem, targetItem, opts = {}) {
  const gemData = resolveSoulGemData(soulGemItem);
  const { proceduralChoices = {} } = opts;

  const spells = result.spellResults.map(sr => {
    const choice = proceduralChoices[sr.id] ?? sr.proceduralChoice ?? "dos";
    let bs = sr.bindingStrength;
    if (sr.hasProcedural && choice === "enchantrank") {
      bs = sr.effectiveEnchantRank;
    }

    return {
      id: sr.id,
      source: sr.source,
      label: sr.label,
      level: sr.level,
      cost: sr.cost,
      attributes: sr.attributes,
      spellUuid: sr.spellUuid ?? null,
      snapshot: sr.snapshot ?? null,
      spellDefinition: sr.spellDefinition ?? null,
      bindingStrength: bs,
      costMode: "soul",
      test: sr.testResult
        ? {
            tn: sr.testResult.tn,
            roll: sr.testResult.roll,
            degrees: sr.testResult.degrees,
            success: sr.testResult.success,
            isCritSuccess: sr.testResult.isCritSuccess,
            isCritFailure: sr.testResult.isCritFailure,
          }
        : null,
    };
  });

  return {
    version: 2,
    enchantType: "cast",
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

    cast: {
      spells,
      pool: { value: result.poolMax, max: result.poolMax },
      activeUpkeepSpellId: null,
    },
  };
}
