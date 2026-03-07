/**
 * @module enchanting/builders/finalize
 *
 * src/core/enchanting/builders/finalize.js
 *
 * Finalizes an enchanting attempt:
 *  - Writes enchantment flags to the target item.
 *  - Optionally mirrors charge pool into item.system.charge.{value,max}.
 *  - Adds the "magic" quality to weapon/armor items.
 *  - Consumes the soul gem (unless Salvage Energy preserved it).
 *  - Posts a result chat card.
 *
 * Target: Foundry VTT v13.351
 */

import { consumeSoulGem } from "../soul-gems.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../../constants.js";

const _NS = SYSTEM_ID;

/**
 * Apply the completed enchantment to the item and post a chat card.
 *
 * @param {object} cfg
 * @param {Actor} cfg.actor
 * @param {Item} cfg.targetItem
 * @param {Item} cfg.soulGemItem
 * @param {object} cfg.flagsPayload - The enchanting flags payload (from a build*FlagsPayload function)
 * @param {object} cfg.buildResult - The raw build result (for audit data)
 * @param {boolean} cfg.gemPreserved - Whether Salvage Energy preserved the gem
 * @param {string} [cfg.enchantType] - "cast" | "strike" | "constant"
 * @returns {Promise<void>}
 */
export async function finalizeEnchantment(cfg) {
  const { actor, targetItem, soulGemItem, flagsPayload, buildResult, gemPreserved = false, enchantType } = cfg;

  // ── 1. Write enchantment flags to target item ────────────────────────────────
  const updateData = {
    [`flags.${_NS}.enchanting`]: flagsPayload,
  };

  // Mirror pool into system.charge if the item has that schema field (optional)
  const castPool = flagsPayload?.cast?.pool;
  const strikePool = flagsPayload?.strike?.pool;
  const pool = castPool ?? strikePool;
  if (pool) {
    // Only mirror if system.charge schema exists — safe to attempt, Foundry ignores unknown fields
    updateData["system.charge.value"] = pool.value;
    updateData["system.charge.max"] = pool.max;
  }

  // Add "magic" quality to weapons and armor (RAW)
  if (["weapon", "armor"].includes(targetItem?.type)) {
    const existingQualities = targetItem.system?.qualitiesStructured ?? [];
    const hasMagic = existingQualities.some(q => q.key === "magic");
    if (!hasMagic) {
      updateData["system.qualitiesStructured"] = [
        ...existingQualities,
        { key: "magic", value: null }
      ];
    }
  }

  try {
    await requestUpdateDocument(targetItem, updateData);
  } catch (err) {
    console.error("UESRPG | [Enchanting] Failed to write enchantment flags", err);
    ui.notifications?.error("Enchanting: Failed to save enchantment data. See console for details.");
    return;
  }

  // ── 2. Consume soul gem (unless preserved by Salvage Energy) ─────────────────
  if (!gemPreserved && soulGemItem) {
    await consumeSoulGem(actor, soulGemItem);
  }

  // ── 3. Post chat card ────────────────────────────────────────────────────────
  await _postEnchantmentCard(actor, targetItem, flagsPayload, buildResult, gemPreserved, enchantType);
}

/**
 * Post an enchantment result chat card.
 *
 * @param {Actor} actor
 * @param {Item} targetItem
 * @param {object} flagsPayload
 * @param {object} buildResult
 * @param {boolean} gemPreserved
 * @param {string} enchantType
 */
async function _postEnchantmentCard(actor, targetItem, flagsPayload, buildResult, gemPreserved, enchantType) {
  try {
    const audit = buildResult?.gemAudit ?? {};
    const typeLabel = { cast: "Cast", strike: "Strike", constant: "Constant" }[enchantType] ?? enchantType;

    // Build human-readable spell/effect summary
    let effectSummary = "";
    if (enchantType === "cast") {
      const spells = buildResult?.spellResults ?? [];
      effectSummary = spells.map(s => {
        const outcome = s.testResult?.success
          ? `Success (${s.testResult?.degrees} DoS, Binding Str. ${s.bindingStrength})`
          : `Failed (${s.testResult?.degrees} DoF)`;
        const procNote = s.hasProcedural && s.testResult?.success
          ? ` [Procedural: may choose rank ${s.effectiveEnchantRank}]`
          : "";
        return `${s.label} (SL ${s.level}) - TN ${s.testResult?.tn}, Roll ${s.testResult?.roll}: ${outcome}${procNote}`;
      }).join("<br>");
    } else if (enchantType === "strike") {
      const effects = flagsPayload?.strike?.effects ?? [];
      const testR = buildResult?.testResult;
      const outcome = testR?.success
        ? `Success (${testR.degrees} DoS, BS ${testR.bindingStrength ?? "-"})`
        : `Failed (${testR?.degrees ?? "?"} DoF)`;
      effectSummary = effects.map(e => `${e.key} SL ${e.sl}`).join(", ") +
        `<br>TN ${testR?.tn}, Roll ${testR?.roll}: ${outcome}`;
    } else if (enchantType === "constant") {
      const effects = flagsPayload?.constant?.effects ?? [];
      const testR = buildResult?.testResult;
      const outcome = testR?.success
        ? `Success (${testR.degrees} DoS)`
        : `Failed (${testR?.degrees ?? "?"} DoF)`;
      effectSummary = effects.map(e => `${e.effectKey} SL ${e.sl}`).join(", ") +
        `<br>TN ${testR?.tn}, Roll ${testR?.roll}: ${outcome}`;
    }

    const poolInfo = (() => {
      const pool = flagsPayload?.cast?.pool ?? flagsPayload?.strike?.pool ?? null;
      if (!pool) return "";
      return `<p><strong>Pool:</strong> ${pool.value} / ${pool.max} Soul Energy</p>`;
    })();

    const salvageNote = gemPreserved
      ? `<p><em>Salvage Energy: soul gem preserved!</em></p>`
      : "";

    await ChatMessage.create({
      content: `<div class="uesrpg">
        <h3>Enchanting Workshop - ${typeLabel} Enchantment</h3>
        <p><strong>Crafter:</strong> ${actor?.name ?? "Unknown"}</p>
        <p><strong>Item:</strong> ${targetItem?.name ?? "Unknown"}</p>
        <hr>
        <p><strong>Soul Gem:</strong> ${audit.gemName ?? "Unknown"} (${audit.soulType ?? "?"} - ${audit.soulSize ?? "?"} - ${audit.soulEnergyInGem ?? 0} energy)</p>
        <p><strong>Item EL:</strong> ${audit.itemEL ?? "?"} | <strong>Pool Cap:</strong> ${audit.poolMax ?? "?"} | <strong>Energy Lost:</strong> ${audit.energyLost ?? 0}</p>
        <hr>
        <p>${effectSummary}</p>
        ${poolInfo}
        ${salvageNote}
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
  } catch (err) {
    console.warn("UESRPG | [Enchanting] Failed to post chat card", err);
  }
}

/**
 * Apply a recharge to a cast-enchanted item.
 *
 * RAW: Trained Enchant required; no test; 1-minute ritual.
 * Transfers soul gem energy into pool up to max; destroys gem; excess lost.
 *
 * @param {object} cfg
 * @param {Actor} cfg.actor
 * @param {Item} cfg.enchantedItem
 * @param {Item} cfg.soulGemItem
 * @returns {Promise<void>}
 */
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

  const updateData = {
    [`flags.${_NS}.enchanting.cast.pool.value`]: pool.value + transferred,
  };
  if (enchanting.cast?.pool?.max !== undefined) {
    updateData["system.charge.value"] = pool.value + transferred;
  }

  try {
    await requestUpdateDocument(enchantedItem, updateData);
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

/**
 * Toggle a constant enchantment on/off.
 *
 * Cursed enchantments cannot be disabled.
 *
 * @param {object} cfg
 * @param {Actor} cfg.actor
 * @param {Item} cfg.enchantedItem
 * @returns {Promise<void>}
 */
export async function toggleConstantEnchantment(cfg) {
  const { actor, enchantedItem } = cfg;

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

    ui.notifications?.info(
      `Constant enchantment on "${enchantedItem.name}" ${newEnabled ? "enabled" : "disabled"}.`
    );
  } catch (err) {
    console.error("UESRPG | [Enchanting] Toggle constant failed", err);
    ui.notifications?.error("Toggle failed. See console.");
  }
}
