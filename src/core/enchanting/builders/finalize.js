import { consumeSoulGem } from "../soul-gems.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../../constants.js";
import { buildEnchantedItemUpdate } from "./internal/finalize-operations.js";
import { postEnchantmentResultCard } from "./internal/finalize-chat.js";

const _NS = SYSTEM_ID;

export async function finalizeEnchantment(cfg) {
  const { actor, targetItem, soulGemItem, flagsPayload, buildResult, gemPreserved = false, enchantType } = cfg;
  const updateData = buildEnchantedItemUpdate(targetItem, flagsPayload, _NS);

  try {
    await requestUpdateDocument(targetItem, updateData);
  } catch (err) {
    console.error("UESRPG | [Enchanting] Failed to write enchantment flags", err);
    ui.notifications?.error("Enchanting: Failed to save enchantment data. See console for details.");
    return;
  }

  if (!gemPreserved && soulGemItem) {
    await consumeSoulGem(actor, soulGemItem);
  }

  await postEnchantmentResultCard(actor, targetItem, flagsPayload, buildResult, gemPreserved, enchantType);
}

export async function rechargeEnchantment(cfg) {
  const { actor, enchantedItem, soulGemItem } = cfg;

  const enchanting = enchantedItem?.flags?.[_NS]?.enchanting;
  if (!enchanting || enchanting.enchantType !== "cast") {
    ui.notifications?.warn("Selected item does not have a cast enchantment.");
    return;
  }

  const { isEnchantTrained } = await import("../penalties.js");
  if (!isEnchantTrained(actor)) {
    ui.notifications?.warn("Recharging an enchantment requires at least Novice rank in the Enchant skill.");
    return;
  }

  const gemFlags = soulGemItem?.flags?.[_NS];
  if (!gemFlags?.isSoulGem || !Number(gemFlags.soulEnergy ?? 0)) {
    ui.notifications?.warn("The selected item is not a filled soul gem.");
    return;
  }

  const gemEnergy = Number(gemFlags.soulEnergy);
  const pool = enchanting.cast?.pool ?? { value: 0, max: 0 };
  const deficit = Math.max(0, pool.max - pool.value);
  const transferred = Math.min(deficit, gemEnergy);

  try {
    await requestUpdateDocument(enchantedItem, {
      [`flags.${_NS}.enchanting.cast.pool.value`]: pool.value + transferred,
      ...(enchanting.cast?.pool?.max !== undefined ? { "system.charge.value": pool.value + transferred } : {}),
    });
    await consumeSoulGem(actor, soulGemItem);
    await ChatMessage.create({
      content: `<div class="uesrpg">
        <h3>Enchantment Recharged</h3>
        <p><strong>Item:</strong> ${enchantedItem.name}</p>
        <p><strong>Gem:</strong> ${soulGemItem.name}</p>
        <p><strong>Energy transferred:</strong> ${transferred} (excess lost: ${gemEnergy - transferred})</p>
        <p><strong>Pool:</strong> ${pool.value + transferred} / ${pool.max}</p>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
  } catch (err) {
    console.error("UESRPG | [Enchanting] Recharge failed", err);
    ui.notifications?.error("Recharge failed. See console.");
  }
}

export async function toggleConstantEnchantment(cfg) {
  const { enchantedItem } = cfg;
  const enchanting = enchantedItem?.flags?.[_NS]?.enchanting;
  if (!enchanting || enchanting.enchantType !== "constant") {
    ui.notifications?.warn("Selected item does not have a constant enchantment.");
    return;
  }

  const constant = enchanting.constant;
  if (constant.cursed && constant.enabled) {
    ui.notifications?.warn("This enchantment is cursed and cannot be disabled.");
    return;
  }

  const newEnabled = !constant.enabled;
  try {
    await requestUpdateDocument(enchantedItem, {
      [`flags.${_NS}.enchanting.constant.enabled`]: newEnabled,
      [`flags.${_NS}.enchanting.constant.suppressedUntilRound`]: null,
    });

    ui.notifications?.info(`Constant enchantment on "${enchantedItem.name}" ${newEnabled ? "enabled" : "disabled"}.`);
  } catch (err) {
    console.error("UESRPG | [Enchanting] Toggle constant failed", err);
    ui.notifications?.error("Toggle failed. See console.");
  }
}
