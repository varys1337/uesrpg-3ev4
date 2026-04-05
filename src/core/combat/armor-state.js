/**
 * src/core/combat/armor-state.js
 * UESRPG 3e v4 — Authoritative Armor State Resolution
 *
 * Single source of truth for:
 *  - selecting which armor lane applies (full / partial / none)
 *  - reading manual authored values from that lane
 *  - applying downgrade transforms (prone, trigger-only downgrade steps) without mutating items
 *
 * Consumers (reduction.js, calc.js, apply.js, reporting helpers) must route
 * armor value reads through this module rather than reconstructing the logic inline.
 *
 * Shield items are NOT handled here — shields use their own block-rating pipeline.
 */

export const ARMOR_LOCATION_KEYS = ["Head", "Body", "RightArm", "LeftArm", "RightLeg", "LeftLeg"];

/**
 * Resolve the native coverage lane ("full" or "partial") from an item's armorClass field.
 *
 * @param {object} sys - item.system
 * @returns {"full"|"partial"}
 */
export function getArmorNativeLane(sys) {
  return String(sys?.armorClass || "partial").toLowerCase() === "full" ? "full" : "partial";
}

/**
 * Downgrade an armor coverage state by N steps.
 *  full  → (1 step) → partial → (1 step) → none
 *  none  → none (floor)
 *
 * @param {"full"|"partial"|"none"} state
 * @param {number} [steps=1]
 * @returns {"full"|"partial"|"none"}
 */
export function downgradeArmorCoverage(state, steps = 1) {
  const order = ["none", "partial", "full"];
  const n = Math.max(0, Math.trunc(Number(steps) || 0));
  if (!n) return state;
  let idx = order.indexOf(String(state ?? "none").toLowerCase());
  if (idx < 0) idx = 0;
  return order[Math.max(0, idx - n)];
}

/**
 * Read the manually authored armor values for a specific lane.
 * Falls back gracefully to zeroes when armorValues is absent (legacy items during transition).
 *
 * @param {object} sys - item.system
 * @param {"full"|"partial"} lane
 * @returns {{ armor:number, magic_ar:number, special_ar:number, special_ar_type:string }}
 */
export function getArmorValuesForLane(sys, lane) {
  const src = sys?.armorValues?.[lane] ?? {};
  return {
    armor:           Number(src.armor          ?? 0) || 0,
    magic_ar:        Number(src.magic_ar       ?? 0) || 0,
    special_ar:      Number(src.special_ar     ?? 0) || 0,
    special_ar_type: String(src.special_ar_type ?? "").trim().toLowerCase(),
  };
}

/**
 * Resolve the effective armor coverage state for an item at runtime.
 *
 * Takes into account:
 *  - the item's native armorClass (full / partial)
 *  - Prone condition (full → partial) for trigger/classification purposes
 *
 * Does NOT mutate the item.
 *
 * @param {object} sys - item.system
 * @param {object} [options]
 * @param {boolean} [options.isProneForArmor=false]
 * @returns {"full"|"partial"|"none"}
 */
export function getArmorCoverageState(sys, { isProneForArmor = false, coverageDowngradeSteps = 0 } = {}) {
  let coverage = getArmorNativeLane(sys);
  if (coverage === "full" && isProneForArmor) coverage = "partial";
  return downgradeArmorCoverage(coverage, coverageDowngradeSteps);
}

/**
 * Determine whether an armor item explicitly covers a normalized hit location.
 *
 * @param {Item|object} itemOrSystem
 * @param {string} locationKey
 * @returns {boolean}
 */
export function isArmorCoveringLocation(itemOrSystem, locationKey) {
  const key = String(locationKey ?? "").trim();
  if (!key) return false;
  const sys = itemOrSystem?.system ?? itemOrSystem ?? {};
  return sys?.hitLocations?.[key] === true;
}

/**
 * Read the effectively active armor values for an item at runtime.
 *
 * Applies Damaged(X) from the item's structured qualities AFTER selecting the lane.
 * Does NOT mutate the item.
 *
 * Important: callers deciding whether Prone should affect real protection must
 * opt in explicitly via isProneForArmor. RAW uses Prone as a coverage downgrade
 * for trigger-style interactions, but not as an AR/MR/special AR degradation.
 *
 * @param {object} sys - item.system
 * @param {object} [options]
 * @param {boolean} [options.isProneForArmor=false]
 * @returns {{
 *   nativeLane: "full"|"partial",
 *   effectiveLane: "full"|"partial"|"none",
 *   armor: number,
 *   magic_ar: number,
 *   special_ar: number,
 *   special_ar_type: string
 * }}
 */
export function getResolvedArmorValues(sys, { isProneForArmor = false, coverageDowngradeSteps = 0 } = {}) {
  const nativeLane   = getArmorNativeLane(sys);
  const effectiveLane = getArmorCoverageState(sys, { isProneForArmor, coverageDowngradeSteps });

  if (effectiveLane === "none") {
    return { nativeLane, effectiveLane, armor: 0, magic_ar: 0, special_ar: 0, special_ar_type: "" };
  }

  // Damaged quality: reduce the selected lane's values.
  const qs = Array.isArray(sys?.qualitiesStructured) ? sys.qualitiesStructured : [];
  const damagedQ = qs.find(q => String(q?.key ?? "").toLowerCase() === "damaged");
  const damagedValue = Math.max(0, Number(damagedQ?.value ?? 0) || 0);

  const base = getArmorValuesForLane(sys, effectiveLane);

  return {
    nativeLane,
    effectiveLane,
    armor:           Math.max(0, base.armor    - damagedValue),
    magic_ar:        Math.max(0, base.magic_ar - damagedValue),
    special_ar:      Math.max(0, base.special_ar - damagedValue),
    special_ar_type: base.special_ar_type,
  };
}
