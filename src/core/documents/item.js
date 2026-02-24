/**
 * Extend the base Item entity with system-specific functionality.
 * @extends {Item}
 */
import { skillHelper } from "../../utils/skillCalcHelper.js";
import { skillModHelper } from "../../utils/skillCalcHelper.js";
import { UESRPG } from "../constants.js";
import { requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";

/**
 * Add a flat bonus to a dice string.
 * - Accepts numeric values or strings (e.g. "1d8", "1d10+2").
 * - Returns a string suitable for Foundry dice rolling.
 */
function normalizeDiceExpression(expr) {
  const raw = String(expr ?? "").trim();
  if (!raw) return "0";

  if (/uses\s+nat\.?\s*weapon/i.test(raw)) return "0";

  const paren = raw.match(/^(.+?)\s*\((.+?)\)\s*$/);
  const base = paren ? String(paren[1]).trim() : raw;

  const ascii = base.replace(/[\u2012\u2013\u2014\u2212]/g, "-");

  let cleaned = ascii.replace(/[^0-9dDkKfFhHlL+\-*/().,\s@]/g, " ").trim();
  cleaned = cleaned.replace(/(\d),(\d)/g, "$1.$2");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/[+\-*/.,\s]+$/g, "").trim();
  cleaned = cleaned.replace(/^[+\-*/.,\s]+/g, "").trim();

  return cleaned || "0";
}


function addDiceBonus(dice, bonus) {
  const b = Number(bonus || 0);
  if (!b) return String(dice ?? "");
  const d = normalizeDiceExpression(dice);
  if (!d) return String(b);

  // If the value is a plain number, just add.
  if (/^-?\d+(?:\.\d+)?$/.test(d)) return String(Number(d) + b);

  // Normalize existing trailing bonus.
  const m = d.match(/^(.*?)([+-])\s*(\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const base = m[1].trim();
    const sign = m[2] === "-" ? -1 : 1;
    const existing = sign * Number(m[3]);
    const total = existing + b;
    if (total === 0) return base;
    return `${base}${total >= 0 ? "+" : ""}${total}`;
  }
  return `${d}${b >= 0 ? "+" : ""}${b}`;
}

function halveDiceExpression(dice) {
  const d = normalizeDiceExpression(dice);
  if (!d) return "0";
  if (/^-?\d+(?:\.\d+)?$/.test(d)) return String(Math.floor(Number(d) / 2));
  return `floor((${d})/2)`;
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function roundPriceUp(v) {
  return Math.max(0, Math.ceil(safeNumber(v, 0)));
}

function shouldUseBaseStats(itemData) {
  return itemData?.gmOverride?.useBaseStats === true;
}

function hasLegacyQuality(qualitiesText, needle) {
  const q = String(qualitiesText ?? "").toLowerCase();
  return q.includes(String(needle).toLowerCase());
}

/**
 * Extract and sum numeric parameters for a legacy quality from free-text qualities.
 * Example: "Damaged (1), Damaged (2)" => 3
 */
function sumLegacyQualityParam(qualitiesText, qualityName) {
  const q = String(qualitiesText ?? "");
  if (!q) return 0;
  const name = String(qualityName ?? "").trim();
  if (!name) return 0;

  const re = new RegExp(`${name}\\s*\\(\\s*(\\d+)\\s*\\)`, "gi");
  let total = 0;
  let m;
  while ((m = re.exec(q)) !== null) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

function hasLegacyQualityToken(qualitiesText, qualityName) {
  const q = String(qualitiesText ?? "").toLowerCase();
  const needle = String(qualityName ?? "").toLowerCase().trim();
  if (!q || !needle) return false;
  // Token-boundary match to avoid substring false positives.
  const re = new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`, "i");
  return re.test(q);
}

function hasStructuredQuality(qualitiesStructured, key) {
  if (!Array.isArray(qualitiesStructured)) return false;
  return qualitiesStructured.some(q => (q?.key ?? q) === key);
}

function _parseRangeTriplet(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  return { close: Number(m[1]), effective: Number(m[2]), long: Number(m[3]) };
}

export class SimpleItem extends Item {
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    switch (data.type) {
      case 'combatStyle':
      case 'skill':
      case 'magicSkill':
        this.updateSource({ 'system.rank': 'untrained' });
        break;
    }
  }

  async _onCreate(data, options, user) {
    await super._onCreate(data, options, user);
    switch (data.type) {
      case 'container':
        await this._duplicateContainedItemsOnActor(this.actor, data);
        break;
    }
  }

  prepareData() {
    super.prepareData();

    // Get the Item's data & Actor's Data
    const itemData = this.system
    const actorData = this.actor ? this.actor : {}

    // STEP 1: Pre-inject manual qualities so they're available during prepare methods.
    // This preliminary injection allows type-specific prepare methods (like _prepareWeaponItem) 
    // to access qualitiesStructuredInjected for features that depend on manual qualities (like Reload).
    if (['weapon','armor','ammunition'].includes(this.type)) {
      itemData.gmOverride = itemData.gmOverride ?? {};
      const sourceId = this?.flags?.core?.sourceId;
      const mat = String(itemData.material ?? itemData.ammoMaterial ?? "standard").toLowerCase();
      const qual = String(itemData.qualityLevel ?? "common").toLowerCase();
      const shouldDefaultBase = Boolean(sourceId) && (mat !== "standard" || qual !== "common");
      if (itemData.gmOverride.useBaseStats === undefined && shouldDefaultBase) {
        itemData.gmOverride.useBaseStats = true;
      }
      this._injectAutoQualities(itemData);
    }

    // STEP 2: Prepare data based on item type - defensive guards for hasOwnProperty
    // These methods can now use qualitiesStructuredInjected (with manual qualities).
    // They also create autoQualitiesStructured for material/quality-derived qualities.
    const hasActor = this.isEmbedded && this.actor?.system != null;
    if (hasActor && this.system && Object.prototype.hasOwnProperty.call(this.system, 'modPrice')) { this._prepareMerchantItem(actorData, itemData) }
    if (this.type === 'armor') { this._prepareArmorItem(actorData, itemData) }
    if (this.type === 'item') { this._prepareNormalItem(actorData, itemData) }
    if (this.type === 'weapon') { this._prepareWeaponItem(actorData, itemData) }
    if (this.type === 'ammunition') { this._prepareAmmunitionItem(actorData, itemData) }
    if (hasActor && this.system && Object.prototype.hasOwnProperty.call(this.system, 'skillArray') && actorData.type === 'Player Character') { this._prepareModSkillItems(actorData, itemData) }
    if (hasActor && this.system && Object.prototype.hasOwnProperty.call(this.system, 'baseCha')) { this._prepareCombatStyleData(actorData, itemData) }
    if (hasActor && this.type === 'container') { this._prepareContainerItem(actorData, itemData) }

    // STEP 3: Final injection of auto-granted qualities into the computed structured list.
    // This re-runs after prepare methods to include autoQualitiesStructured (material/quality-derived).
    // This must run for world items as well as embedded items so automation helpers can rely on it.
    if (['weapon','armor','ammunition'].includes(this.type)) {
      this._injectAutoQualities(itemData);
    }

  }

  /**
   * Build a computed structured qualities array that includes both manual qualitiesStructured
   * and autoQualitiesStructured (material/quality-derived). This is NOT persisted.
   *
   * Contract:
   * - Manual qualities take precedence over auto qualities for the same key.
   * - Output is stable and de-duplicated by key.
   * - Stored on `system.qualitiesStructuredInjected` for automation consumers.
   */
  _injectAutoQualities(itemData) {
    const manual = Array.isArray(itemData.qualitiesStructured) ? itemData.qualitiesStructured : [];
    const useBaseStats = shouldUseBaseStats(itemData);
    const autoQ = (!useBaseStats && Array.isArray(itemData.autoQualitiesStructured))
      ? itemData.autoQualitiesStructured
      : [];

    const byKey = new Map();

    // Manual first (authoritative for values)
    for (const q of manual) {
      if (!q) continue;
      const rawKey = String(q.key ?? "").trim();
      const key = rawKey.toLowerCase();
      if (!key) continue;
      const entry = { key };
      if (q.value !== undefined && q.value !== null && q.value !== "") {
        const n = Number(q.value);
        if (Number.isFinite(n)) entry.value = n;
      }
      byKey.set(key, entry);
    }

    // Auto second (only if not already present).
    // If GM Override / Use Base Stats is enabled, auto qualities are intentionally skipped
    // so manual qualities remain authoritative for automation.
    for (const q of autoQ) {
      if (!q) continue;
      const rawKey = String(q.key ?? q ?? "").trim();
      const key = rawKey.toLowerCase();
      if (!key) continue;
      if (byKey.has(key)) continue;
      const entry = { key };
      if (q.value !== undefined && q.value !== null && q.value !== "") {
        const n = Number(q.value);
        if (Number.isFinite(n)) entry.value = n;
      }
      byKey.set(key, entry);
    }

    // Legacy qualities parsing (weapons only): make sure common RAW qualities are available
    // to automation even if the item was not updated via the Structured Qualities UI.
    if (this.type === "weapon") {
      const legacyText = String(itemData.qualities ?? "");

      // Primitive / Proven (weapon quality level also auto-grants these, but legacy items may store it only as text)
      if (!byKey.has("primitive") && hasLegacyQualityToken(legacyText, "primitive")) {
        byKey.set("primitive", { key: "primitive" });
      }
      if (!byKey.has("proven") && hasLegacyQualityToken(legacyText, "proven")) {
        byKey.set("proven", { key: "proven" });
      }

      // Damaged (X) stacks; store the summed value if no structured entry exists.
      if (!byKey.has("damaged")) {
        const dv = sumLegacyQualityParam(legacyText, "Damaged");
        if (dv > 0) byKey.set("damaged", { key: "damaged", value: dv });
      }
    }
    itemData.qualitiesStructuredInjected = Array.from(byKey.values());
  }


  /**
   * Prepare Character type specific data
   */

  /**
   * Prepare data specific to armor items
   * @param {*} itemData
   * @param {*} actorData
   */

  _prepareCombatStyleData(actorData, itemData) {

    // Combat Style Skill Bonus Calculation (standard -20 untrained penalty)
    // Unknown/empty/missing rank is treated as untrained (RAW: -20 penalty).
    const RANK_BONUS = { novice: 0, apprentice: 10, journeyman: 20, adept: 30, expert: 40, master: 50 };
    const rankBonus = RANK_BONUS[itemData.rank];
    if (rankBonus !== undefined) {
      itemData.bonus = rankBonus;
    } else {
      itemData.bonus = -20 + this._untrainedException(actorData);
    }


    // Combat Style Skill Calculation
    const woundPenalty = Number(actorData.system?.woundPenalty || 0)
    const fatiguePenalty = Number(actorData.system?.fatigue?.penalty || 0)

    let itemChaBonus = skillHelper(actorData, itemData.baseCha)
    let itemSkillBonus = skillModHelper(actorData, this.name)
    let chaTotal = 0;
    // Defensive guard: verify nested characteristics structure
    if (itemData.baseCha !== undefined && itemData.baseCha !== "" && itemData.baseCha !== "none") {
      const characteristics = actorData?.system?.characteristics?.[itemData.baseCha];
      chaTotal = Number((characteristics?.total || 0) + itemData.bonus + (itemData.miscValue || 0) + itemChaBonus);
    }

    // Chapter 5: wound penalties are derived from Wound Active Effects and exposed via system.woundPenalty.
    // Do not use legacy system.wounded flags.
    itemData.value = Number(woundPenalty + fatiguePenalty + chaTotal + itemSkillBonus)

  }

  _prepareMerchantItem(actorData, itemData) {
    // Chapter 7: rounded prices are always rounded up.
    const priceMod = Number(actorData?.system?.priceMod ?? 0);
    itemData.modPrice = roundPriceUp(itemData.price + (itemData.price * (priceMod / 100)));
  }

  _prepareArmorItem(actorData, itemData) {
    // RAW: Armor has two classes (partial/full) and shields use BR; these profiles are derived
    // from the Chapter 7 tables and then modified by quality and certain traits.
    const useBaseStats = shouldUseBaseStats(itemData);
    const baseEnc = safeNumber(itemData.enc, 0);
    const basePrice = safeNumber(itemData.price, 0);

    const qualityKey = String(itemData.qualityLevel || "common").toLowerCase();
    const qRule = UESRPG.ARMOR_QUALITY_RULES?.[qualityKey] ?? UESRPG.ARMOR_QUALITY_RULES.common;
    const qualityPriceMult = safeNumber(qRule?.priceMult, 1.0);
    const weightDelta = safeNumber(qRule?.weightClassDelta, 0);

    const isShield = Boolean(itemData.isShield) || String(itemData.category || "").toLowerCase() === "shield";
    itemData.isShieldEffective = isShield;

    // Default: preserve current values when we cannot resolve a profile.
    let derivedEnc = baseEnc;
    let derivedPrice = roundPriceUp(basePrice * qualityPriceMult);
    let derivedWeightClass = itemData.weightClass ?? "none";

    // Base auto-qualities: armor quality itself does not add Magic/Silver; keep for future.
    itemData.autoQualitiesStructured = [];

    // Apply damaged (X): reduces all AR/BR by X (min 0)
    const damagedQ = (itemData.qualitiesStructured || []).find(q => q?.key === "damaged");
    const damagedValue = safeNumber(damagedQ?.value, 0);

    const stepWeightClass = (base, delta) => {
      const order = ["none", "light", "medium", "heavy", "superheavy", "crippling"];
      let i = order.indexOf(String(base || "none").toLowerCase());
      if (i === -1) i = 0;
      i = Math.max(0, Math.min(order.length - 1, i + delta));
      return order[i];
    };

    const materialKey = String(itemData.material || "").trim();

    if (useBaseStats) {
      itemData.armorEffective = safeNumber(itemData.armor, 0);
      itemData.blockRatingEffective = safeNumber(itemData.blockRating, 0);
      itemData.magic_arEffective = safeNumber(itemData.magic_ar, 0);
      itemData.magic_brEffective = safeNumber(itemData.magic_br, 0);
      itemData.special_ar_typeEffective = itemData.special_ar_type ?? "";
      itemData.encEffective = baseEnc;
      itemData.priceEffective = basePrice;
      itemData.weightClassEffective = itemData.weightClass ?? "none";
      itemData.enchant_levelEffective = safeNumber(itemData.enchant_level, 0);
      return;
    }

    if (isShield) {
      const shieldProfile = UESRPG.SHIELD_PROFILES?.[materialKey] ?? null;
      const typeKey = String(itemData.shieldType || "normal").toLowerCase();
      const typeRule = UESRPG.SHIELD_TYPE_RULES?.[typeKey] ?? UESRPG.SHIELD_TYPE_RULES.normal;
      itemData.treatAsFreeHandForSmallOrGrapple = (typeKey === "targe");

      if (shieldProfile) {
        derivedEnc = safeNumber(shieldProfile.enc, derivedEnc) + safeNumber(typeRule.encDelta, 0);
        derivedWeightClass = stepWeightClass(shieldProfile.weightClass, weightDelta + safeNumber(typeRule.weightClassDelta, 0));
        derivedPrice = roundPriceUp(safeNumber(shieldProfile.price, basePrice) * qualityPriceMult * safeNumber(typeRule.priceMult, 1.0));
        itemData.enchant_levelEffective = safeNumber(shieldProfile.enchantLevel, itemData.enchant_level);

        const brBase = safeNumber(shieldProfile.br, itemData.blockRating);
        const brMult = safeNumber(typeRule.brMult, 1.0);
        const br = (typeKey === "targe")
          ? Math.ceil(brBase * brMult)
          : Math.round(brBase * brMult);
        itemData.blockRatingEffective = Math.max(0, br - damagedValue);

        // Magic BR:
        // - Some shields have a generic magic BR equal to half the base BR (parentheses in table).
        // - Some have an explicitly listed value (e.g. Moonstone 6, Dragonscale 11).
        // - Some additionally list a special value vs an element (e.g. "4 vs frost").
        const magicBR = (shieldProfile.magicBR != null)
          ? safeNumber(shieldProfile.magicBR, 0)
          : safeNumber(shieldProfile.magicBRHalf, 0);
        itemData.magic_brEffective = Math.max(0, magicBR - damagedValue);
        itemData.magic_brSpecial = shieldProfile.magicBRSpecial ?? null;
      }
    } else {
      const armorClass = String(itemData.armorClass || "partial").toLowerCase();
      const profile = UESRPG.ARMOR_PROFILES?.[armorClass]?.[materialKey] ?? null;

      if (profile) {
        derivedEnc = safeNumber(profile.enc, derivedEnc);
        derivedWeightClass = stepWeightClass(profile.weightClass, weightDelta);
        // Base price is table-driven (per location) but we store a single number; use body price as a conservative default.
        derivedPrice = roundPriceUp(safeNumber(profile.priceBody, basePrice) * qualityPriceMult);
        itemData.enchant_levelEffective = safeNumber(profile.enchantLevel, itemData.enchant_level);

        const ar = safeNumber(profile.ar, itemData.armor);
        const magicAR = safeNumber(profile.magicAR, 0);
        itemData.armorEffective = Math.max(0, ar - damagedValue);
        itemData.magic_arEffective = Math.max(0, magicAR - damagedValue);
        itemData.special_ar_typeEffective = profile.magicARType || "";
      }
    }

    // Runed (armor/shield): +25% price (derived only).
    const hasRuned = itemData.runed === true
      || (itemData.qualitiesStructured || []).some(q => String(q?.key ?? "").toLowerCase() === "runed")
      || hasLegacyQuality(itemData.qualities, "runed");
    if (!useBaseStats && hasRuned) {
      derivedPrice = roundPriceUp(Number(derivedPrice ?? 0) * 1.25);
    }

    itemData.encEffective = derivedEnc;
    itemData.priceEffective = derivedPrice;
    itemData.weightClassEffective = derivedWeightClass;
  }

  _prepareNormalItem(actorData, itemData) {
    // Auto Assigns as a wearable item if the Equipped Toggle is on
    if (itemData.equipped) { itemData.wearable = true }
  }

  _prepareWeaponItem(actorData, itemData) {
    // 2H fallback
    itemData.weapon2H ? itemData.damage3 = itemData.damage2 : itemData.damage3 = itemData.damage

    // --- Derived (non-persisted) effective stats ---
    const useBaseStats = shouldUseBaseStats(itemData);
    const baseDamage = normalizeDiceExpression(itemData.damage);
    const baseDamage2 = normalizeDiceExpression(itemData.damage2);
    const baseEnc = safeNumber(itemData.enc, 0);
    const basePrice = safeNumber(itemData.price, 0);

    const qualityKey = String(itemData.qualityLevel || "common").toLowerCase();
    const qRule = UESRPG.WEAPON_QUALITY_RULES?.[qualityKey] ?? UESRPG.WEAPON_QUALITY_RULES.common;

    // Determine which material rule table applies.
    const matKey = String(itemData.material || "iron").toLowerCase();
    const attackMode = String(itemData.attackMode || "melee").toLowerCase();

    // RAW: thrown ranged weapons count as melee for materials.
    const isThrown = hasStructuredQuality(itemData.qualitiesStructured, "thrown") || hasLegacyQuality(itemData.qualities, "thrown");
    const useMeleeMaterial = (attackMode === "melee") || (attackMode === "ranged" && isThrown);

    const injected = itemData.qualitiesStructuredInjected ?? itemData.qualitiesStructured ?? [];
    const traits = Array.isArray(itemData.qualitiesTraits) ? itemData.qualitiesTraits : [];
    const isSling = injected.some(q => String(q?.key ?? q ?? "").toLowerCase() === "sling")
      || traits.some(t => String(t ?? "").toLowerCase() === "sling")
      || hasLegacyQuality(itemData.qualities, "sling");

    const mRule = isSling
      ? (UESRPG.WEAPON_MATERIAL_RULES_SLING?.[matKey] ?? null)
      : (useMeleeMaterial
        ? (UESRPG.WEAPON_MATERIAL_RULES_MELEE?.[matKey] ?? null)
        : (UESRPG.WEAPON_MATERIAL_RULES_RANGED?.[matKey] ?? null));

    const damageMod = safeNumber(mRule?.damageMod, 0);
    const encDelta = safeNumber(mRule?.encDelta, 0);
    const matPriceMult = safeNumber(mRule?.priceMult, 1.0);
    const qualityPriceMult = safeNumber(qRule?.priceMult, 1.0);

    // Special melee-only materials: wood/bone halve damage (with exceptions in RAW).
    // We implement a conservative derived presentation:
    // - Bone: halved damage
    // - Wood: halved damage unless the weapon is a Quarterstaff or Mace (detected by name)
    let special = null;
    if (useMeleeMaterial && mRule?.autoQualities?.some(q => q?.key === "specialDamageRule")) {
      special = mRule.autoQualities.find(q => q?.key === "specialDamageRule")?.value;
    }

    const nameLower = String(this.name ?? "").toLowerCase();
    const woodException = nameLower.includes("quarterstaff") || nameLower.includes("mace");

    const applyHalfDamage = (special === "bone") || (special === "wood" && !woodException);

    // NOTE: We avoid rewriting base fields; these are used by sheets & future automation.
    if (useBaseStats) {
      itemData.damageEffective = String(baseDamage);
      itemData.damage2Effective = String(baseDamage2);
      itemData.damage3Effective = itemData.weapon2H ? itemData.damage2Effective : itemData.damageEffective;
      itemData.encEffective = baseEnc;
      itemData.priceEffective = basePrice;
      itemData.enchant_levelEffective = safeNumber(itemData.enchant_level, 0);
    } else {
      itemData.damageEffective = applyHalfDamage ? halveDiceExpression(baseDamage) : addDiceBonus(baseDamage, damageMod);
      itemData.damage2Effective = applyHalfDamage ? halveDiceExpression(baseDamage2) : addDiceBonus(baseDamage2, damageMod);
      itemData.damage3Effective = itemData.weapon2H ? itemData.damage2Effective : itemData.damageEffective;

      itemData.encEffective = baseEnc + encDelta;
      itemData.priceEffective = roundPriceUp(basePrice * matPriceMult * qualityPriceMult);

      // Enchant level is defined by material.
      if (mRule?.enchantLevel != null) itemData.enchant_levelEffective = safeNumber(mRule.enchantLevel, 0);
    }

    // Runed (weapon): +20% price (derived only).
    const hasRuned = itemData.runed === true
      || injected.some(q => String(q?.key ?? q ?? "").toLowerCase() === "runed")
      || hasLegacyQuality(itemData.qualities, "runed");
    if (!useBaseStats && hasRuned) {
      itemData.priceEffective = roundPriceUp(Number(itemData.priceEffective ?? 0) * 1.2);
    }

    // Store auto-qualities (material + quality), without mutating the user's toggle list.
    const materialAuto = Array.isArray(mRule?.autoQualities) ? mRule.autoQualities : [];
    const qualityAuto = Array.isArray(qRule?.autoQualities) ? qRule.autoQualities : [];
    itemData.autoQualitiesStructured = [...qualityAuto, ...materialAuto]
      .filter(q => q?.key && q.key !== "specialDamageRule")
      .map(q => ({ key: q.key, value: q.value }));

    // Extract reload AP cost from qualitiesStructuredInjected
    let reloadAPCost = 0;
    let requiresReload = false;

    if (attackMode === "ranged") {
      // Stored (world/pack) base value; used when present, otherwise fall back to structured Reload quality.
      const storedRaw = Number(itemData?.reloadState?.reloadAPCost ?? 0);
      const stored = Number.isFinite(storedRaw) ? Math.max(0, Math.trunc(storedRaw)) : 0;

      const reloadQuality = injected.find(q => String(q?.key ?? "").toLowerCase() === "reload");
      const qRaw = (reloadQuality && reloadQuality.value !== undefined) ? Number(reloadQuality.value) : NaN;
      const fromQuality = Number.isFinite(qRaw) ? Math.max(0, Math.trunc(qRaw)) : 0;

      reloadAPCost = (stored > 0) ? stored : (fromQuality > 0 ? fromQuality : 0);
      requiresReload = reloadAPCost > 0;
    }

    // Store in derived state (non-persisted)
    itemData.reloadState = itemData.reloadState ?? {};
    itemData.reloadState.reloadAPCost = reloadAPCost;
    itemData.reloadState.requiresReload = requiresReload;
    // Don't override isLoaded if it's already set
    if (itemData.reloadState.isLoaded === undefined) {
      itemData.reloadState.isLoaded = true;
    }

    // Derived range bands (ranged only): apply material range modifiers when available.
    if (attackMode === "ranged") {
      const parsed = _parseRangeTriplet(itemData.range);
      if (parsed && Number.isFinite(parsed.long)) {
        const rangeMod = (!useBaseStats && mRule?.rangeMod != null) ? safeNumber(mRule.rangeMod, 0) : 0;
        const close = Math.max(0, Number(parsed.close) + rangeMod);
        const medium = Math.max(0, Number(parsed.effective) + rangeMod);
        const long = Math.max(0, Number(parsed.long) + rangeMod);

        itemData.rangeBandsDerived = {
          kind: isThrown ? "thrown" : "ranged",
          source: "rangeField",
          close: Number(parsed.close) || 0,
          medium: Number(parsed.effective) || 0,
          long: Number(parsed.long) || 0,
          rangeMod,
          display: `${close}/${medium}/${long}`
        };
        itemData.rangeBandsDerivedEffective = {
          kind: isThrown ? "thrown" : "ranged",
          source: "rangeField",
          close,
          medium,
          long,
          rangeMod,
          display: `${close}/${medium}/${long}`
        };
      }
    }
  }

  _prepareAmmunitionItem(actorData, itemData) {
    const useBaseStats = shouldUseBaseStats(itemData);
    const baseDamage = normalizeDiceExpression(itemData.damage);
    const basePricePer10 = safeNumber(itemData.pricePer10, 0);
    const matKey = String(itemData.ammoMaterial || "iron").toLowerCase();
    const mRule = UESRPG.AMMO_MATERIAL_RULES?.[matKey] ?? null;

    const damageMod = safeNumber(mRule?.damageMod, 0);

    // Derived effective values; we do not overwrite stored user inputs.
    if (useBaseStats) {
      itemData.damageEffective = String(baseDamage);
      itemData.enchant_levelEffective = safeNumber(itemData.enchant_level, 0);
      itemData.pricePer10Effective = basePricePer10;
      itemData.pricePerShotEffective = Math.round((basePricePer10 / 10) * 100) / 100;
    } else {
      itemData.damageEffective = addDiceBonus(baseDamage, damageMod);
      itemData.enchant_levelEffective = safeNumber(mRule?.enchantLevel, 0);
      itemData.pricePer10Effective = (mRule?.pricePer10 != null) ? safeNumber(mRule.pricePer10, 0) : basePricePer10;
      itemData.pricePerShotEffective = Math.round((itemData.pricePer10Effective / 10) * 100) / 100;
    }

    // Arrow type tags are deprecated; ignored.
    const materialAuto = Array.isArray(mRule?.autoQualities) ? mRule.autoQualities : [];
    itemData.autoQualitiesStructured = materialAuto
      .filter(q => q?.key)
      .map(q => ({ key: q.key, value: q.value }));
  }

  /**
   * PrepareModSkillItems - Safer, non-mutating approach
   * Previously this updated other embedded documents (updateSource) during item prepare,
   * which can cause expensive document updates during large prepares/draws. Instead:
   * - If the item is equipped, apply the modifier in-memory to actorData.system.professions
   * - Do not perform document writes here (no updateSource / updateEmbeddedDocuments)
   */
  _prepareModSkillItems(actorData, itemData) {
    if (!Array.isArray(itemData.skillArray) || itemData.skillArray.length === 0) { return }

    // If actorData is present and has professions structure, update in-memory
    const professions = actorData?.system?.professions;
    const professionsWound = actorData?.system?.professionsWound;

    for (let entry of itemData.skillArray) {
      // Avoid expensive .find() and avoid document updates
      if (!entry || !entry.name) continue;
      const value = Number(entry.value || 0);

      if (itemData.equipped && professions) {
        professions[entry.name] = Number(professions[entry.name] || 0) + value;
        if (professionsWound) {
          professionsWound[entry.name] = Number(professionsWound[entry.name] || 0) + value;
        }
      }
      // Keep a lightweight reference for UI use if needed
      // itemData._appliedSkillMods = itemData._appliedSkillMods || {};
      // itemData._appliedSkillMods[entry.name] = (itemData._appliedSkillMods[entry.name] || 0) + value;
    }
  }

_prepareContainerItem(actorData, itemData) {
  const contained = Array.isArray(itemData?.contained_items) ? itemData.contained_items : [];
  
  // Calculate total weight of contents for capacity tracking
  let currentCapacity = 0;
  for (const containedItem of contained) {
    const cItem = containedItem?.item || containedItem || {};
    const enc = Number(cItem?.system?.enc ?? 0);
    const qty = Number(cItem?.system?.quantity ?? 0);
    currentCapacity += enc * qty;
  }

  // Store only what we need:
  // - current: for capacity checking and UI display
  // - max: user-defined capacity limit
  // - item_count: calculated on-the-fly for display (not user-editable)
  itemData.container_enc = itemData.container_enc || {};
  itemData.container_enc.current = currentCapacity;
  itemData.container_enc.max = Number(itemData.container_enc.max ?? 0);
  itemData.container_enc.item_count = contained.length;
}

async _duplicateContainedItemsOnActor(actorData, itemData) {
  if (!actorData || !Array.isArray(itemData?.system?.contained_items)) return;

  const itemsToDuplicate = [];
  for (const containedItem of itemData.system.contained_items) {
    const clone = containedItem?.item ? (containedItem.item.toObject ? containedItem.item.toObject() : containedItem.item) : containedItem;
    if (!clone) continue;
    clone.system = clone.system || {};
    clone.system.containerStats = clone.system.containerStats || {};
    clone.system.containerStats.container_id = itemData._id;
    itemsToDuplicate.push(clone);
  }

  if (itemsToDuplicate.length === 0) return;

  const createdContainedItems = await requestCreateEmbeddedDocuments(actorData, "Item", itemsToDuplicate);

  // Persist the newly created item references back to the container document.
  const newContainedItems = (createdContainedItems ?? []).map(item => ({ _id: item._id, item }));
  await requestUpdateDocument(this, { 'system.contained_items': newContainedItems });
}
  _untrainedException(actorData) {
    // Defensive guard: safe property access and array filtering
    const items = actorData.items ?? [];
    const attribute = items?.filter(item => item?.system?.untrainedException === true) || [];

    // Chapter 4 (Arms Master): ignore the usual -20 untrained penalty for Combat Styles.
    // We treat possession of the Arms Master talent as an implicit untrained-exception.
    const hasArmsMaster = Array.isArray(items) && items.some((i) => {
      if (String(i?.type ?? "") !== "talent") return false;
      const slug = String(i?.system?.slug ?? i?.system?.key ?? i?.system?.id ?? "").toLowerCase();
      const name = String(i?.name ?? "").toLowerCase();
      return slug === "armsmaster" || name === "arms master";
    });

    if (this.type !== "combatStyle") return 0;
    return (attribute.length >= 1 || hasArmsMaster) ? 20 : 0;
  }

}
