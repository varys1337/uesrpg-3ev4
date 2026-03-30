import { hasTalent } from "../../traits/talents-api.js";
import { computeCastPenalty, getEnchantTN } from "../penalties.js";
import { executeEnchantTest, executeSalvageEnergyRoll } from "../tests.js";
import { resolveSoulGemData } from "../soul-gems.js";
import { prepareEnchantBuilderSession } from "./internal/session.js";

const MAX_SPELLS_NO_MANIFOLD = 1;
const MAX_SPELLS_MANIFOLD = 3;

export async function buildCast(cfg) {
  const { actor, targetItem, soulGemItem, spells = [], skipRolls = false } = cfg;
  const hasManifold = hasTalent(actor, "manifoldenchanter");
  const maxSpells = hasManifold ? MAX_SPELLS_MANIFOLD : MAX_SPELLS_NO_MANIFOLD;
  const session = prepareEnchantBuilderSession({
    actor,
    targetItem,
    soulGemItem,
    hasRequiredEntries: spells.length > 0,
    emptyMessage: "At least one spell is required.",
    maxEntries: maxSpells,
    actualEntries: spells.length,
    overflowMessage: hasManifold
      ? `Manifold Enchanter allows up to 3 stored spells (${spells.length} provided).`
      : `Without Manifold Enchanter, only 1 stored spell is allowed (${spells.length} provided). Acquire the Manifold Enchanter talent to store up to 3 spells.`,
  });

  if (session.errors.length) {
    return {
      valid: false,
      errors: session.errors,
      itemEL: session.itemEL,
      poolMax: session.poolMax,
      energyLost: session.energyLost,
      effectiveEnchantRank: session.effectiveEnchantRank,
      gemAudit: session.gemAudit,
      spellResults: [],
      anySuccess: false,
      gemPreserved: false,
    };
  }

  const spellResults = [];
  let anySuccess = false;
  let gemPreserved = skipRolls;
  const hasSalvage = hasTalent(actor, "salvageenergy");
  const hasProcedural = hasTalent(actor, "proceduralenchanting");

  for (const spell of spells) {
    const spellLevel = Math.max(1, Math.min(7, Number(spell.level ?? 1)));
    const penalty = computeCastPenalty(spellLevel, session.effectiveEnchantRank);
    let testResult = null;
    let salvageResult = null;
    let bindingStrength = 0;
    let proceduralChoice = null;

    if (!skipRolls) {
      testResult = await executeEnchantTest(actor, penalty, { effectiveEnchantRank: session.effectiveEnchantRank });
      anySuccess ||= testResult.success;
      if (testResult.success) {
        bindingStrength = testResult.bindingStrength;
        proceduralChoice = hasProcedural ? "dos" : "dos";
      } else if (hasSalvage && !gemPreserved) {
        salvageResult = await executeSalvageEnergyRoll(actor, testResult.tn);
        if (salvageResult.success) gemPreserved = true;
      }
    } else {
      const baseTN = getEnchantTN(actor);
      testResult = {
        tn: Math.max(1, baseTN + penalty),
        roll: null,
        success: null,
        isCritSuccess: false,
        isCritFailure: false,
        degrees: 0,
        bindingStrength: 0,
        hasProcedural,
        enchantRankAlternative: session.effectiveEnchantRank,
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
      effectiveEnchantRank: session.effectiveEnchantRank,
      bindingStrength,
      proceduralChoice,
      hasProcedural,
      testResult,
      salvageResult,
    });
  }

  return {
    valid: true,
    errors: [],
    itemEL: session.itemEL,
    poolMax: session.poolMax,
    energyLost: session.energyLost,
    effectiveEnchantRank: session.effectiveEnchantRank,
    gemAudit: session.gemAudit,
    spellResults,
    anySuccess: skipRolls ? true : anySuccess,
    gemPreserved,
  };
}

export function buildCastFlagsPayload(result, actor, soulGemItem, targetItem, opts = {}) {
  const gemData = resolveSoulGemData(soulGemItem);
  const { proceduralChoices = {} } = opts;
  const spells = result.spellResults.map((spellResult) => {
    const choice = proceduralChoices[spellResult.id] ?? spellResult.proceduralChoice ?? "dos";
    let bs = spellResult.bindingStrength;
    if (spellResult.hasProcedural && choice === "enchantrank") bs = spellResult.effectiveEnchantRank;
    return {
      id: spellResult.id,
      source: spellResult.source,
      label: spellResult.label,
      level: spellResult.level,
      cost: spellResult.cost,
      attributes: spellResult.attributes,
      spellUuid: spellResult.spellUuid ?? null,
      snapshot: spellResult.snapshot ?? null,
      spellDefinition: spellResult.spellDefinition ?? null,
      bindingStrength: bs,
      costMode: "soul",
      test: spellResult.testResult ? {
        tn: spellResult.testResult.tn,
        roll: spellResult.testResult.roll,
        degrees: spellResult.testResult.degrees,
        success: spellResult.testResult.success,
        isCritSuccess: spellResult.testResult.isCritSuccess,
        isCritFailure: spellResult.testResult.isCritFailure,
      } : null,
    };
  });

  return {
    version: 2,
    enchantType: "cast",
    createdByActorUuid: actor?.uuid ?? null,
    createdAt: Date.now(),
    sourceSoul: gemData ? {
      gemUuid: gemData.uuid,
      soulType: gemData.soulType,
      soulEnergySpent: result.poolMax,
      gemMax: gemData.soulEnergy,
      usedEnergyCap: result.poolMax,
    } : null,
    itemEL: result.itemEL,
    cast: {
      spells,
      pool: { value: result.poolMax, max: result.poolMax },
      activeUpkeepSpellId: null,
    },
  };
}
