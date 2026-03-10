/**
 * UESRPG 3ev4 system constants (items-focused).
 * Keep this file free of Foundry runtime dependencies so it can be imported safely anywhere.
 *
 * NOTE: English display labels for the option catalogs below live in
 * src/core/config/label-catalog.js. This file stores only stable internal keys.
 * Presentation-layer code (prepare.js, display utils) resolves labels at render time.
 */

export { SYSTEM_ID, FLAG_SCOPE } from "./system/namespace.js";
import { SYSTEM_ID } from "./system/namespace.js";
import { SPELL_RANK_LABELS } from "./config/label-catalog.js";

/**
 * Root path for this system's static assets and templates.
 * Some modules import this by name (e.g. startup.js), so it must remain a named export.
 */
export const systemRootPath = `systems/${SYSTEM_ID}`;


// Central roll formula used by all tests (PC and NPC).
export const SYSTEM_ROLL_FORMULA = "1d100";
/** Central constants object (extend as needed). */
export const UESRPG = {
  // Weapon quality levels (Chapter 7 scaffold)
  // Stable key ordering; labels resolved via WEAPON_QUALITY_LABELS in label-catalog.js.
  WEAPON_QUALITY_LEVELS: Object.freeze(["inferior", "common", "superior"]),

  // Weapon materials (Chapter 7)
  // NOTE: These are keys used in dropdowns. The derived rules below (WEAPON_MATERIAL_RULES*)
  // implement the RAW modifiers. Labels resolved via WEAPON_MATERIAL_LABELS in label-catalog.js.
  WEAPON_MATERIALS: Object.freeze([
    // Legacy/compat
    "standard", "chitin", "iron", "silver", "steel", "dwemer", "moonstone",
    "orichalcum", "adamantium", "malachite", "stalhrim", "daedric", "ebony", "dragonbone",
    // Ranged-only
    "bonemold",
    // Sling-only
    "cloth", "hemp", "leatherStraps", "netchLeatherStraps", "silk", "dreughHide",
    // Special melee-only
    "wood", "bone"
  ]),

  // Labels resolved via ARMOR_WEIGHT_CLASS_LABELS in label-catalog.js.
  ARMOR_WEIGHT_CLASSES: Object.freeze(["none", "light", "medium", "heavy", "superheavy", "crippling"]),

  // Labels resolved via AMMO_ARROW_TYPE_LABELS in label-catalog.js.
  AMMO_ARROW_TYPES: Object.freeze(["none", "slashing", "splitting"]),

  // Labels resolved via AMMO_MATERIAL_LABELS in label-catalog.js.
  AMMO_MATERIALS: Object.freeze([
    "standard", "chitin", "iron", "silver", "steel", "dwemer", "moonstone",
    "orichalcum", "adamantium", "malachite", "stalhrim", "daedric", "ebony", "dragonbone"
  ]),

  // --- RAW rule tables (Chapter 7) ---
  // Values here are used for derived, non-persisted "effective" stats.
  WEAPON_QUALITY_RULES: {
    inferior: { priceMult: 0.5, autoQualities: [{ key: "primitive" }] },
    common: { priceMult: 1.0, autoQualities: [] },
    superior: { priceMult: 3.0, autoQualities: [{ key: "proven" }] }
  },

  // Melee weapon material rules
  WEAPON_MATERIAL_RULES_MELEE: {
    // Legacy/compat: treat "standard" as iron for now.
    standard: { damageMod: 0, encDelta: 0, enchantLevel: 200, priceMult: 0.8, autoQualities: [] },
    chitin: { damageMod: 0, encDelta: 0, enchantLevel: 100, priceMult: 0.8, autoQualities: [] },
    iron: { damageMod: 0, encDelta: 0, enchantLevel: 200, priceMult: 0.8, autoQualities: [] },
    silver: { damageMod: 1, encDelta: 0, enchantLevel: 550, priceMult: 1.3, autoQualities: [{ key: "silver" }] },
    steel: { damageMod: 1, encDelta: 0, enchantLevel: 300, priceMult: 1.0, autoQualities: [] },
    dwemer: { damageMod: 2, encDelta: 0, enchantLevel: 400, priceMult: 6.0, autoQualities: [{ key: "magic" }] },
    moonstone: { damageMod: 2, encDelta: 0, enchantLevel: 500, priceMult: 5.0, autoQualities: [{ key: "magic" }] },
    orichalcum: { damageMod: 2, encDelta: 0, enchantLevel: 400, priceMult: 4.0, autoQualities: [] },
    adamantium: { damageMod: 3, encDelta: 0, enchantLevel: 1000, priceMult: 8.0, autoQualities: [] },
    malachite: { damageMod: 3, encDelta: 0, enchantLevel: 200, priceMult: 7.0, autoQualities: [{ key: "magic" }] },
    stalhrim: { damageMod: 3, encDelta: 0, enchantLevel: 1000, priceMult: 12.0, autoQualities: [{ key: "magic" }] },
    daedric: { damageMod: 4, encDelta: 1, enchantLevel: 1500, priceMult: 15.0, autoQualities: [{ key: "magic" }] },
    ebony: { damageMod: 4, encDelta: 1, enchantLevel: 1250, priceMult: 10.0, autoQualities: [{ key: "magic" }] },
    dragonbone: { damageMod: 5, encDelta: 1, enchantLevel: 1500, priceMult: 30.0, autoQualities: [{ key: "magic" }] },
    // Special melee materials
    wood: { damageMod: 0, encDelta: 0, enchantLevel: 100, priceMult: 0.5, autoQualities: [{ key: "specialDamageRule", value: "wood" }] },
    bone: { damageMod: 0, encDelta: 0, enchantLevel: 0, priceMult: 0.5, autoQualities: [{ key: "specialDamageRule", value: "bone" }] }
  },

  // Ranged weapon material rules
  WEAPON_MATERIAL_RULES_RANGED: {
    wood: { rangeMod: 0, encDelta: 0, enchantLevel: 100, priceMult: 1.0, autoQualities: [] },
    bonemold: { rangeMod: 5, encDelta: 0, enchantLevel: 300, priceMult: 1.5, autoQualities: [] },
    chitin: { rangeMod: 5, encDelta: 0, enchantLevel: 200, priceMult: 1.25, autoQualities: [] },
    dwemer: { rangeMod: 5, encDelta: 0, enchantLevel: 800, priceMult: 6.0, autoQualities: [] },
    orichalcum: { rangeMod: 5, encDelta: 0, enchantLevel: 400, priceMult: 4.0, autoQualities: [] },
    moonstone: { rangeMod: 10, encDelta: 0, enchantLevel: 500, priceMult: 5.0, autoQualities: [] },
    daedric: { rangeMod: 15, encDelta: 1, enchantLevel: 1500, priceMult: 15.0, autoQualities: [] },
    ebony: { rangeMod: 15, encDelta: 1, enchantLevel: 1250, priceMult: 10.0, autoQualities: [] },
    malachite: { rangeMod: 15, encDelta: 0, enchantLevel: 200, priceMult: 7.0, autoQualities: [] },
    dragonbone: { rangeMod: 20, encDelta: 1, enchantLevel: 1500, priceMult: 30.0, autoQualities: [] }
  },

  // Sling materials
  WEAPON_MATERIAL_RULES_SLING: {
    cloth: { damageMod: 0, enchantLevel: 50, priceMult: 1.0 },
    hemp: { damageMod: 1, enchantLevel: 100, priceMult: 2.0 },
    leatherStraps: { damageMod: 2, enchantLevel: 150, priceMult: 3.0 },
    netchLeatherStraps: { damageMod: 3, enchantLevel: 200, priceMult: 5.0 },
    silk: { damageMod: 4, enchantLevel: 250, priceMult: 10.0 },
    dreughHide: { damageMod: 5, enchantLevel: 300, priceMult: 15.0 }
  },

  // Ammunition material rules (priced per 10 shots)
  AMMO_MATERIAL_RULES: {
    // Legacy/compat: treat "standard" as iron/chitin.
    standard: { damageMod: 0, enchantLevel: 200, pricePer10: 16, autoQualities: [] },
    chitin: { damageMod: 0, enchantLevel: 200, pricePer10: 16, autoQualities: [] },
    iron: { damageMod: 0, enchantLevel: 200, pricePer10: 16, autoQualities: [] },
    silver: { damageMod: 1, enchantLevel: 550, pricePer10: 26, autoQualities: [{ key: "silver" }] },
    steel: { damageMod: 1, enchantLevel: 300, pricePer10: 20, autoQualities: [] },
    dwemer: { damageMod: 2, enchantLevel: 400, pricePer10: 120, autoQualities: [{ key: "magic" }] },
    moonstone: { damageMod: 2, enchantLevel: 500, pricePer10: 100, autoQualities: [{ key: "magic" }] },
    orichalcum: { damageMod: 2, enchantLevel: 400, pricePer10: 80, autoQualities: [] },
    adamantium: { damageMod: 3, enchantLevel: 1000, pricePer10: 160, autoQualities: [] },
    malachite: { damageMod: 3, enchantLevel: 200, pricePer10: 140, autoQualities: [{ key: "magic" }] },
    stalhrim: { damageMod: 3, enchantLevel: 1000, pricePer10: 240, autoQualities: [{ key: "magic" }] },
    daedric: { damageMod: 4, enchantLevel: 1500, pricePer10: 300, autoQualities: [{ key: "magic" }] },
    ebony: { damageMod: 4, enchantLevel: 1250, pricePer10: 200, autoQualities: [{ key: "magic" }] },
    dragonbone: { damageMod: 5, enchantLevel: 1500, pricePer10: 600, autoQualities: [{ key: "magic" }] }
  },

  // Armor/Shield quality (Chapter 7)
  ARMOR_QUALITY_RULES: {
    // Inferior: increases weight class by one step; -25% price.
    inferior: { priceMult: 0.75, weightClassDelta: +1 },
    // Common: no profile change.
    common: { priceMult: 1.0, weightClassDelta: 0 },
    // Superior: decreases weight class by one step; +100% price.
    superior: { priceMult: 2.0, weightClassDelta: -1 }
  },

  // Labels resolved via ARMOR_CLASS_LABELS in label-catalog.js.
  ARMOR_CLASSES: Object.freeze(["partial", "full"]),

  // Labels resolved via SHIELD_TYPE_LABELS in label-catalog.js.
  SHIELD_TYPES: Object.freeze(["normal", "tower", "targe", "buckler"]),

  // Armor materials (worn armor profiles) (Chapter 7)
  // Labels resolved via ARMOR_MATERIAL_LABELS in label-catalog.js.
  ARMOR_MATERIALS: Object.freeze([
    "padded", "hide", "chitin", "leather", "netchLeather", "fur", "bone", "bonemold",
    "iron", "moonstone", "dreughHide", "steel", "mithril", "dwemer", "orichalcum",
    "adamantium", "malachite", "dragonscale", "ebony", "stalhrim", "daedric", "dragonbone"
  ]),

  // Derived profiles for worn armor. Values are *base* and are further modified by quality.
  // magicARType is "magic" by default, but some entries are elemental ("fire"/"frost"/"shock").
  ARMOR_PROFILES: {
    partial: {
      chitin: { ar: 1, magicAR: 1, magicARType: "fire", weightClass: "none", enc: 1, enchantLevel: 200, priceLimb: 30, priceBody: 60 },
      leather: { ar: 1, magicAR: 1, magicARType: "fire", weightClass: "light", enc: 2, enchantLevel: 150, priceLimb: 25, priceBody: 50 },
      fur: { ar: 1, magicAR: 1, magicARType: "frost", weightClass: "light", enc: 2, enchantLevel: 100, priceLimb: 20, priceBody: 40 },
      netchLeather: { ar: 1, magicAR: 1, magicARType: "shock", weightClass: "light", enc: 2, enchantLevel: 200, priceLimb: 30, priceBody: 60 },
      bone: { ar: 2, magicAR: 0, magicARType: null, weightClass: "medium", enc: 3, enchantLevel: 100, priceLimb: 25, priceBody: 50 },
      bonemold: { ar: 2, magicAR: 0, magicARType: null, weightClass: "light", enc: 2, enchantLevel: 300, priceLimb: 50, priceBody: 100 },
      iron: { ar: 3, magicAR: 0, magicARType: null, weightClass: "medium", enc: 3, enchantLevel: 200, priceLimb: 50, priceBody: 100 },
      moonstone: { ar: 3, magicAR: 1, magicARType: "magic", weightClass: "light", enc: 2, enchantLevel: 500, priceLimb: 90, priceBody: 180 },
      dreughHide: { ar: 4, magicAR: 1, magicARType: "magic", weightClass: "medium", enc: 3, enchantLevel: 300, priceLimb: 100, priceBody: 200 },
      steel: { ar: 4, magicAR: 0, magicARType: null, weightClass: "medium", enc: 3, enchantLevel: 300, priceLimb: 75, priceBody: 150 },
      mithril: { ar: 4, magicAR: 1, magicARType: "magic", weightClass: "none", enc: 1, enchantLevel: 900, priceLimb: 300, priceBody: 600 },
      dwemer: { ar: 5, magicAR: 1, magicARType: "magic", weightClass: "medium", enc: 4, enchantLevel: 400, priceLimb: 150, priceBody: 300 },
      orichalcum: { ar: 5, magicAR: 0, magicARType: null, weightClass: "medium", enc: 4, enchantLevel: 400, priceLimb: 100, priceBody: 200 },
      adamantium: { ar: 5, magicAR: 2, magicARType: "magic", weightClass: "medium", enc: 4, enchantLevel: 1000, priceLimb: 500, priceBody: 1000 },
      dragonscale: { ar: 5, magicAR: 2, magicARType: "magic", weightClass: "light", enc: 2, enchantLevel: 1250, priceLimb: 2500, priceBody: 5000 },
      malachite: { ar: 5, magicAR: 2, magicARType: "magic", weightClass: "none", enc: 1, enchantLevel: 200, priceLimb: 750, priceBody: 1500 },
      ebony: { ar: 6, magicAR: 3, magicARType: "magic", weightClass: "heavy", enc: 5, enchantLevel: 1250, priceLimb: 1500, priceBody: 3000 },
      stalhrim: { ar: 6, magicAR: 6, magicARType: "frost", weightClass: "medium", enc: 4, enchantLevel: 1000, priceLimb: 2000, priceBody: 4000 },
      daedric: { ar: 6, magicAR: 6, magicARType: "magic", weightClass: "heavy", enc: 5, enchantLevel: 1500, priceLimb: 3000, priceBody: 6000 },
      dragonbone: { ar: 7, magicAR: 7, magicARType: "magic", weightClass: "heavy", enc: 5, enchantLevel: 1500, priceLimb: 5000, priceBody: 10000 }
    },
    full: {
      padded: { ar: 2, magicAR: 0, magicARType: null, weightClass: "medium", enc: 3, enchantLevel: 50, priceLimb: 20, priceBody: 40 },
      hide: { ar: 2, magicAR: 2, magicARType: "frost", weightClass: "medium", enc: 3, enchantLevel: 50, priceLimb: 30, priceBody: 60 },
      chitin: { ar: 3, magicAR: 1, magicARType: "fire", weightClass: "light", enc: 2, enchantLevel: 200, priceLimb: 60, priceBody: 120 },
      leather: { ar: 3, magicAR: 1, magicARType: "fire", weightClass: "medium", enc: 3, enchantLevel: 150, priceLimb: 50, priceBody: 100 },
      netchLeather: { ar: 3, magicAR: 1, magicARType: "shock", weightClass: "medium", enc: 3, enchantLevel: 200, priceLimb: 60, priceBody: 120 },
      fur: { ar: 3, magicAR: 1, magicARType: "frost", weightClass: "medium", enc: 3, enchantLevel: 100, priceLimb: 40, priceBody: 80 },
      bone: { ar: 4, magicAR: 0, magicARType: null, weightClass: "heavy", enc: 4, enchantLevel: 100, priceLimb: 50, priceBody: 100 },
      bonemold: { ar: 4, magicAR: 0, magicARType: null, weightClass: "medium", enc: 3, enchantLevel: 300, priceLimb: 100, priceBody: 200 },
      iron: { ar: 5, magicAR: 0, magicARType: null, weightClass: "heavy", enc: 4, enchantLevel: 200, priceLimb: 100, priceBody: 200 },
      moonstone: { ar: 5, magicAR: 2, magicARType: "magic", weightClass: "medium", enc: 3, enchantLevel: 500, priceLimb: 180, priceBody: 360 },
      dreughHide: { ar: 6, magicAR: 2, magicARType: "magic", weightClass: "heavy", enc: 4, enchantLevel: 300, priceLimb: 200, priceBody: 400 },
      steel: { ar: 6, magicAR: 0, magicARType: null, weightClass: "heavy", enc: 4, enchantLevel: 300, priceLimb: 150, priceBody: 300 },
      mithril: { ar: 6, magicAR: 2, magicARType: "magic", weightClass: "light", enc: 2, enchantLevel: 900, priceLimb: 600, priceBody: 1200 },
      dwemer: { ar: 7, magicAR: 2, magicARType: "magic", weightClass: "heavy", enc: 5, enchantLevel: 400, priceLimb: 300, priceBody: 600 },
      orichalcum: { ar: 7, magicAR: 0, magicARType: null, weightClass: "heavy", enc: 5, enchantLevel: 400, priceLimb: 200, priceBody: 400 },
      adamantium: { ar: 7, magicAR: 3, magicARType: "magic", weightClass: "heavy", enc: 5, enchantLevel: 1000, priceLimb: 1000, priceBody: 2000 },
      malachite: { ar: 7, magicAR: 3, magicARType: "magic", weightClass: "light", enc: 2, enchantLevel: 200, priceLimb: 1500, priceBody: 3000 },
      dragonscale: { ar: 7, magicAR: 5, magicARType: "magic", weightClass: "medium", enc: 3, enchantLevel: 1250, priceLimb: 5000, priceBody: 10000 },
      ebony: { ar: 8, magicAR: 4, magicARType: "magic", weightClass: "superheavy", enc: 6, enchantLevel: 1250, priceLimb: 3000, priceBody: 6000 },
      stalhrim: { ar: 8, magicAR: 8, magicARType: "frost", weightClass: "heavy", enc: 5, enchantLevel: 1000, priceLimb: 4000, priceBody: 8000 },
      daedric: { ar: 8, magicAR: 8, magicARType: "magic", weightClass: "superheavy", enc: 6, enchantLevel: 1500, priceLimb: 6000, priceBody: 12000 },
      dragonbone: { ar: 9, magicAR: 9, magicARType: "magic", weightClass: "superheavy", enc: 6, enchantLevel: 1500, priceLimb: 10000, priceBody: 20000 }
    }
  },

  // Shields (Chapter 7)
  SHIELD_PROFILES: {
    hide: { br: 6, magicBRHalf: 3, magicBRSpecial: { type: "frost", value: 4 }, weightClass: "light", enc: 2, enchantLevel: 50, price: 40 },
    chitin: { br: 7, magicBRHalf: 4, magicBRSpecial: { type: "fire", value: 5 }, weightClass: "none", enc: 1, enchantLevel: 200, price: 70 },
    leather: { br: 7, magicBRHalf: 4, magicBRSpecial: { type: "fire", value: 5 }, weightClass: "light", enc: 2, enchantLevel: 150, price: 60 },
    fur: { br: 7, magicBRHalf: 4, magicBRSpecial: { type: "frost", value: 5 }, weightClass: "light", enc: 2, enchantLevel: 100, price: 50 },
    netchLeather: { br: 7, magicBRHalf: 4, magicBRSpecial: { type: "shock", value: 5 }, weightClass: "light", enc: 2, enchantLevel: 200, price: 70 },
    bonemold: { br: 8, magicBRHalf: 4, magicBRSpecial: null, weightClass: "light", enc: 2, enchantLevel: 300, price: 120 },
    iron: { br: 9, magicBRHalf: 5, magicBRSpecial: null, weightClass: "medium", enc: 3, enchantLevel: 200, price: 120 },
    moonstone: { br: 9, magicBR: 6, magicBRType: "magic", weightClass: "light", enc: 2, enchantLevel: 500, price: 200 },
    dreughHide: { br: 10, magicBR: 6, magicBRType: "magic", weightClass: "medium", enc: 3, enchantLevel: 300, price: 220 },
    steel: { br: 10, magicBRHalf: 5, magicBRSpecial: null, weightClass: "medium", enc: 3, enchantLevel: 300, price: 170 },
    dwemer: { br: 10, magicBR: 6, magicBRType: "magic", weightClass: "medium", enc: 3, enchantLevel: 800, price: 330 },
    mithril: { br: 10, magicBR: 6, magicBRType: "magic", weightClass: "none", enc: 1, enchantLevel: 900, price: 650 },
    orichalcum: { br: 11, magicBRHalf: 6, magicBRSpecial: null, weightClass: "medium", enc: 3, enchantLevel: 400, price: 240 },
    adamantium: { br: 11, magicBR: 8, magicBRType: "magic", weightClass: "medium", enc: 3, enchantLevel: 1000, price: 1100 },
    malachite: { br: 11, magicBR: 8, magicBRType: "magic", weightClass: "none", enc: 1, enchantLevel: 200, price: 1700 },
    dragonscale: { br: 11, magicBR: 11, magicBRType: "magic", weightClass: "medium", enc: 3, enchantLevel: 1250, price: 7000 },
    ebony: { br: 12, magicBR: 9, magicBRType: "magic", weightClass: "heavy", enc: 4, enchantLevel: 1250, price: 3500 },
    daedric: { br: 12, magicBR: 12, magicBRType: "magic", weightClass: "heavy", enc: 4, enchantLevel: 1500, price: 6500 },
    stalhrim: { br: 12, magicBRHalf: 6, magicBRSpecial: { type: "frost", value: 12 }, weightClass: "medium", enc: 3, enchantLevel: 1000, price: 4500 },
    dragonbone: { br: 13, magicBR: 13, magicBRType: "magic", weightClass: "heavy", enc: 4, enchantLevel: 1500, price: 12000 }
  },

  // Shield type modifiers (Chapter 7)
  SHIELD_TYPE_RULES: {
    normal: { weightClassDelta: 0, encDelta: 0, priceMult: 1.0, brMult: 1.0, canBlock: true, blockTestBonus: 0, speedDelta: 0 },
    tower: { weightClassDelta: +1, encDelta: +1, priceMult: 1.25, brMult: 1.0, canBlock: true, blockTestBonus: 10, speedDelta: -1 },
    targe: { weightClassDelta: -1, encDelta: 0, priceMult: 0.75, brMult: 0.5, canBlock: true, blockTestBonus: 0, speedDelta: 0 },
    buckler: { weightClassDelta: -1, encDelta: -1, priceMult: 0.75, brMult: 1.0, canBlock: false, blockTestBonus: 0, speedDelta: 0 }
  },

  /**
   * Structured qualities v1
   * - key: canonical identifier stored in system.qualitiesStructured
   * - hasValue: whether this quality takes a numeric parameter (e.g., Reload (2))
   * Labels resolved via ITEM_QUALITY_LABELS in label-catalog.js at the presentation layer.
   */
  QUALITIES_CATALOG: Object.freeze([
    { key: "slashing", hasValue: false },
    { key: "splitting", hasValue: false },
    { key: "crushing", hasValue: false },
    { key: "piercing", hasValue: false },
    { key: "magic", hasValue: false },
    { key: "silver", hasValue: false },
    { key: "primitive", hasValue: false },
    { key: "proven", hasValue: false },
    { key: "reload", hasValue: true },
    { key: "damaged", hasValue: true }
  ]),

  /**
   * Structured Qualities (core grid) and extended Traits (multi-select) catalogs.
   *
   * - "Core" are rendered as the responsive checkbox/value grid (2x2 / 3x3, etc.).
   * - "Traits" are rendered as a multi-select list for the long tail of RAW tags.
   *
   * Notes:
   * - These are *additive* to existing schema. They do not remove or rename fields.
   * - Not all traits have automation yet; storing them now unblocks future roll logic.
   * - Labels are NOT stored here. Resolve via resolveQualityCatalog(entries, ITEM_QUALITY_LABELS)
   *   from label-catalog.js at the presentation layer.
   */
  QUALITIES_CORE_BY_TYPE: Object.freeze({
    weapon: Object.freeze([
      // Damage-type qualities may optionally carry an (X) value.
      { key: "slashing", hasValue: false, optionalValue: true },
      { key: "splitting", hasValue: false, optionalValue: true },
      { key: "crushing", hasValue: false, optionalValue: true },
      { key: "piercing", hasValue: false },
      { key: "magic", hasValue: false },
      { key: "silver", hasValue: false },
      { key: "primitive", hasValue: false },
      { key: "proven", hasValue: false },
      { key: "reload", hasValue: true },
      { key: "damaged", hasValue: true }
    ]),
    armor: Object.freeze([
      // Armor/Shield: do not include weapon-only damage-type toggles.
      { key: "magic", hasValue: false },
      { key: "silver", hasValue: false },
      { key: "damaged", hasValue: true }
    ]),
    ammunition: Object.freeze([
      // Ammunition can contribute damage-type and special flags.
      { key: "slashing", hasValue: false, optionalValue: true },
      { key: "splitting", hasValue: false, optionalValue: true },
      { key: "magic", hasValue: false },
      { key: "silver", hasValue: false },
      { key: "damaged", hasValue: true }
    ])
  }),

  /**
   * Extended trait tags (multi-select). These are *stored* on the item, but many
   * are not yet used by automation.
   * Labels resolved via resolveQualityCatalog(entries, ITEM_QUALITY_LABELS) in label-catalog.js.
   */
  TRAITS_BY_TYPE: Object.freeze({
    weapon: Object.freeze([
      { key: "concealable" },
      { key: "concussive" },
      { key: "complex" },
      { key: "dueling" },
      { key: "entangling" },
      { key: "exploitWeakness" },
      { key: "flail" },
      { key: "focus" },
      { key: "handToHand" },
      { key: "hooked" },
      { key: "impaling" },
      { key: "mounted" },
      { key: "shieldSplitter" },
      { key: "sling" },
      { key: "small" },
      { key: "snare" },
      { key: "thrown" },
      { key: "twoHanded" },
      { key: "unwieldy" }
    ]),
    armor: Object.freeze([
      // Armor-specific tags. Weight-class logic remains driven by weightClass/effectiveWeightClass.
      { key: "shield" },
      { key: "helmet" }
    ]),
    ammunition: Object.freeze([])
  }),

  /**
   * Aliases used by migration parsing of legacy rich-text qualities into structured form.
   * Lowercase only.
   */
  QUALITIES_ALIASES: {
    slashing: "slashing",
    splitting: "splitting",
    crushing: "crushing",
    piercing: "piercing",
    magic: "magic",
    silver: "silver",
    "silvered": "silver",
    primitive: "primitive",
    proven: "proven",
    reload: "reload",
    damaged: "damaged"
  },

  DEFAULTS: {
    weapon: {
      attackMode: "melee",
      qualityLevel: "common",
      material: "standard",
      qualitiesStructured: [],
      qualitiesTraits: []
    },
    armor: {
      qualityLevel: "common",
      material: "standard",
      weightClass: "none",
      qualitiesStructured: [],
      qualitiesTraits: []
    },
    ammunition: {
      arrowType: "none",
      ammoMaterial: "standard",
      pricePer10: 0,
      qualitiesStructured: [],
      qualitiesTraits: []
    }
  },

  /**
   * Spell rank label map by level (1-7).
   * Sourced from SPELL_RANK_LABELS in label-catalog.js — the canonical label store.
   * Kept here for convenient access via UESRPG.SPELL_RANKS[rank].
   */
  SPELL_RANKS: SPELL_RANK_LABELS,

  /**
   * Magic school categories (stable key ordering).
   * Labels resolved via SPELL_SCHOOL_LABELS in label-catalog.js.
   */
  SPELL_SCHOOLS: Object.freeze([
    "alteration", "conjuration", "destruction", "illusion",
    "mysticism", "necromancy", "restoration"
  ])
};

export default UESRPG;
