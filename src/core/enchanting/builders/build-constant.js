import { hasTalent } from "../../traits/talents-api.js";
import { computeStrikeConstantPenalty } from "../penalties.js";
import { executeEnchantTest, executeSalvageEnergyRoll } from "../tests.js";
import { resolveSoulGemData } from "../soul-gems.js";
import { getEnchantingSettings } from "../settings.js";
import { prepareEnchantBuilderSession } from "./internal/session.js";

const MAX_EFFECTS_NO_MANIFOLD = 1;
const MAX_EFFECTS_MANIFOLD = 3;
const CONSTANT_SL_THRESHOLDS = [
  { totalSL: 7, minEnergy: 1500 },
  { totalSL: 5, minEnergy: 1000 },
  { totalSL: 3, minEnergy: 500 },
  { totalSL: 2, minEnergy: 250 },
  { totalSL: 1, minEnergy: 100 },
];
const BANNED_CONSTANT_EFFECTS = new Set(["becomeEthereal"]);
const BANNED_CONSTANT_SCHOOLS = new Set(["conjuration", "necromancy"]);

export function getConstantMinSoulEnergy(totalSL) {
  const tsl = Math.max(0, Number(totalSL ?? 0));
  for (const row of CONSTANT_SL_THRESHOLDS) {
    if (tsl >= row.totalSL) return row.minEnergy;
  }
  return 100;
}

export async function buildConstant(cfg) {
  const { actor, targetItem, soulGemItem, effects = [], cursed = false, skipRolls = false } = cfg;
  const errors = [];
  if (cursed && !getEnchantingSettings().enableCursedConstant) {
    errors.push("Cursed Constant Enchantments are not enabled (enchanting.enableCursedConstant = false).");
  }

  const hasManifold = hasTalent(actor, "manifoldenchanter");
  const maxEffects = hasManifold ? MAX_EFFECTS_MANIFOLD : MAX_EFFECTS_NO_MANIFOLD;
  for (const effect of effects) {
    const key = String(effect.effectKey ?? "");
    const school = String(effect.school ?? "").toLowerCase();
    const hasUpkeep = Array.isArray(effect.attributes) && effect.attributes.includes("upkeep");
    const allowConstant = Boolean(effect.allowConstant);
    if (BANNED_CONSTANT_EFFECTS.has(key)) errors.push(`"${effect.effectKey}" cannot be used in constant enchantments (RAW).`);
    if (BANNED_CONSTANT_SCHOOLS.has(school)) errors.push(`${school.charAt(0).toUpperCase() + school.slice(1)} effects cannot be used in constant enchantments (RAW).`);
    if (!hasUpkeep) errors.push(`Effect "${key || effect.effectKey}" does not have the Upkeep attribute. Only Upkeep effects are eligible for constant enchantments.`);
    if (!allowConstant) errors.push(`Effect "${key || effect.effectKey}" is not eligible for constant enchantments.`);
  }

  const totalSL = effects.reduce((sum, effect) => sum + Number(effect.sl ?? 0), 0);
  const totalCost = effects.reduce((sum, effect) => sum + Number(effect.cost ?? 0), 0);
  const minSoulEnergy = getConstantMinSoulEnergy(totalSL);
  const session = prepareEnchantBuilderSession({
    actor,
    targetItem,
    soulGemItem,
    hasRequiredEntries: effects.length > 0,
    emptyMessage: "At least one effect is required.",
    maxEntries: maxEffects,
    actualEntries: effects.length,
    overflowMessage: hasManifold
      ? `Manifold Enchanter allows up to 3 effects (${effects.length} provided).`
      : `Without Manifold Enchanter, only 1 effect is allowed. Acquire Manifold Enchanter to use up to 3.`,
    minSoulEnergy,
  });
  errors.push(...session.errors);
  const penalty = computeStrikeConstantPenalty(totalSL, session.effectiveEnchantRank);

  if (errors.length) {
    return {
      valid: false,
      errors,
      itemEL: session.itemEL,
      poolMax: session.poolMax,
      energyLost: session.energyLost,
      totalSL,
      totalCost,
      minSoulEnergy,
      penalty,
      effectiveEnchantRank: session.effectiveEnchantRank,
      gemAudit: session.gemData ? { ...session.gemAudit, minSoulEnergyRequired: minSoulEnergy } : {},
      testResult: null,
      salvageResult: null,
      anySuccess: false,
      gemPreserved: false,
      cursed,
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

  return {
    valid: true,
    errors: [],
    itemEL: session.itemEL,
    poolMax: session.poolMax,
    energyLost: session.energyLost,
    totalSL,
    totalCost,
    minSoulEnergy,
    penalty,
    effectiveEnchantRank: session.effectiveEnchantRank,
    gemAudit: session.gemData ? { ...session.gemAudit, minSoulEnergyRequired: minSoulEnergy } : {},
    testResult,
    salvageResult,
    anySuccess: skipRolls ? true : anySuccess,
    gemPreserved,
    cursed,
  };
}

export function buildConstantFlagsPayload(result, actor, soulGemItem, targetItem, effects) {
  const gemData = resolveSoulGemData(soulGemItem);
  return {
    version: 2,
    enchantType: "constant",
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
    constant: {
      effects: effects.map((effect) => ({
        effectKey: effect.effectKey,
        sl: effect.sl,
        params: effect.params ?? {},
        cost: effect.cost,
      })),
      enabled: true,
      suppressedUntilRound: null,
      cursed: result.cursed ?? false,
    },
  };
}
