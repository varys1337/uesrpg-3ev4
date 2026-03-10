/**
 * src/core/combat/damage/resolver/armor.js
 *
 * Armor source reporting utilities for damage resolution.
 */
import { isShieldItem } from "../../../items/shield-utils.js";
import { getResolvedArmorValues, isArmorCoveringLocation } from "../../armor-state.js";

function normalizeLocationKey(hitLocation = "Body") {
  const locationMap = {
    Head: "Head",
    Body: "Body",
    "Right Arm": "RightArm",
    "Left Arm": "LeftArm",
    "Right Leg": "RightLeg",
    "Left Leg": "LeftLeg",
    RightArm: "RightArm",
    LeftArm: "LeftArm",
    RightLeg: "RightLeg",
    LeftLeg: "LeftLeg",
  };
  return locationMap[hitLocation] ?? hitLocation;
}

function actorHasConditionKey(actor, key) {
  const k = String(key || "").trim().toLowerCase();
  if (!actor || !k) return false;

  for (const ef of (actor.effects ?? [])) {
    try {
      if (ef?.disabled) continue;
      if (ef?.statuses?.has?.(k)) return true;
      if (String(ef?.flags?.core?.statusId ?? "").toLowerCase() === k) return true;
      if (String(ef?.flags?.["uesrpg-3ev4"]?.condition?.key ?? "").toLowerCase() === k) return true;
      if (String(ef?.name ?? "").toLowerCase() === k) return true;
    } catch (_e) {
      continue;
    }
  }

  return false;
}

/**
 * Best-effort reporting helper: list equipped armor items that explicitly cover a location.
 * This mirrors the simplest branch of getDamageReduction() coverage checks.
 * It is used for chat-card attribution only and MUST NOT affect mechanics.
 *
 * @param {Actor} actor
 * @param {string} locKey - normalized location key (e.g. "Head", "Body", "LeftLeg")
 * @returns {{name:string, ar:number}[]}
 */
export function listArmorSourcesForLocation(actor, locKey) {
  try {
    const locationKey = normalizeLocationKey(locKey);
    const items = actor?.items?.filter((i) => (i?.type === "armor" || i?.type === "shield") && i?.system?.equipped === true && !isShieldItem(i, { allowLegacy: true })) ?? [];
    const isProneForArmor = actorHasConditionKey(actor, "prone");
    const out = [];
    for (const item of items) {
      if (!isArmorCoveringLocation(item, locationKey)) continue;

      const ar = Number(getResolvedArmorValues(item?.system ?? {}, { isProneForArmor }).armor ?? 0);

      if (Number.isFinite(ar) && ar > 0) {
        out.push({ name: String(item.name ?? "Armor"), ar });
      }
    }
    return out;
  } catch (_err) {
    return [];
  }
}
