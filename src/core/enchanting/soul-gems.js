/**
 * @module enchanting/soul-gems
 *
 * src/core/enchanting/soul-gems.js
 *
 * Soul Gem helpers for the Enchanting Workshop.
 *
 * Soul Gems are identified primarily by flags["uesrpg-3ev4"].isSoulGem.
 * Legacy actor-owned copies of the canonical compendium gems are recognized
 * by their deterministic tier + filled/empty naming pattern.
 *
 * RAW constraints:
 *  - Filled gems have soulEnergy > 0.
 *  - Filled gems cannot be filled further (soulEnergy >= maxSoulEnergy).
 *  - Black Soul Gems (soulType="black") always hold 1500 energy.
 *  - When using a Black Soul Gem, the effective Enchant rank is capped by the
 *    actor's Necromancy rank (handled in penalties.js).
 *
 * Target: Foundry VTT v14.363+
 */

import { requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../constants.js";

const _NS = SYSTEM_ID;

/** Canonical soul gem tier table (matches soul-trap-service.js). */
export const SOUL_GEM_TIERS = Object.freeze({
  petty:   { label: "Petty",   maxEnergy: 100,  soulType: "white" },
  lesser:  { label: "Lesser",  maxEnergy: 250,  soulType: "white" },
  common:  { label: "Common",  maxEnergy: 500,  soulType: "white" },
  greater: { label: "Greater", maxEnergy: 1000, soulType: "white" },
  grand:   { label: "Grand",   maxEnergy: 1500, soulType: "white" },
  black:   { label: "Black",   maxEnergy: 1500, soulType: "black" },
});

export const SOUL_GEM_CONSUMPTION_MODES = Object.freeze({
  DISPOSABLE: "disposable",
  REUSABLE: "reusable",
});

const _TIER_KEYS = Object.freeze(Object.keys(SOUL_GEM_TIERS));
const _LEGACY_ITEM_TYPES = new Set(["item", "equipment"]);

function _finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function _resolveTierKey(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (_TIER_KEYS.includes(normalized)) return normalized;
  return _TIER_KEYS.find((key) => new RegExp(`\\b${key}\\b`, "i").test(normalized)) ?? null;
}

function _resolveConsumptionMode(value = "") {
  return String(value ?? "").trim().toLowerCase() === SOUL_GEM_CONSUMPTION_MODES.REUSABLE
    ? SOUL_GEM_CONSUMPTION_MODES.REUSABLE
    : SOUL_GEM_CONSUMPTION_MODES.DISPOSABLE;
}

function _isExplicitSoulGemFlag(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function _resolveLegacyNameData(item) {
  if (!_LEGACY_ITEM_TYPES.has(String(item?.type ?? "").toLowerCase())) return null;

  const name = String(item?.name ?? "").trim();
  if (!/\bsoul\s+gem\b/i.test(name)) return null;

  const tierKey = _resolveTierKey(name);
  if (!tierKey) return null;

  const explicitlyEmpty = /\bempty\b/i.test(name);
  const explicitlyFilled = /\bfilled\b/i.test(name);
  if (explicitlyEmpty === explicitlyFilled) return null;

  const tier = SOUL_GEM_TIERS[tierKey];
  return {
    tierKey,
    soulSize: tier.label,
    soulType: tier.soulType,
    soulEnergy: explicitlyFilled ? tier.maxEnergy : 0,
    maxSoulEnergy: tier.maxEnergy,
  };
}

/**
 * Return all recognized soul gems in an actor's inventory.
 *
 * @param {Actor} actor
 * @param {{ allowedSoulTypes?: "white"|"black"|"either", includeEmpty?: boolean }} [opts]
 * @returns {Item[]} Filled gems first, then empty gems; each group is sorted by capacity.
 */
export function getSoulGems(actor, { allowedSoulTypes = "either", includeEmpty = true } = {}) {
  if (!actor?.items) return [];

  const gems = [];
  for (const item of actor.items) {
    const data = resolveSoulGemData(item);
    if (!data) continue;
    if (!includeEmpty && !data.isFilled) continue;

    if (allowedSoulTypes !== "either") {
      if (allowedSoulTypes !== data.soulType) continue;
    }

    gems.push(item);
  }

  gems.sort((a, b) => {
    const aData = resolveSoulGemData(a);
    const bData = resolveSoulGemData(b);
    if (aData.isFilled !== bData.isFilled) return aData.isFilled ? -1 : 1;
    const aValue = aData.isFilled ? aData.soulEnergy : aData.maxSoulEnergy;
    const bValue = bData.isFilled ? bData.soulEnergy : bData.maxSoulEnergy;
    return bValue - aValue || String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });

  return gems;
}

/**
 * Return all filled soul gems in an actor's inventory.
 *
 * @param {Actor} actor
 * @param {{ allowedSoulTypes?: "white"|"black"|"either" }} [opts]
 * @returns {Item[]} Sorted by soulEnergy descending (largest first).
 */
export function getFilledSoulGems(actor, { allowedSoulTypes = "either" } = {}) {
  return getSoulGems(actor, { allowedSoulTypes, includeEmpty: false })
    .filter((item) => isSoulGemResourceUsable(item));
}

/**
 * Return whether an actor-owned Item can currently power an enchanting action.
 * Reusable vessels are unique resources because a stack cannot represent a
 * mixture of filled and emptied instances after use.
 */
export function isSoulGemResourceUsable(item, data = resolveSoulGemData(item)) {
  if (!item || !data?.isFilled) return false;
  if (data.maxSoulEnergy <= 0 || data.soulEnergy > data.maxSoulEnergy) return false;
  const quantity = Math.max(0, Number(item.system?.quantity ?? 1) || 0);
  if (quantity < 1) return false;
  return !data.isReusable || quantity === 1;
}

/**
 * Resolve a soul gem Item to its key flags.
 *
 * @param {Item} gemItem
 * @returns {{ soulEnergy: number, maxSoulEnergy: number, soulType: string, soulSize: string, tierKey: string|null, isFilled: boolean, consumptionMode: "disposable"|"reusable", isReusable: boolean, recognitionSource: "flags"|"legacy-name", uuid: string } | null}
 */
export function resolveSoulGemData(gemItem) {
  if (!gemItem) return null;
  const flags = gemItem.flags?.[_NS] ?? {};
  const legacy = _resolveLegacyNameData(gemItem);
  // Recover configurations written by earlier item-sheet forms which
  // serialized the Boolean marker as a true-like string or number.
  const flagRecognized = _isExplicitSoulGemFlag(flags.isSoulGem);
  if (!flagRecognized && !legacy) return null;

  const explicitTier = String(flags.soulTier ?? "").trim().toLowerCase();
  const tierKey = explicitTier === "custom"
    ? null
    : (_resolveTierKey(explicitTier) ?? _resolveTierKey(flags.soulSize) ?? legacy?.tierKey ?? null);
  const tier = tierKey ? SOUL_GEM_TIERS[tierKey] : null;
  const hasFlagEnergy = flags.soulEnergy !== undefined && flags.soulEnergy !== null;
  const soulEnergy = _finiteNonNegative(
    hasFlagEnergy ? flags.soulEnergy : legacy?.soulEnergy,
    0,
  );
  const maxSoulEnergy = tier
    ? tier.maxEnergy
    : _finiteNonNegative(flags.maxSoulEnergy ?? legacy?.maxSoulEnergy ?? soulEnergy, soulEnergy);
  const soulType = String(tier?.soulType ?? flags.soulType ?? legacy?.soulType ?? "white").toLowerCase() === "black"
    ? "black"
    : "white";
  const soulSize = String(tier?.label ?? flags.soulSize ?? legacy?.soulSize ?? "Unknown");
  const consumptionMode = _resolveConsumptionMode(flags.soulGemConsumptionMode);
  return {
    soulEnergy,
    maxSoulEnergy,
    soulType,
    soulSize,
    tierKey,
    isFilled: soulEnergy > 0,
    consumptionMode,
    isReusable: consumptionMode === SOUL_GEM_CONSUMPTION_MODES.REUSABLE,
    recognitionSource: flagRecognized ? "flags" : "legacy-name",
    uuid: gemItem.uuid,
  };
}

/**
 * Consume one soul gem unit from the actor's inventory.
 *
 * Permission-safe: if the current user cannot delete the item directly,
 * falls back to the authority proxy (GM route).
 *
 * @param {Actor} actor
 * @param {Item} gemItem
 * @returns {Promise<boolean>} true only when the quantity update or deletion succeeded
 */
export async function consumeSoulGem(actor, gemItem) {
  if (!actor || !gemItem) return false;
  const liveItem = actor.items?.get?.(gemItem.id) ?? null;
  if (!liveItem || liveItem.parent?.uuid !== actor.uuid || !resolveSoulGemData(liveItem)) return false;

  const gemData = resolveSoulGemData(liveItem);
  const quantity = Math.max(0, Number(liveItem.system?.quantity ?? 1) || 0);
  if (quantity < 1) return false;
  if (gemData?.isReusable) {
    if (quantity !== 1 || !gemData.isFilled) return false;
    return requestUpdateDocument(liveItem, { [`flags.${_NS}.soulEnergy`]: 0 });
  }
  if (quantity > 1) return requestUpdateDocument(liveItem, { "system.quantity": quantity - 1 });
  return requestDeleteEmbeddedDocuments(actor, "Item", [liveItem.id]);
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
