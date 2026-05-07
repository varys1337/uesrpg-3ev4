/**
 * src/core/combat/damage/calc.js
 * UESRPG 3e v4 — Damage Calculation
 *
 * Handles final damage calculation including reductions and weapon quality bonuses.
 */

import { getDamageReduction, isItemMagicSource } from "./reduction.js";
import { itemHasToken } from "./tokens.js";
import { isActorIncorporeal, getActorTraitValue } from "../../traits/trait-registry.js";
import { hasTalent } from "../../traits/talents-api.js";
import { DAMAGE_TYPES } from "./types.js";
import { downgradeArmorCoverage } from "../armor-state.js";

/**
 * Compute the RAW weapon-quality bonus damage for "The Big Three":
 *  - Crushing (X): +min(STR bonus (or X), target AR at hit location)
 *  - Splitting (X): +STR bonus (or X) if the *initial* damage causes the target to lose >=1 HP
 *  - Slashing (X): +STR bonus (or X) against *unarmored* hit locations
 *
 * Notes (implementation choices):
 *  - Only applies to PHYSICAL damage.
 *  - The cap for Crushing uses the target location's armor *before* penetration.
 *  - Splitting triggers based on damage after reductions, before applying the Splitting bonus.
 *
 * @param {object} params
 * @returns {number}
 */
export function computeBigThreeBonus({ damageType, weapon, ammo, attackerActor, originalArmor, triggerArmor, triggerArmorClass, triggerCoverageDowngradeSteps = 0, baseTotalDamage, reductionsTotal }) {
  if (String(damageType ?? "").toLowerCase() !== "physical") return 0;
  if (!weapon || !attackerActor) return 0;

  // Resolve ammo from the weapon if not provided (non-persistent, best-effort).
  let ammoItem = ammo ?? null;
  if (!ammoItem && weapon?.system?.ammoId) {
    const ammoId = String(weapon.system.ammoId ?? "").trim();
    if (ammoId) {
      ammoItem = weapon?.actor?.items?.get?.(ammoId) ?? attackerActor?.items?.get?.(ammoId) ?? null;
    }
  }

  const collectQualities = (item, { includeActivation = false } = {}) => {
    if (!item) return [];
    const sys = item.system ?? {};
    const out = [];

    const structured = Array.isArray(sys.qualitiesStructuredInjected)
      ? sys.qualitiesStructuredInjected
      : Array.isArray(sys.qualitiesStructured)
        ? sys.qualitiesStructured
        : [];
    for (const q of structured) {
      if (!q) continue;
      const key = String(q?.key ?? q ?? "").trim();
      if (!key) continue;
      out.push({ key, value: q?.value });
    }

    const traits = Array.isArray(sys.qualitiesTraitsInjected)
      ? sys.qualitiesTraitsInjected
      : Array.isArray(sys.qualitiesTraits)
        ? sys.qualitiesTraits
        : [];
    for (const t of traits) {
      if (!t) continue;
      const key = String(t ?? "").trim();
      if (!key) continue;
      out.push({ key, value: null });
    }

    if (includeActivation) {
      const activationStructured = Array.isArray(sys.activation?.damage?.qualitiesStructured)
        ? sys.activation.damage.qualitiesStructured
        : [];
      for (const q of activationStructured) {
        if (!q) continue;
        const key = String(q?.key ?? q ?? "").trim();
        if (!key) continue;
        out.push({ key, value: q?.value });
      }

      const activationTraits = Array.isArray(sys.activation?.damage?.qualitiesTraits)
        ? sys.activation.damage.qualitiesTraits
        : [];
      for (const t of activationTraits) {
        if (!t) continue;
        const key = String(t ?? "").trim();
        if (!key) continue;
        out.push({ key, value: null });
      }
    }

    return out;
  };

  const qualityMap = new Map();
  const addQuality = (key, value) => {
    const k = String(key ?? "").toLowerCase().trim();
    if (!k) return;
    const n = Number(value);
    const v = Number.isFinite(n) && n !== 0 ? n : null;

    if (!qualityMap.has(k)) {
      qualityMap.set(k, { value: v });
      return;
    }
    if (v == null) return;
    const cur = qualityMap.get(k)?.value;
    if (cur == null || v > cur) {
      qualityMap.set(k, { value: v });
    }
  };

  for (const q of collectQualities(weapon, { includeActivation: true })) addQuality(q.key, q.value);
  for (const q of collectQualities(ammoItem)) addQuality(q.key, q.value);

  const hasQuality = (key) => qualityMap.has(String(key ?? "").toLowerCase());
  const getQualityValue = (key) => {
    const k = String(key ?? "").toLowerCase();
    if (!qualityMap.has(k)) return null;
    const v = qualityMap.get(k)?.value;
    return (v == null) ? null : Number(v);
  };

  // Resolve attacker characteristic bonuses.
  const strBonus = Number(attackerActor?.system?.characteristics?.str?.bonus ?? 0) || 0;
  const prcBonus = Number(attackerActor?.system?.characteristics?.prc?.bonus ?? 0) || 0;
  const agiBonus = Number(attackerActor?.system?.characteristics?.agi?.bonus ?? 0) || 0;

  const viciousValue = Math.max(0, Number(getActorTraitValue(attackerActor, "vicious", { mode: "max" })) || 0);
  const baseStrengthBonus = viciousValue > 0 ? viciousValue : strBonus;

  const hasPerfectHit = hasTalent(attackerActor, "perfecthit");
  const hasCrackshot = hasTalent(attackerActor, "crackshot");

  const weaponMode = String(weapon?.system?.attackMode ?? weapon?.system?.weaponType ?? weapon?.system?.type ?? "").toLowerCase();
  const isRangedWeapon = weaponMode.includes("ranged");
  const isThrown = itemHasToken(weapon, "thrown")
    || (String(weapon?.system?.rangeBandsDerivedEffective?.kind ?? weapon?.system?.rangeBandsDerived?.kind ?? "") === "thrown");
  // RAW: Thrown weapons ignore Big Three bonuses only when making ranged attacks.
  if (isThrown && isRangedWeapon) return 0;

  const pickBonus = (qualityKey) => {
    const k = String(qualityKey ?? "").toLowerCase();
    if (k === "crushing") {
      return hasPerfectHit ? prcBonus : baseStrengthBonus;
    }
    if (k === "slashing" || k === "splitting") {
      if (hasCrackshot && isRangedWeapon && !isThrown) return agiBonus;
      if (hasPerfectHit) return prcBonus;
      return baseStrengthBonus;
    }
    return baseStrengthBonus;
  };

  let bonus = 0;

  // Crushing (X)
  if (hasQuality("crushing")) {
    const x = getQualityValue("crushing") ?? pickBonus("crushing");
    const cap = Math.max(0, Number(originalArmor ?? 0));
    bonus += Math.max(0, Math.min(Math.max(0, x), cap));
  }

  const normalizeClass = (v) => {
    const s = String(v ?? "").toLowerCase().trim();
    if (s === "full" || s === "partial" || s === "none") return s;
    return "";
  };
  const hasExploitWeakness = hasQuality("exploitWeakness");
  let effectiveArmorClass = normalizeClass(triggerArmorClass);
  if (!effectiveArmorClass) {
    effectiveArmorClass = (Number(triggerArmor ?? 0) > 0) ? "full" : "none";
  }
  const triggerDowngradeSteps = Math.max(0, Number(triggerCoverageDowngradeSteps ?? 0) || 0)
    + (hasExploitWeakness ? 1 : 0);
  effectiveArmorClass = downgradeArmorCoverage(effectiveArmorClass || "none", triggerDowngradeSteps);

  // Slashing (X)
  if (hasQuality("slashing")) {
    const isUnarmored = effectiveArmorClass === "none" || Number(triggerArmor ?? originalArmor ?? 0) <= 0;
    if (isUnarmored) {
      const x = getQualityValue("slashing") ?? pickBonus("slashing");
      bonus += Math.max(0, x);
    }
  }

  // Splitting (X)
  if (hasQuality("splitting")) {
    const initialFinal = Math.max(0, Number(baseTotalDamage ?? 0) - Number(reductionsTotal ?? 0));
    if (initialFinal >= 1) {
      const x = getQualityValue("splitting") ?? pickBonus("splitting");
      bonus += Math.max(0, x);
    }
  }

  return Number.isFinite(bonus) ? bonus : 0;
}

/**
 * Calculate final damage after reductions.
 *
 * @param {number} rawDamage
 * @param {string} damageType
 * @param {Actor} targetActor
 * @param {object} options
 * @param {number} options.penetration
 * @param {number} options.dosBonus
 * @param {string} options.hitLocation
 * @param {boolean} options.ignoreArmor
 * @param {boolean} options.ignoreArmorOnly
 * @param {Item|null} options.ammo
 * @returns {{
 *   rawDamage:number,
 *   dosBonus:number,
 *   totalDamage:number,
 *   reductions:{armor:number,resistance:number,toughness:number,total:number,penetrated:number},
 *   finalDamage:number,
 *   hitLocation:string,
 *   damageType:string
 * }}
 */
export function calculateDamage(rawDamage, damageType, targetActor, options = {}) {
  const {
    penetration = 0,
    dosBonus = 0,
    hitLocation = "Body",
    ignoreArmor = false,
    ignoreArmorOnly = false,
    // Advantage: Penetrate Armor — does not change AR, but treats armored locations as less protected
    // for the purpose of trigger-style effects (e.g., Slashing).
    penetrateArmorForTriggers = false,
    // Optional: provide weapon/attacker to enable RAW weapon-quality bonus damage
    // ("The Big Three": Crushing, Splitting, Slashing).
    weapon = null,
    attackerActor = null,
    ammo = null,
  } = options;

  /** @type {{armor:number,resistance:number,toughness:number,total:number,penetrated:number}} */
  let reductions = { armor: 0, resistance: 0, toughness: 0, total: 0, penetrated: 0 };

  // Track the target's *pre-penetration* armor for RAW interactions (e.g., Crushing cap, Slashing trigger).
  let originalArmor = 0;

  const attackerIncorporeal = isActorIncorporeal(attackerActor);
  const ignoreNonMagicArmor = attackerIncorporeal && String(damageType ?? "").toLowerCase() === DAMAGE_TYPES.PHYSICAL;

  if (!ignoreArmor) {
    reductions = getDamageReduction(targetActor, damageType, hitLocation, { ignoreNonMagicArmor, attackerActor });

    // Penetration reduces ARMOR only (not resistance/toughness)
    originalArmor = Number(reductions.armor ?? 0);
    if (ignoreArmorOnly) {
      reductions.penetrated = 0;
      reductions.armor = 0;
      reductions.total = reductions.resistance + reductions.toughness;
    } else {
      const penetratedArmor = Math.max(0, originalArmor - Number(penetration || 0));
      reductions.penetrated = Math.max(0, originalArmor - penetratedArmor);
      reductions.armor = penetratedArmor;
      reductions.total = reductions.armor + reductions.resistance + reductions.toughness;
    }
  }

  // Base damage = raw + DoS bonus (existing behavior)
  const baseTotalDamage = Math.max(0, Number(rawDamage || 0) + Number(dosBonus || 0));

  // --- Weapon quality bonuses (Step 1): Crushing, Splitting, Slashing
  // These bonuses are only applied for PHYSICAL damage.
  const qualBonus = computeBigThreeBonus({
    damageType,
    weapon,
    ammo,
    attackerActor,
    originalArmor,
    triggerArmor: originalArmor,
    triggerArmorClass: reductions.coverage?.class ?? "none",
    triggerCoverageDowngradeSteps: (ignoreArmorOnly ? 999 : 0) + (penetrateArmorForTriggers ? 1 : 0),
    baseTotalDamage,
    reductionsTotal: reductions.total,
  });

  const totalDamage = Math.max(0, baseTotalDamage + qualBonus);
  const finalDamage = Math.max(0, totalDamage - reductions.total);

  return {
    rawDamage: Number(rawDamage || 0),
    dosBonus: Number(dosBonus || 0),
    totalDamage,
    reductions,
    finalDamage,
    hitLocation,
    damageType,
    weaponBonus: qualBonus,
    incorporealAttack: ignoreNonMagicArmor ? { ignoreNonMagicArmor: true } : null,
  };
}
