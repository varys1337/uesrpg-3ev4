export const WEAPON_QUALITY_LEVELS = Object.freeze(["inferior", "common", "superior"]);

export const WEAPON_MATERIALS = Object.freeze([
  "standard", "chitin", "iron", "silver", "steel", "dwemer", "moonstone",
  "orichalcum", "adamantium", "malachite", "stalhrim", "daedric", "ebony", "dragonbone",
  "bonemold",
  "cloth", "hemp", "leatherStraps", "netchLeatherStraps", "silk", "dreughHide",
  "wood", "bone",
]);

export const ARMOR_WEIGHT_CLASSES = Object.freeze(["none", "light", "medium", "heavy", "superheavy", "crippling"]);
export const AMMO_ARROW_TYPES = Object.freeze(["none", "slashing", "splitting"]);

export const AMMO_MATERIALS = Object.freeze([
  "standard", "chitin", "iron", "silver", "steel", "dwemer", "moonstone",
  "orichalcum", "adamantium", "malachite", "stalhrim", "daedric", "ebony", "dragonbone",
]);

export const WEAPON_QUALITY_RULES = {
  inferior: { priceMult: 0.5, autoQualities: [{ key: "primitive" }] },
  common: { priceMult: 1.0, autoQualities: [] },
  superior: { priceMult: 3.0, autoQualities: [{ key: "proven" }] },
};

export const WEAPON_MATERIAL_RULES_MELEE = {
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
  wood: { damageMod: 0, encDelta: 0, enchantLevel: 100, priceMult: 0.5, autoQualities: [{ key: "specialDamageRule", value: "wood" }] },
  bone: { damageMod: 0, encDelta: 0, enchantLevel: 0, priceMult: 0.5, autoQualities: [{ key: "specialDamageRule", value: "bone" }] },
};

export const WEAPON_MATERIAL_RULES_RANGED = {
  wood: { rangeMod: 0, encDelta: 0, enchantLevel: 100, priceMult: 1.0, autoQualities: [] },
  bonemold: { rangeMod: 5, encDelta: 0, enchantLevel: 300, priceMult: 1.5, autoQualities: [] },
  chitin: { rangeMod: 5, encDelta: 0, enchantLevel: 200, priceMult: 1.25, autoQualities: [] },
  dwemer: { rangeMod: 5, encDelta: 0, enchantLevel: 800, priceMult: 6.0, autoQualities: [] },
  orichalcum: { rangeMod: 5, encDelta: 0, enchantLevel: 400, priceMult: 4.0, autoQualities: [] },
  moonstone: { rangeMod: 10, encDelta: 0, enchantLevel: 500, priceMult: 5.0, autoQualities: [] },
  daedric: { rangeMod: 15, encDelta: 1, enchantLevel: 1500, priceMult: 15.0, autoQualities: [] },
  ebony: { rangeMod: 15, encDelta: 1, enchantLevel: 1250, priceMult: 10.0, autoQualities: [] },
  malachite: { rangeMod: 15, encDelta: 0, enchantLevel: 200, priceMult: 7.0, autoQualities: [] },
  dragonbone: { rangeMod: 20, encDelta: 1, enchantLevel: 1500, priceMult: 30.0, autoQualities: [] },
};

export const WEAPON_MATERIAL_RULES_SLING = {
  cloth: { damageMod: 0, enchantLevel: 50, priceMult: 1.0 },
  hemp: { damageMod: 1, enchantLevel: 100, priceMult: 2.0 },
  leatherStraps: { damageMod: 2, enchantLevel: 150, priceMult: 3.0 },
  netchLeatherStraps: { damageMod: 3, enchantLevel: 200, priceMult: 5.0 },
  silk: { damageMod: 4, enchantLevel: 250, priceMult: 10.0 },
  dreughHide: { damageMod: 5, enchantLevel: 300, priceMult: 15.0 },
};

export const AMMO_MATERIAL_RULES = {
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
  dragonbone: { damageMod: 5, enchantLevel: 1500, pricePer10: 600, autoQualities: [{ key: "magic" }] },
};

export const ARMOR_QUALITY_RULES = {
  inferior: { priceMult: 0.75, weightClassDelta: +1 },
  common: { priceMult: 1.0, weightClassDelta: 0 },
  superior: { priceMult: 2.0, weightClassDelta: -1 },
};

export const ARMOR_CLASSES = Object.freeze(["partial", "full"]);
export const SHIELD_TYPES = Object.freeze(["normal", "tower", "targe", "buckler"]);

export const ARMOR_MATERIALS = Object.freeze([
  "padded", "hide", "chitin", "leather", "netchLeather", "fur", "bone", "bonemold",
  "iron", "moonstone", "dreughHide", "steel", "mithril", "dwemer", "orichalcum",
  "adamantium", "malachite", "dragonscale", "ebony", "stalhrim", "daedric", "dragonbone",
]);

export const ARMOR_PROFILES = {
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
    dragonbone: { ar: 7, magicAR: 7, magicARType: "magic", weightClass: "heavy", enc: 5, enchantLevel: 1500, priceLimb: 5000, priceBody: 10000 },
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
    dragonbone: { ar: 9, magicAR: 9, magicARType: "magic", weightClass: "superheavy", enc: 6, enchantLevel: 1500, priceLimb: 10000, priceBody: 20000 },
  },
};

export const SHIELD_PROFILES = {
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
  dragonbone: { br: 13, magicBR: 13, magicBRType: "magic", weightClass: "heavy", enc: 4, enchantLevel: 1500, price: 12000 },
};

export const SHIELD_TYPE_RULES = {
  normal: { weightClassDelta: 0, encDelta: 0, priceMult: 1.0, brMult: 1.0, canBlock: true, blockTestBonus: 0, speedDelta: 0 },
  tower: { weightClassDelta: +1, encDelta: +1, priceMult: 1.25, brMult: 1.0, canBlock: true, blockTestBonus: 10, speedDelta: -1 },
  targe: { weightClassDelta: -1, encDelta: 0, priceMult: 0.75, brMult: 0.5, canBlock: true, blockTestBonus: 0, speedDelta: 0 },
  buckler: { weightClassDelta: -1, encDelta: -1, priceMult: 0.75, brMult: 1.0, canBlock: false, blockTestBonus: 0, speedDelta: 0 },
};

export const DEFAULTS = {
  weapon: {
    attackMode: "melee",
    qualityLevel: "common",
    material: "standard",
    qualitiesStructured: [],
    qualitiesTraits: [],
  },
  armor: {
    qualityLevel: "common",
    material: "standard",
    weightClass: "none",
    qualitiesStructured: [],
    qualitiesTraits: [],
  },
  ammunition: {
    arrowType: "none",
    ammoMaterial: "standard",
    pricePer10: 0,
    qualitiesStructured: [],
    qualitiesTraits: [],
  },
};
