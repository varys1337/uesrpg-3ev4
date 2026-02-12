/**
 * src/core/actors/rules/armor-mobility.js
 *
 * Determine the heaviest *effective* armor weight class currently worn.
 * Computes mobility penalties for encumbrance and skill tests.
 */

/**
 * Determine the heaviest *effective* armor weight class currently worn.
 *
 * Rules contract:
 * - Automation uses effective values.
 * - Armor quality modifies effective weight class (Inferior => +1 step, Superior => -1 step).
 * - Shields are armor-type items but do NOT participate in worn-armor mobility penalties.
 *
 * This returns an object describing the result and derived penalties.
 * @param {object} actorData
 * @returns {object} Mobility penalties and sources
 */
export function getArmorMobilityPenalties(actorData) {
  const itemsRaw = actorData?.items;
  const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw ? Array.from(itemsRaw) : []);

  const order = ["none", "light", "medium", "heavy", "superheavy", "crippling"]; // must match constants
  const clampIndex = (i) => Math.max(0, Math.min(order.length - 1, i));

  // Normalize generic free-text fields
  const norm = (v) => String(v ?? "").trim().toLowerCase();

  // Normalize armor weight class values.
  // We must be resilient to historic / UI-facing variants such as:
  // - "Super Heavy"
  // - "super_heavy"
  // - "super-heavy"
  // While still matching our canonical keys used throughout the system.
  const normWeightClass = (v) => norm(v).replace(/[\s_-]+/g, "");

  let maxIdx = 0; // none
  let sources = [];

  for (const it of items) {
    if (!it || it.type !== "armor") continue;
    const sys = it.system ?? {};
    const isEquipped = Object.prototype.hasOwnProperty.call(sys, "equipped") ? !!sys.equipped : true;
    if (!isEquipped) continue;

    const isShield = Boolean(sys?.isShieldEffective ?? sys?.isShield);
    if (isShield) continue;

    // Weight class can exist in a few places depending on item version and sheet usage.
    // Canonical persisted field: system.weightClass (values like "light", "superheavy").
    // Some legacy data or user-edited items may contain "super_heavy" or "Super Heavy".
    // Some sheets compute an unpersisted derived field: system.effectiveWeightClass.
    // As a last resort, if the item has no usable class, we *do not* guess here; we
    // handle actor-level fallback after iterating items.
    const baseWC = normWeightClass(
      sys.weightClass ??
      sys.effectiveWeightClass ??
      sys.armorWeightClass ??
      sys.armor_class ??
      sys.armorClass
    ) || "none";
    const q = norm(sys.qualityLevel) || "common";
    let idx = order.indexOf(baseWC);
    if (idx < 0) idx = 0;

    // Quality adjustment: Inferior => heavier; Superior => lighter
    if (q === "inferior") idx = clampIndex(idx + 1);
    else if (q === "superior") idx = clampIndex(idx - 1);

    if (idx > maxIdx) {
      maxIdx = idx;
      sources = [it];
    } else if (idx === maxIdx && idx > 0) {
      sources.push(it);
    }
  }

  // Actor-level fallback: some worlds historically tracked armor class on the actor (Status AC dropdown)
  // rather than on each armor item. If no equipped armor item provided a usable weight class,
  // fall back to actor.system.armor_class.
  if (maxIdx === 0) {
    const actorWC = normWeightClass(actorData?.system?.armor_class);
    const actorIdx = order.indexOf(actorWC);
    if (actorIdx > 0) maxIdx = actorIdx;
  }

  const effectiveWeightClass = order[maxIdx] ?? "none";

  // Mobility penalties by effective armor weight class (RAW).
  // Data contract consumed by skill TN logic:
  // - armorWeightClass: string
  // - agilityTestPenalty: number (applies to Agility-based skill tests, except Combat Style)
  // - skillTestPenalties: { [lowerSkillName]: number } (skill-specific penalties, e.g. Acrobatics in Light)
  // - allTestPenalty: number (applies to all tests; used for Crippling)
  // - speedPenalty: number (applied elsewhere for movement)
  const penalties = {
    armorWeightClass: effectiveWeightClass,
    agilityTestPenalty: 0,
    agilityPenaltyExemptSkills: ["combatstyle", "combat_style", "combat style"],
    skillTestPenalties: {},
    allTestPenalty: 0,
    speedPenalty: 0,
    sources: sources.map(s => ({ id: s._id, name: s.name }))
  };

  // RAW table (Chapter 1, Weight Classes):
  // - Light: -10 Acrobatics
  // - Medium: -10 Agility-based (except Combat Style), Speed -1
  // - Heavy: -20 Agility-based (except Combat Style), Speed -2
  // - Super-Heavy: -30 Agility-based (except Combat Style), Speed -3
  // - Crippling: -40 all tests, cannot move (speed handling elsewhere)
  switch (effectiveWeightClass) {
    case "light":
      penalties.skillTestPenalties["acrobatics"] = -10;
      break;
    case "medium":
      penalties.agilityTestPenalty = -10;
      penalties.speedPenalty = -1;
      break;
    case "heavy":
      penalties.agilityTestPenalty = -20;
      penalties.speedPenalty = -2;
      break;
    case "superheavy":
      penalties.agilityTestPenalty = -30;
      penalties.speedPenalty = -3;
      break;
    case "crippling":
      penalties.allTestPenalty = -40;
      // Speed/movement restriction is handled in the actor's speed calculation pipeline.
      break;
    default:
      break;
  }

  return penalties;
}

/**
 * Calculate fly speed bonus from equipped items.
 * @param {object} actorData
 * @returns {number} Fly bonus
 */
export function flyCalc(actorData) {
  const itemsRaw = actorData?.items;
  const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw ? Array.from(itemsRaw) : []);
  const equipped = items.filter(i =>
    i?.system && Object.prototype.hasOwnProperty.call(i.system, 'flyBonus') &&
    (Object.prototype.hasOwnProperty.call(i.system, 'equipped') ? i.system.equipped : true)
  );
  let bonus = 0;
  for (let item of equipped) {
    bonus = bonus + Number(item?.system?.flyBonus || 0);
  }
  return bonus;
}
