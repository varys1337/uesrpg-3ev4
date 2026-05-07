/**
 * src/core/actors/rules/item-aggregation.js
 *
 * Single-pass item statistics aggregation.
 * Collects ENC, characteristic bonuses, resistances, skill modifiers, etc.
 */

import { collectTraitDamageModifiers, getResistanceKeyForTraitType } from "../../traits/trait-registry.js";
import { getFeatureConfig } from "../../traits/features/feature-config.js";
import { isShieldItem } from "../../items/shield-utils.js";
import { getCachedItemAggregation, setCachedItemAggregation } from "../derived-cache/actor-derived-cache.js";

/**
 * Check whether a passive feature item (trait/talent/power) is currently
 * active given its per-item feature configuration and the current combat state.
 *
 * @param {object} item - The item to check.
 * @returns {boolean} True if the item's bonuses should be aggregated.
 */
function _isFeatureActive(item) {
  const fcfg = getFeatureConfig(item);
  if (fcfg?.enabled === false) return false;

  // (#7) Combat gating: respect combatOnly and outOfCombatAllowed flags.
  const inCombat = Boolean(game?.combat?.started);
  if (fcfg?.combatOnly && !inCombat) return false;
  if (fcfg?.outOfCombatAllowed === false && !inCombat) return false;

  return true;
}

/**
 * Aggregate item stats in a single pass to avoid repeated item.filter() work.
 *
 * Cache invalidation is event-driven via DERIVED_DATA_CACHE_INVALIDATION_V1 hooks in
 * src/hooks/init.js (item create/update/delete clears actor._aggCache).
 * Secondary invalidation: combat state, because _isFeatureActive() gates passive features
 * on game.combat.started.
 *
 * @param {SimpleActor} actor
 * @param {object} actorData - Actor data (for legacy compatibility)
 * @returns {object} Aggregated stats
 */
export function aggregateItemStats(actor, actorData) {
  const combatState = Boolean(game?.combat?.started);

  // Return cached result if the cache is still valid.
  // Cache is nulled by item create/update/delete hooks; combat state guards feature gating.
  const cached = getCachedItemAggregation(actor, combatState);
  if (cached) return cached;

  const itemsRaw = actorData?.items;
  const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw ? Array.from(itemsRaw) : []);

  const stats = {
    charBonus: { str:0, end:0, agi:0, int:0, wp:0, prc:0, prs:0, lck:0 },
    hpBonus:0, mpBonus:0, spBonus:0, lpBonus:0, wtBonus:0, speedBonus:0, iniBonus:0,
    resist: { diseaseR:0, fireR:0, frostR:0, shockR:0, poisonR:0, magicR:0, natToughnessR:0, silverR:0, sunlightR:0 },
    swimBonus:0, flyBonus:0, doubleSwimSpeed:false, addHalfSpeed:false, halfSpeed:false,
    totalEnc:0, armorEnc:0, excludedEnc:0,
    zeroEncItemCount: 0,
    skillModifiers: {},
    traitsAndTalents: [],
    shiftForms: [],
    forms: {
      vampireLord: false,
      wereWolf: false,
      wereBat: false,
      wereBoar: false,
      wereBear: false,
      wereCrocodile: false,
      wereVulture: false,
      lichForm: false,
      boneTyrant: false,
      skeletonChampion: false,
    },
    actorFlags: {
      isMechanical: false,
      dwemerSphere: false,
      painIntolerant: false,
    },
    mobility: null,
    itemCount: items.length
  };

  // Mobility accumulation (same semantics as armor-mobility fallback scan).
  const mobilityOrder = ["none", "light", "medium", "heavy", "superheavy", "crippling"];
  const clampMobilityIndex = (i) => Math.max(0, Math.min(mobilityOrder.length - 1, i));
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  const normWeightClass = (v) => norm(v).replace(/[\s_-]+/g, "");
  let mobilityMaxIdx = 0;
  let mobilitySources = [];

  // Track schema resistance values contributed by trait items specifically.
  // collectTraitDamageModifiers() also parses trait items via traitKey/traitParam/traitValue
  // and applies highest-wins stacking. If a trait has BOTH schema XR fields AND traitKey
  // data populated, the per-item sum and the traitDamage post-loop would double-count.
  // We track the trait-item schema contribution so we can subtract the overlap below.
  const traitSchemaResist = { diseaseR:0, fireR:0, frostR:0, shockR:0, poisonR:0, magicR:0, natToughnessR:0, silverR:0, sunlightR:0 };

  for (let item of items) {
    const sys = item && item.system ? item.system : {};
    const enc = Number(sys.enc || 0);
    const qty = Number(sys.quantity || 0);
    const itemWeight = enc * qty;
    const id = item?._id || '';
    const itemType = item?.type;
    
    // EQUIPMENT STATUS DETERMINATION
    // (#7) Talents, Traits, and Powers are passive features whose activation respects
    // per-item feature configuration (combatOnly, outOfCombatAllowed).
    // Equipment items (weapons/armor/gear) respect the 'equipped' flag when present.
    const isPassiveFeature = (itemType === 'talent' || itemType === 'trait' || itemType === 'power');
    const isEquipped = isPassiveFeature
      ? _isFeatureActive(item)
      : (Object.prototype.hasOwnProperty.call(sys, 'equipped') ? sys.equipped : true);
    const appliesPassiveItemStats = isPassiveFeature || isEquipped;

    // RAW Chapter 1 & 7: "Total ENC = sum of ENC of ALL equipment they are carrying"
    // Special cases:
    // - "When worn, the ENC of armor is halved" (equipped armor only)
    // - "Shields do not benefit from this effect" (never halved)
    // - "Containers halve the total effective value of the ENC contained within them"
    
    const isShield = isShieldItem(item, { allowLegacy: true });
    const isWornArmor = (item?.type === 'armor' && isEquipped && !isShield);
    const isContained = (sys?.containerStats?.contained === true);

    // Calculate contributed weight according to RAW
    let contributedWeight = itemWeight; // Default: all items contribute full weight
    
    // RAW: Containers halve the ENC of items inside them
    if (isContained) {
      contributedWeight = itemWeight / 2;
    }
    
    // RAW: "When worn, the ENC of armor is halved (but not for carried shields)"
    // This applies AFTER container reduction (if applicable)
    if (isWornArmor) {
      contributedWeight = contributedWeight / 2;
    }
    
    // RAW Chapter 1: "Items with an ENC of zero are, on their own, inconsequential.
    // But if a character is carrying a large number of these items, treat every
    // 10 zero ENC items as having a total ENC of one."
    if (enc === 0 && qty > 0) {
      stats.zeroEncItemCount += qty;
    }

    stats.totalEnc += contributedWeight;

    // Track worn armor ENC separately for display purposes
    if (isWornArmor) {
      stats.armorEnc += itemWeight; // Store original weight before halving
    }

    // Characteristic bonuses: equipment is equip-gated; feature items are passive.
    if (appliesPassiveItemStats && sys.characteristicBonus) {
      stats.charBonus.str += Number(sys.characteristicBonus.strChaBonus || 0);
      stats.charBonus.end += Number(sys.characteristicBonus.endChaBonus || 0);
      stats.charBonus.agi += Number(sys.characteristicBonus.agiChaBonus || 0);
      stats.charBonus.int += Number(sys.characteristicBonus.intChaBonus || 0);
      stats.charBonus.wp += Number(sys.characteristicBonus.wpChaBonus || 0);
      stats.charBonus.prc += Number(sys.characteristicBonus.prcChaBonus || 0);
      stats.charBonus.prs += Number(sys.characteristicBonus.prsChaBonus || 0);
      stats.charBonus.lck += Number(sys.characteristicBonus.lckChaBonus || 0);
    }

    // Resource/resist/stat bonuses: equipment is equip-gated; feature items are passive.
    if (appliesPassiveItemStats) {
      stats.hpBonus += Number(sys.hpBonus || 0);
      stats.mpBonus += Number(sys.mpBonus || 0);
      stats.spBonus += Number(sys.spBonus || 0);
      stats.lpBonus += Number(sys.lpBonus || 0);
      stats.wtBonus += Number(sys.wtBonus || 0);
      stats.speedBonus += Number(sys.speedBonus || 0);
      stats.iniBonus += Number(sys.iniBonus || 0);

      stats.resist.diseaseR += Number(sys.diseaseR || 0);
      stats.resist.fireR += Number(sys.fireR || 0);
      stats.resist.frostR += Number(sys.frostR || 0);
      stats.resist.shockR += Number(sys.shockR || 0);
      stats.resist.poisonR += Number(sys.poisonR || 0);
      stats.resist.magicR += Number(sys.magicR || 0);
      // Chapter 4 X-traits: highest value wins when duplicated.
      stats.resist.natToughnessR = Math.max(stats.resist.natToughnessR, Number(sys.natToughnessR || 0));
      stats.resist.silverR += Number(sys.silverR || 0);
      stats.resist.sunlightR += Number(sys.sunlightR || 0);

      // Track trait-item schema resistance values for de-duplication with
      // collectTraitDamageModifiers (highest-wins) in the post-loop below.
      if (itemType === 'trait') {
        traitSchemaResist.diseaseR += Number(sys.diseaseR || 0);
        traitSchemaResist.fireR += Number(sys.fireR || 0);
        traitSchemaResist.frostR += Number(sys.frostR || 0);
        traitSchemaResist.shockR += Number(sys.shockR || 0);
        traitSchemaResist.poisonR += Number(sys.poisonR || 0);
        traitSchemaResist.magicR += Number(sys.magicR || 0);
        traitSchemaResist.natToughnessR += Number(sys.natToughnessR || 0);
        traitSchemaResist.silverR += Number(sys.silverR || 0);
        traitSchemaResist.sunlightR += Number(sys.sunlightR || 0);
      }

      // swim / fly / flags
      stats.swimBonus += Number(sys.swimBonus || 0);
      stats.flyBonus += Number(sys.flyBonus || 0);
      if (sys.doubleSwimSpeed) stats.doubleSwimSpeed = true;
      if (sys.addHalfSpeed) stats.addHalfSpeed = true;
      if (sys.halfSpeed) stats.halfSpeed = true;

      // skill modifiers
      if (Array.isArray(sys.skillArray)) {
        for (let entry of sys.skillArray) {
          const name = entry && entry.name;
          const value = Number(entry && entry.value || 0);
          if (!name) continue;
          stats.skillModifiers[name] = (stats.skillModifiers[name] || 0) + value;
        }
      }
    }

    if (item.type === 'trait' || item.type === 'talent') stats.traitsAndTalents.push(item);
    if (sys.shiftFormStyle) {
      stats.shiftForms.push(sys.shiftFormStyle);
      const style = String(sys.shiftFormStyle);
      if (style === "shiftFormVampireLord") stats.forms.vampireLord = true;
      if (style === "shiftFormWereWolf" || style === "shiftFormWereLion") stats.forms.wereWolf = true;
      if (style === "shiftFormWereBat") stats.forms.wereBat = true;
      if (style === "shiftFormWereBoar") stats.forms.wereBoar = true;
      if (style === "shiftFormWereBear") stats.forms.wereBear = true;
      if (style === "shiftFormWereCrocodile") stats.forms.wereCrocodile = true;
      if (style === "shiftFormWereVulture") stats.forms.wereVulture = true;
    }

    if (sys.mechanical === true) stats.actorFlags.isMechanical = true;
    if (sys.shiftForm === true && sys.dailyUse === true) stats.actorFlags.dwemerSphere = true;
    if (sys.painIntolerant === true) stats.actorFlags.painIntolerant = true;

    // Track heaviest effective equipped non-shield armor in the same pass.
    if (item?.type === "armor" && isEquipped) {
      const isShield = isShieldItem(item, { allowLegacy: true });
      if (!isShield) {
        const baseWC = normWeightClass(
          sys.weightClass ??
          sys.effectiveWeightClass ??
          sys.armorWeightClass ??
          sys.armor_class ??
          sys.armorClass
        ) || "none";
        const q = norm(sys.qualityLevel) || "common";
        let idx = mobilityOrder.indexOf(baseWC);
        if (idx < 0) idx = 0;
        if (q === "inferior") idx = clampMobilityIndex(idx + 1);
        else if (q === "superior") idx = clampMobilityIndex(idx - 1);

        if (idx > mobilityMaxIdx) {
          mobilityMaxIdx = idx;
          mobilitySources = [item];
        } else if (idx === mobilityMaxIdx && idx > 0) {
          mobilitySources.push(item);
        }
      }
    }
  }

  if (mobilityMaxIdx === 0) {
    const actorWC = normWeightClass(actorData?.system?.armor_class);
    const actorIdx = mobilityOrder.indexOf(actorWC);
    if (actorIdx > 0) mobilityMaxIdx = actorIdx;
  }

  const effectiveWeightClass = mobilityOrder[mobilityMaxIdx] ?? "none";
  const mobility = {
    armorWeightClass: effectiveWeightClass,
    agilityTestPenalty: 0,
    agilityPenaltyExemptSkills: ["combatstyle", "combat_style", "combat style"],
    skillTestPenalties: {},
    allTestPenalty: 0,
    speedPenalty: 0,
    sources: mobilitySources.map(s => ({ id: s._id, name: s.name })),
  };
  switch (effectiveWeightClass) {
    case "light":
      mobility.skillTestPenalties["acrobatics"] = -10;
      break;
    case "medium":
      mobility.agilityTestPenalty = -10;
      mobility.speedPenalty = -1;
      break;
    case "heavy":
      mobility.agilityTestPenalty = -20;
      mobility.speedPenalty = -2;
      break;
    case "superheavy":
      mobility.agilityTestPenalty = -30;
      mobility.speedPenalty = -3;
      break;
    case "crippling":
      mobility.allTestPenalty = -40;
      break;
    default:
      break;
  }
  stats.mobility = mobility;

  const traitDamage = collectTraitDamageModifiers(items);
  stats.traitDamage = traitDamage;

  // Merge trait-key-derived resistance values (highest-wins) into the resistance totals.
  // Subtract the overlap from trait-item schema fields first to prevent double-counting
  // when a trait has both schema XR fields and traitKey/traitValue populated.
  for (const [typeKey, value] of Object.entries(traitDamage.resistance ?? {})) {
    const resKey = getResistanceKeyForTraitType(typeKey);
    if (!resKey || !Number.isFinite(value) || !value) continue;
    if (Object.prototype.hasOwnProperty.call(stats.resist, resKey)) {
      const overlap = Number(traitSchemaResist[resKey] ?? 0);
      stats.resist[resKey] = Number(stats.resist[resKey] ?? 0) - overlap + Number(value);
    }
  }

  // Same de-duplication for weakness values (applied as negative resistance).
  for (const [typeKey, value] of Object.entries(traitDamage.weakness ?? {})) {
    const resKey = getResistanceKeyForTraitType(typeKey);
    if (!resKey || !Number.isFinite(value) || !value) continue;
    if (Object.prototype.hasOwnProperty.call(stats.resist, resKey)) {
      const overlap = Number(traitSchemaResist[resKey] ?? 0);
      stats.resist[resKey] = Number(stats.resist[resKey] ?? 0) - overlap - Number(value);
    }
  }

  // RAW Chapter 1: every 10 zero-ENC items contribute 1 ENC to totalEnc
  if (stats.zeroEncItemCount >= 10) {
    stats.totalEnc += Math.floor(stats.zeroEncItemCount / 10);
  }

  return setCachedItemAggregation(actor, stats, combatState);
}

/**
 * Build a canonical ENC contribution breakdown for actor-owned items.
 * Uses the same ENC math as aggregateItemStats() without mutating documents.
 *
 * @param {Actor} actor
 * @returns {{rows: Array<object>, totals: object}}
 */
export function buildEncumbranceBreakdown(actor) {
  const trackedTypes = new Set(["armor", "shield", "ammunition", "weapon", "equipment", "container", "scroll"]);
  const rows = [];
  const totals = {
    totalEnc: 0,
    armorEncRaw: 0,
    excludedEnc: 0,
    zeroEncItemCount: 0,
    zeroEncEffectiveEnc: 0,
  };

  const items = Array.from(actor?.items?.contents ?? []);
  for (const item of items) {
    const sys = item?.system ?? {};
    const itemType = String(item?.type ?? "").trim();
    if (!trackedTypes.has(itemType)) continue;

    const enc = Number(sys.enc || 0);
    const qty = Number(sys.quantity || 0);
    const itemWeight = enc * qty;
    const isEquipped = Object.prototype.hasOwnProperty.call(sys, "equipped") ? sys.equipped : true;

    const isShield = isShieldItem(item, { allowLegacy: true });
    const isWornArmor = (itemType === "armor" && isEquipped && !isShield);
    const isContained = (sys?.containerStats?.contained === true);
    let contributedEnc = itemWeight;
    if (isContained) contributedEnc = contributedEnc / 2;
    if (isWornArmor) contributedEnc = contributedEnc / 2;

    if (enc === 0 && qty > 0) totals.zeroEncItemCount += qty;
    totals.totalEnc += contributedEnc;
    if (isWornArmor) totals.armorEncRaw += itemWeight;

    rows.push({
      itemId: item?._id ?? item?.id ?? "",
      name: item?.name ?? "",
      type: itemType ?? "",
      qty,
      enc,
      contributedEnc,
      isContained,
      isWornArmor,
      isShield,
    });
  }

  totals.zeroEncEffectiveEnc = totals.zeroEncItemCount >= 10 ? Math.floor(totals.zeroEncItemCount / 10) : 0;
  totals.totalEnc += totals.zeroEncEffectiveEnc;

  return { rows, totals };
}
