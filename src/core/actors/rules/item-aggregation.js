/**
 * src/core/actors/rules/item-aggregation.js
 *
 * Single-pass item statistics aggregation.
 * Collects ENC, characteristic bonuses, resistances, skill modifiers, etc.
 */

import { collectTraitDamageModifiers, getResistanceKeyForTraitType } from "../../traits/trait-registry.js";
import { getFeatureConfig } from "../../traits/features/feature-config.js";

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
 * @param {SimpleActor} actor
 * @param {object} actorData - Actor data (for legacy compatibility)
 * @returns {object} Aggregated stats
 */
// Fast numeric hash for cache invalidation.
function _sysHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

export function aggregateItemStats(actor, actorData) {
  // Build a signature of items to detect changes.
  // Hash each item's full system data so ANY field change invalidates the cache.
  // (#8) Include combat state so cache invalidates when combat starts/ends.
  const itemsRaw = actorData?.items;
  const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw ? Array.from(itemsRaw) : []);
  const combatState = game?.combat?.started ? "combat" : "peace";
  let sigParts = [`__combat:${combatState}`];
  for (let it of items) {
    const sys = it?.system ?? {};
    try {
      sigParts.push(`${it?._id || ''}:${_sysHash(JSON.stringify(sys))}`);
    } catch (_e) {
      // Fallback if JSON.stringify fails (circular refs, etc.)
      sigParts.push(`${it?._id || ''}:?`);
    }
  }
  const signature = sigParts.join('|');

  if (actor._aggCache && actor._aggCache.signature === signature && actor._aggCache.agg) {
    return actor._aggCache.agg;
  }

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
    itemCount: items.length
  };

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

    // RAW Chapter 1 & 7: "Total ENC = sum of ENC of ALL equipment they are carrying"
    // Special cases:
    // - "When worn, the ENC of armor is halved" (equipped armor only)
    // - "Shields do not benefit from this effect" (never halved)
    // - "Containers halve the total effective value of the ENC contained within them"
    
    const isShield = (item?.type === 'armor') && Boolean(sys?.isShieldEffective ?? sys?.isShield);
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

    // Track excluded ENC for items with excludeENC flag
    if (sys.excludeENC === true) {
      stats.excludedEnc += contributedWeight;
    }

    // Track worn armor ENC separately for display purposes
    if (isWornArmor) {
      stats.armorEnc += itemWeight; // Store original weight before halving
    }

    // Characteristic bonuses (only if equipped)
    if (isEquipped && sys.characteristicBonus) {
      stats.charBonus.str += Number(sys.characteristicBonus.strChaBonus || 0);
      stats.charBonus.end += Number(sys.characteristicBonus.endChaBonus || 0);
      stats.charBonus.agi += Number(sys.characteristicBonus.agiChaBonus || 0);
      stats.charBonus.int += Number(sys.characteristicBonus.intChaBonus || 0);
      stats.charBonus.wp += Number(sys.characteristicBonus.wpChaBonus || 0);
      stats.charBonus.prc += Number(sys.characteristicBonus.prcChaBonus || 0);
      stats.charBonus.prs += Number(sys.characteristicBonus.prsChaBonus || 0);
      stats.charBonus.lck += Number(sys.characteristicBonus.lckChaBonus || 0);
    }

    // Resource/resist bonuses (only if equipped)
    if (isEquipped) {
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
      stats.resist.natToughnessR += Number(sys.natToughnessR || 0);
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
    if (sys.shiftFormStyle) stats.shiftForms.push(sys.shiftFormStyle);
  }

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

  actor._aggCache = { signature, agg: stats };
  return stats;
}
