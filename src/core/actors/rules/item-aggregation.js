/**
 * src/core/actors/rules/item-aggregation.js
 *
 * Single-pass item statistics aggregation.
 * Collects ENC, characteristic bonuses, resistances, skill modifiers, etc.
 */

import { collectTraitDamageModifiers, getResistanceKeyForTraitType, getTraitNumericBonuses } from "../../traits/trait-registry.js";
import { isPassiveFeatureActive } from "../../traits/features/feature-config.js";
import { isShieldItem } from "../../items/shield-utils.js";
import { ARMOR_WEIGHT_CLASSES, buildArmorMobilityPenalties } from "./armor-mobility.js";
import { buildInventoryEncumbrance } from "../../items/inventory-encumbrance.js";
import { getCachedItemAggregation, setCachedItemAggregation } from "../derived-cache/actor-derived-cache.js";

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
  const encumbrance = buildInventoryEncumbrance(items);

  const stats = {
    charBonus: { str:0, end:0, agi:0, int:0, wp:0, prc:0, prs:0, lck:0 },
    hpBonus:0, mpBonus:0, spBonus:0, lpBonus:0, wtBonus:0, speedBonus:0, iniBonus:0,
    resist: { diseaseR:0, fireR:0, frostR:0, shockR:0, poisonR:0, magicR:0, natToughnessR:0, silverR:0, sunlightR:0 },
    swimBonus:0, flyBonus:0, doubleSwimSpeed:false, addHalfSpeed:false, halfSpeed:false,
    totalEnc: encumbrance.totals.totalEnc,
    armorEnc: encumbrance.totals.armorEncRaw, excludedEnc: 0,
    zeroEncItemCount: encumbrance.totals.zeroEncItemCount,
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
  const mobilityOrder = ARMOR_WEIGHT_CLASSES;
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
  let toughBonus = 0;
  let flyerSpeed = 0;

  for (let item of items) {
    const sys = item && item.system ? item.system : {};
    const traitBonuses = getTraitNumericBonuses(item);
    const itemType = item?.type;
    
    // EQUIPMENT STATUS DETERMINATION
    // (#7) Talents, Traits, and Powers are passive features whose activation respects
    // per-item feature configuration (combatOnly, outOfCombatAllowed).
    // Equipment items (weapons/armor/gear) respect the 'equipped' flag when present.
    const isPassiveFeature = (itemType === 'talent' || itemType === 'trait' || itemType === 'power');
    const isEquipped = isPassiveFeature
      ? isPassiveFeatureActive(item)
      : (Object.prototype.hasOwnProperty.call(sys, 'equipped') ? sys.equipped : true);
    const appliesPassiveItemStats = isEquipped;

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
      stats.mpBonus += Number(traitBonuses.mpBonus ?? sys.mpBonus ?? 0);
      stats.spBonus += Number(sys.spBonus || 0);
      stats.lpBonus += Number(sys.lpBonus || 0);
      if (traitBonuses.wtBonus !== undefined) toughBonus = Math.max(toughBonus, traitBonuses.wtBonus);
      else stats.wtBonus += Number(sys.wtBonus || 0);
      stats.speedBonus += Number(sys.speedBonus || 0);
      stats.iniBonus += Number(sys.iniBonus || 0);

      stats.resist.diseaseR += Number(sys.diseaseR || 0);
      stats.resist.fireR += Number(sys.fireR || 0);
      stats.resist.frostR += Number(sys.frostR || 0);
      stats.resist.shockR += Number(sys.shockR || 0);
      stats.resist.poisonR += Number(sys.poisonR || 0);
      stats.resist.magicR += Number(sys.magicR || 0);
      // Chapter 4 X-traits: highest value wins when duplicated.
      stats.resist.natToughnessR = Math.max(stats.resist.natToughnessR, Number(traitBonuses.natToughnessR ?? sys.natToughnessR ?? 0));
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
      if (traitBonuses.flyBonus !== undefined) flyerSpeed = Math.max(flyerSpeed, traitBonuses.flyBonus);
      else stats.flyBonus += Number(sys.flyBonus || 0);
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

    if (!isPassiveFeature || appliesPassiveItemStats) {
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
    }

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
  stats.mobility = buildArmorMobilityPenalties(effectiveWeightClass, mobilitySources.map(s => ({ id: s._id ?? s.id, name: s.name })));

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

  stats.wtBonus += toughBonus;
  stats.flyBonus = Math.max(stats.flyBonus, flyerSpeed);
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
  return buildInventoryEncumbrance(actor?.items ?? []);
}
