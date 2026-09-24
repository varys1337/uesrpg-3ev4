import { consumeSoulGem, isSoulGemResourceUsable, resolveSoulGemData } from "../soul-gems.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../../constants.js";
import { buildEnchantedItemUpdate } from "./internal/finalize-operations.js";
import { postEnchantmentResultCard } from "./internal/finalize-chat.js";
import { t } from "../../../utils/i18n.js";

const _NS = SYSTEM_ID;

export async function finalizeEnchantment(cfg) {
  const {
    actor,
    targetItem,
    soulGemItem,
    flagsPayload,
    buildResult,
    gemPreserved = false,
    enchantType,
    postResult = true,
  } = cfg;
  const updateData = buildEnchantedItemUpdate(targetItem, flagsPayload, _NS);
  const updated = await requestUpdateDocument(targetItem, updateData);
  if (!updated) {
    return {
      ok: false,
      phase: "item-update",
      reason: t("UESRPG.Apps.EnchantingWorkshop.Errors.ItemUpdateRejected", "The enchanted Item update was rejected."),
      itemUpdated: false,
      gemConsumed: false,
    };
  }

  const freshTarget = targetItem?.uuid ? await fromUuid(targetItem.uuid).catch(() => null) : null;
  const persisted = freshTarget?.flags?.[_NS]?.enchanting;
  if (!persisted || persisted.enchantType !== flagsPayload?.enchantType || persisted.version !== flagsPayload?.version) {
    return {
      ok: false,
      phase: "item-verify",
      reason: t("UESRPG.Apps.EnchantingWorkshop.Errors.ItemUpdateUnverified", "The enchantment could not be verified after saving."),
      itemUpdated: false,
      gemConsumed: false,
    };
  }

  let gemConsumed = false;
  if (!gemPreserved && soulGemItem) {
    gemConsumed = await consumeSoulGem(actor, soulGemItem);
    if (!gemConsumed) {
      return {
        ok: false,
        phase: "gem-consume",
        reason: t("UESRPG.Apps.EnchantingWorkshop.Errors.GemConsumptionRejected", "The enchantment was saved, but the soul gem could not be consumed."),
        itemUpdated: true,
        gemConsumed: false,
      };
    }
  }

  if (postResult) await postEnchantmentResultCard(actor, freshTarget ?? targetItem, flagsPayload, buildResult, gemPreserved, enchantType);
  return {
    ok: true,
    phase: "complete",
    reason: "",
    itemUpdated: true,
    gemConsumed,
    targetItem: freshTarget ?? targetItem,
  };
}

export async function rechargeEnchantment(cfg) {
  const { actor, enchantedItem, soulGemItem } = cfg;

  const enchanting = enchantedItem?.flags?.[_NS]?.enchanting;
  if (!enchanting || enchanting.enchantType !== "cast") {
    ui.notifications?.warn("Selected item does not have a cast enchantment.");
    return { ok: false, phase: "validation", reason: "Selected item does not have a cast enchantment.", itemUpdated: false, gemConsumed: false };
  }

  const { isEnchantTrained } = await import("../penalties.js");
  if (!isEnchantTrained(actor)) {
    ui.notifications?.warn("Recharging an enchantment requires at least Novice rank in the Enchant skill.");
    return { ok: false, phase: "validation", reason: "Recharging requires a trained Enchant skill.", itemUpdated: false, gemConsumed: false };
  }

  const gemData = resolveSoulGemData(soulGemItem);
  if (!gemData) {
    ui.notifications?.warn(t(
      "UESRPG.Notifications.Enchanting.InvalidSoulGem",
      "The selected item is not a recognized soul gem.",
    ));
    return { ok: false, phase: "validation", reason: "The selected item is not a recognized soul gem.", itemUpdated: false, gemConsumed: false };
  }
  if (!gemData.isFilled) {
    ui.notifications?.warn(t(
      "UESRPG.Notifications.Enchanting.EmptySoulGem",
      "The selected soul gem is empty and cannot power enchanting.",
    ));
    return { ok: false, phase: "validation", reason: "The selected soul gem is empty.", itemUpdated: false, gemConsumed: false };
  }
  if (!isSoulGemResourceUsable(soulGemItem, gemData)) {
    const reason = t("UESRPG.Notifications.Enchanting.ReusableSoulVesselStack", "Reusable soul-energy vessels must have a quantity of one. Split this stack before enchanting.");
    ui.notifications?.warn(reason);
    return { ok: false, phase: "validation", reason, itemUpdated: false, gemConsumed: false };
  }

  const gemEnergy = gemData.soulEnergy;
  const pool = enchanting.cast?.pool ?? { value: 0, max: 0 };
  const deficit = Math.max(0, pool.max - pool.value);
  const transferred = Math.min(deficit, gemEnergy);

  const nextPool = pool.value + transferred;
  const updated = await requestUpdateDocument(enchantedItem, {
    [`flags.${_NS}.enchanting.cast.pool.value`]: nextPool,
    ...(enchanting.cast?.pool?.max !== undefined ? { "system.charge.value": nextPool } : {}),
  });
  if (!updated) {
    return { ok: false, phase: "item-update", reason: "The enchanted Item update was rejected.", itemUpdated: false, gemConsumed: false };
  }
  const gemConsumed = await consumeSoulGem(actor, soulGemItem);
  if (!gemConsumed) {
    const rolledBack = await requestUpdateDocument(enchantedItem, {
      [`flags.${_NS}.enchanting.cast.pool.value`]: pool.value,
      ...(enchanting.cast?.pool?.max !== undefined ? { "system.charge.value": pool.value } : {}),
    });
    return {
      ok: false,
      phase: "gem-consume",
      reason: rolledBack
        ? "The soul gem could not be consumed; the recharge was rolled back."
        : "The item was recharged, but the soul gem could not be consumed or the recharge rolled back. A GM must reconcile the documents.",
      itemUpdated: !rolledBack,
      gemConsumed: false,
    };
  }
  try {
    await ChatMessage.create({
      content: `<div class="uesrpg">
        <h3>Enchantment Recharged</h3>
        <p><strong>Item:</strong> ${enchantedItem.name}</p>
        <p><strong>Gem:</strong> ${soulGemItem.name}</p>
        <p><strong>Energy transferred:</strong> ${transferred} (excess lost: ${gemEnergy - transferred})</p>
        <p><strong>Pool:</strong> ${nextPool} / ${pool.max}</p>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
  } catch (err) {
    console.error("UESRPG | [Enchanting] Recharge failed", err);
    return { ok: false, phase: "chat", reason: "Recharge completed, but the chat result could not be posted.", itemUpdated: true, gemConsumed: true };
  }
  return { ok: true, phase: "complete", reason: "", itemUpdated: true, gemConsumed: true, transferred, pool: { value: nextPool, max: pool.max } };
}

export async function toggleConstantEnchantment(cfg) {
  const { enchantedItem } = cfg;
  const enchanting = enchantedItem?.flags?.[_NS]?.enchanting;
  if (!enchanting || enchanting.enchantType !== "constant") {
    ui.notifications?.warn("Selected item does not have a constant enchantment.");
    return { ok: false, phase: "validation", reason: "Selected item does not have a constant enchantment.", itemUpdated: false, gemConsumed: false };
  }

  const constant = enchanting.constant;
  if (constant.cursed && constant.enabled) {
    ui.notifications?.warn("This enchantment is cursed and cannot be disabled.");
    return { ok: false, phase: "validation", reason: "This cursed enchantment cannot be disabled.", itemUpdated: false, gemConsumed: false };
  }

  const newEnabled = !constant.enabled;
  const updated = await requestUpdateDocument(enchantedItem, {
    [`flags.${_NS}.enchanting.constant.enabled`]: newEnabled,
    [`flags.${_NS}.enchanting.constant.suppressedUntilRound`]: null,
  });
  if (!updated) {
    return { ok: false, phase: "item-update", reason: "The constant enchantment update was rejected.", itemUpdated: false, gemConsumed: false };
  }
  ui.notifications?.info(`Constant enchantment on "${enchantedItem.name}" ${newEnabled ? "enabled" : "disabled"}.`);
  return { ok: true, phase: "complete", reason: "", itemUpdated: true, gemConsumed: false, enabled: newEnabled };
}
