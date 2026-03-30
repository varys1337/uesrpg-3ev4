import { hasTalent } from "../../traits/talents-api.js";
import { computeStrikeConstantPenalty } from "../penalties.js";
import { executeEnchantTest, executeSalvageEnergyRoll } from "../tests.js";
import { resolveSoulGemData } from "../soul-gems.js";
import { getEnchantingSettings } from "../settings.js";
import { prepareEnchantBuilderSession } from "./internal/session.js";

const MAX_EFFECTS_NO_MANIFOLD = 1;
const MAX_EFFECTS_MANIFOLD = 3;

export async function buildStrike(cfg) {
  const { actor, targetItem, soulGemItem, effects = [], skipRolls = false } = cfg;
  const hasManifold = hasTalent(actor, "manifoldenchanter");
  const maxEffects = hasManifold ? MAX_EFFECTS_MANIFOLD : MAX_EFFECTS_NO_MANIFOLD;
  const session = prepareEnchantBuilderSession({
    actor,
    targetItem,
    soulGemItem,
    hasRequiredEntries: effects.length > 0,
    emptyMessage: "At least one strike effect is required.",
    maxEntries: maxEffects,
    actualEntries: effects.length,
    overflowMessage: hasManifold
      ? `Manifold Enchanter allows up to 3 strike effects (${effects.length} provided).`
      : `Without Manifold Enchanter, only 1 strike effect is allowed. Acquire Manifold Enchanter to use up to 3.`,
  });

  const totalCost = effects.reduce((sum, effect) => sum + Number(effect.cost ?? 0), 0);
  const totalSL = effects.reduce((sum, effect) => sum + Number(effect.sl ?? 0), 0);
  if (totalCost > session.poolMax && !session.errors.length) {
    session.errors.push(`Total strike cost (${totalCost}) exceeds pool cap (${session.poolMax}). Reduce effects or use a higher-tier gem.`);
  }
  const penalty = computeStrikeConstantPenalty(totalSL, session.effectiveEnchantRank);
  if (session.errors.length) {
    return {
      valid: false,
      errors: session.errors,
      itemEL: session.itemEL,
      poolMax: session.poolMax,
      energyLost: session.energyLost,
      totalCost,
      totalSL,
      penalty,
      effectiveEnchantRank: session.effectiveEnchantRank,
      gemAudit: session.gemAudit,
      testResult: null,
      salvageResult: null,
      anySuccess: false,
      gemPreserved: false,
      useCharges: false,
      chargePoolMax: null,
    };
  }

  let testResult = null;
  let anySuccess = false;
  let gemPreserved = false;
  let salvageResult = null;
  const hasSalvage = hasTalent(actor, "salvageenergy");

  if (!skipRolls) {
    testResult = await executeEnchantTest(actor, penalty, { effectiveEnchantRank: session.effectiveEnchantRank });
    anySuccess = testResult.success;
    if (!anySuccess && hasSalvage) {
      salvageResult = await executeSalvageEnergyRoll(actor, testResult.tn);
      if (salvageResult.success) gemPreserved = true;
    }
  }

  const { enableChargedStrikeVariant } = getEnchantingSettings();
  const chargePoolMax = enableChargedStrikeVariant ? Math.floor(totalCost / 10) : null;
  return {
    valid: true,
    errors: [],
    itemEL: session.itemEL,
    poolMax: session.poolMax,
    energyLost: session.energyLost,
    totalCost,
    totalSL,
    penalty,
    effectiveEnchantRank: session.effectiveEnchantRank,
    gemAudit: session.gemAudit,
    testResult,
    salvageResult,
    anySuccess: skipRolls ? true : anySuccess,
    gemPreserved,
    useCharges: enableChargedStrikeVariant,
    chargePoolMax,
  };
}

export function buildStrikeFlagsPayload(result, actor, soulGemItem, targetItem, effects) {
  const gemData = resolveSoulGemData(soulGemItem);
  return {
    version: 2,
    enchantType: "strike",
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
    strike: {
      effects: effects.map((effect) => ({
        key: effect.key,
        sl: effect.sl,
        y: effect.y ?? undefined,
        type: effect.type ?? undefined,
        cost: effect.cost,
      })),
      useCharges: result.useCharges ?? false,
      pool: result.useCharges && result.chargePoolMax != null ? { value: result.chargePoolMax, max: result.chargePoolMax } : undefined,
    },
  };
}
