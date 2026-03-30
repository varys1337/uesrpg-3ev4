import { getItemEL, computePoolMax } from "../../enchant-level.js";
import { getEffectiveEnchantRank } from "../../penalties.js";
import { resolveSoulGemData } from "../../soul-gems.js";

export function prepareEnchantBuilderSession({
  actor,
  targetItem,
  soulGemItem,
  hasRequiredEntries = true,
  emptyMessage = "At least one entry is required.",
  maxEntries = null,
  actualEntries = 0,
  overflowMessage = "",
  minSoulEnergy = null,
} = {}) {
  const errors = [];
  if (!actor) errors.push("No actor provided.");
  if (!targetItem) errors.push("No target item provided.");
  if (!soulGemItem) errors.push("No soul gem provided.");
  if (!hasRequiredEntries) errors.push(emptyMessage);
  if (Number.isFinite(maxEntries) && actualEntries > maxEntries && overflowMessage) errors.push(overflowMessage);

  const gemData = resolveSoulGemData(soulGemItem);
  if (!gemData) errors.push("Soul gem item has invalid soul gem flags.");

  const itemEL = getItemEL(targetItem);
  const { poolMax, energyLost } = gemData ? computePoolMax(itemEL, gemData.soulEnergy) : { poolMax: 0, energyLost: 0 };
  if (gemData && Number.isFinite(minSoulEnergy) && gemData.soulEnergy < minSoulEnergy) {
    errors.push(`This enchantment requires at least ${minSoulEnergy} soul energy. The selected gem only has ${gemData.soulEnergy}.`);
  }

  const effectiveEnchantRank = gemData ? getEffectiveEnchantRank(actor, gemData) : 0;
  const gemAudit = gemData ? {
    gemName: soulGemItem?.name,
    gemUuid: gemData.uuid,
    soulType: gemData.soulType,
    soulSize: gemData.soulSize,
    soulEnergyInGem: gemData.soulEnergy,
    itemEL,
    poolMax,
    energyLost,
  } : {};

  return { errors, gemData, itemEL, poolMax, energyLost, effectiveEnchantRank, gemAudit };
}
