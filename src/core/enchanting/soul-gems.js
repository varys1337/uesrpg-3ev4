/**
 * @module enchanting/soul-gems
 *
 * src/core/enchanting/soul-gems.js
 *
 * Soul Gem helpers for the Enchanting Workshop.
 *
 * Soul Gems are identified by flags["uesrpg-3ev4"].isSoulGem === true on an
 * Item(type="item"). This module finds, validates, and consumes them.
 *
 * RAW constraints:
 *  - Filled gems have soulEnergy > 0.
 *  - Filled gems cannot be filled further (soulEnergy >= maxSoulEnergy).
 *  - Black Soul Gems (soulType="black") always hold 1500 energy.
 *  - When using a Black Soul Gem, the effective Enchant rank is capped by the
 *    actor's Necromancy rank (handled in penalties.js).
 *
 * Target: Foundry VTT v13.351
 */

const _NS = "uesrpg-3ev4";

/** Canonical soul gem tier table (matches soul-trap-service.js). */
export const SOUL_GEM_TIERS = Object.freeze({
  petty:   { label: "Petty",   maxEnergy: 100,  soulType: "white" },
  lesser:  { label: "Lesser",  maxEnergy: 250,  soulType: "white" },
  common:  { label: "Common",  maxEnergy: 500,  soulType: "white" },
  greater: { label: "Greater", maxEnergy: 1000, soulType: "white" },
  grand:   { label: "Grand",   maxEnergy: 1500, soulType: "white" },
  black:   { label: "Black",   maxEnergy: 1500, soulType: "black" },
});

/**
 * Return all filled soul gems in an actor's inventory.
 *
 * A "filled" gem is an item with:
 *   - flags["uesrpg-3ev4"].isSoulGem === true
 *   - flags["uesrpg-3ev4"].soulEnergy > 0
 *
 * @param {Actor} actor
 * @param {{ allowedSoulTypes?: "white"|"black"|"either" }} [opts]
 * @returns {Item[]} Sorted by soulEnergy descending (largest first).
 */
export function getFilledSoulGems(actor, { allowedSoulTypes = "either" } = {}) {
  if (!actor?.items) return [];

  const gems = [];
  for (const item of actor.items) {
    if (item.type !== "item") continue;
    const flags = item.flags?.[_NS];
    if (!flags?.isSoulGem) continue;
    const energy = Number(flags.soulEnergy ?? 0);
    if (energy <= 0) continue;

    const gemSoulType = String(flags.soulType ?? "white").toLowerCase();

    if (allowedSoulTypes !== "either") {
      if (allowedSoulTypes !== gemSoulType) continue;
    }

    gems.push(item);
  }

  // Sort largest energy first so callers can prefer the most appropriate gem.
  gems.sort((a, b) => {
    const eA = Number(a.flags?.[_NS]?.soulEnergy ?? 0);
    const eB = Number(b.flags?.[_NS]?.soulEnergy ?? 0);
    return eB - eA;
  });

  return gems;
}

/**
 * Resolve a soul gem Item to its key flags.
 *
 * @param {Item} gemItem
 * @returns {{ soulEnergy: number, maxSoulEnergy: number, soulType: string, soulSize: string, uuid: string } | null}
 */
export function resolveSoulGemData(gemItem) {
  if (!gemItem) return null;
  const flags = gemItem.flags?.[_NS];
  if (!flags?.isSoulGem) return null;
  const soulEnergy = Number(flags.soulEnergy ?? 0);
  const maxSoulEnergy = Number(flags.maxSoulEnergy ?? flags.soulEnergy ?? soulEnergy);
  const soulType = String(flags.soulType ?? "white").toLowerCase();
  const soulSize = String(flags.soulSize ?? "unknown");
  return {
    soulEnergy,
    maxSoulEnergy,
    soulType,
    soulSize,
    uuid: gemItem.uuid,
  };
}

/**
 * Consume (delete) a soul gem item from the actor's inventory.
 *
 * Permission-safe: if the current user cannot delete the item directly,
 * falls back to the authority proxy (GM route).
 *
 * @param {Actor} actor
 * @param {Item} gemItem
 * @returns {Promise<boolean>} true if deletion was attempted without throwing
 */
export async function consumeSoulGem(actor, gemItem) {
  if (!actor || !gemItem) return false;

  try {
    // Use the authority proxy for permission-safe deletion.
    const { requestDeleteEmbeddedDocuments } = await import("../../utils/authority-proxy.js");
    await requestDeleteEmbeddedDocuments(actor, "Item", [gemItem.id]);
    return true;
  } catch (err) {
    console.error("UESRPG | [Enchanting] consumeSoulGem failed", err);
    return false;
  }
}

/**
 * Build an audit record for chat card display about the soul gem used.
 *
 * @param {Item} gemItem
 * @param {number} energyUsed
 * @param {number} itemEL
 * @returns {object}
 */
export function buildSoulGemAudit(gemItem, energyUsed, itemEL) {
  const data = resolveSoulGemData(gemItem);
  if (!data) return { error: "Invalid soul gem" };

  const cap = Math.min(itemEL, data.soulEnergy);
  const energyLost = Math.max(0, data.soulEnergy - cap);

  return {
    gemName: gemItem.name,
    gemUuid: data.uuid,
    soulType: data.soulType,
    soulSize: data.soulSize,
    soulEnergyInGem: data.soulEnergy,
    itemEL,
    cap,
    energyUsed,
    energyLost,
  };
}
