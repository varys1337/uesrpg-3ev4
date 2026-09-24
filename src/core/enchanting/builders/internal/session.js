import { getItemEL, computePoolMax } from "../../enchant-level.js";
import { getEffectiveEnchantRank } from "../../penalties.js";
import { isSoulGemResourceUsable, resolveSoulGemData } from "../../soul-gems.js";
import { t } from "../../../../utils/i18n.js";

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
  if (!gemData) {
    errors.push(t(
      "UESRPG.Notifications.Enchanting.InvalidSoulGem",
      "The selected item is not a recognized soul gem.",
    ));
  }
  else if (!gemData.isFilled) {
    errors.push(t(
      "UESRPG.Notifications.Enchanting.EmptySoulGem",
      "The selected soul gem is empty and cannot power enchanting.",
    ));
  }
  else if (!isSoulGemResourceUsable(soulGemItem, gemData)) {
    errors.push(t(
      "UESRPG.Notifications.Enchanting.ReusableSoulVesselStack",
      "Reusable soul-energy vessels must have a quantity of one. Split this stack before enchanting.",
    ));
  }

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
