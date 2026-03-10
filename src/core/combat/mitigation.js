/**
 * src/core/combat/mitigation.js
 *
 * Canonical mitigation resolvers.
 *
 * Design constraints:
 *  - Foundry v13 only
 *  - No schema changes
 *  - Deterministic and defensive around partial data
 */

import { getWallOfSteelShieldBlockBonus } from "../traits/resilience-talents.js";
import { getShieldBlockProfile } from "../items/shield-utils.js";

const LOCATION_MAP = {
  Head: { key: "Head", label: "Head" },
  Body: { key: "Body", label: "Body" },
  "Right Arm": { key: "RightArm", label: "Right Arm" },
  "Left Arm": { key: "LeftArm", label: "Left Arm" },
  "Right Leg": { key: "RightLeg", label: "Right Leg" },
  "Left Leg": { key: "LeftLeg", label: "Left Leg" },
  RightArm: { key: "RightArm", label: "Right Arm" },
  LeftArm: { key: "LeftArm", label: "Left Arm" },
  RightLeg: { key: "RightLeg", label: "Right Leg" },
  LeftLeg: { key: "LeftLeg", label: "Left Leg" },
};

export function normalizeHitLocation(hitLocation) {
  const raw = String(hitLocation ?? "Body").trim();
  return LOCATION_MAP[raw] ?? LOCATION_MAP.Body;
}

/**
 * Determine effective Block Rating (BR) for a shield vs incoming damage type.
 * Prefers derived fields computed in Item#prepareData when present.
 */
export function getBlockValue(shield, damageType = "physical") {
  const profile = getShieldBlockProfile(shield, damageType);
  if (!profile?.isShield) return 0;

  // Wall of Steel (Chapter 4): +1 BR for worn shields.
  const parentActor = shield?.actor ?? shield?.parent ?? null;
  const wallBonus = parentActor ? Number(getWallOfSteelShieldBlockBonus(parentActor) || 0) : 0;
  const dt = String(damageType || "physical").toLowerCase();
  if (dt === "physical") return Math.max(0, profile.baseBR + wallBonus);
  if (profile.magicBR > 0) return Math.max(0, profile.magicBR);
  return Math.max(0, Math.ceil((profile.baseBR + wallBonus) / 2));
}
