/**
 * src/core/config/label-catalog.js
 *
 * Centralized English-language label maps for all shared option catalogs.
 *
 * This is the ONLY place English display strings for option catalogs should live.
 * Catalogs in constants.js store stable internal keys only; labels are resolved
 * from these maps at the presentation layer (item prepare, display utils, etc.).
 *
 * Rules:
 * - All maps are frozen (immutable after definition).
 * - Keys match the canonical catalog keys in constants.js exactly.
 * - Label resolution falls back to a humanized form of the key on miss.
 * - This file has zero Foundry runtime dependencies — safe to import anywhere.
 */

// ── Weapon / armor quality levels ────────────────────────────────────────────

export const WEAPON_QUALITY_LABELS = Object.freeze({
  inferior: "UESRPG.Labels.WEAPON_QUALITY.inferior",
  common: "UESRPG.Labels.WEAPON_QUALITY.common",
  superior: "UESRPG.Labels.WEAPON_QUALITY.superior"
});

// ── Weapon materials ──────────────────────────────────────────────────────────

export const WEAPON_MATERIAL_LABELS = Object.freeze({
  // Legacy/compat
  standard: "UESRPG.Labels.WEAPON_MATERIAL.standard",
  chitin: "UESRPG.Labels.WEAPON_MATERIAL.chitin",
  iron: "UESRPG.Labels.WEAPON_MATERIAL.iron",
  silver: "UESRPG.Labels.WEAPON_MATERIAL.silver",
  steel: "UESRPG.Labels.WEAPON_MATERIAL.steel",
  dwemer: "UESRPG.Labels.WEAPON_MATERIAL.dwemer",
  moonstone: "UESRPG.Labels.WEAPON_MATERIAL.moonstone",
  orichalcum: "UESRPG.Labels.WEAPON_MATERIAL.orichalcum",
  adamantium: "UESRPG.Labels.WEAPON_MATERIAL.adamantium",
  malachite: "UESRPG.Labels.WEAPON_MATERIAL.malachite",
  stalhrim: "UESRPG.Labels.WEAPON_MATERIAL.stalhrim",
  daedric: "UESRPG.Labels.WEAPON_MATERIAL.daedric",
  ebony: "UESRPG.Labels.WEAPON_MATERIAL.ebony",
  dragonbone: "UESRPG.Labels.WEAPON_MATERIAL.dragonbone",
  // Ranged-only
  bonemold: "UESRPG.Labels.WEAPON_MATERIAL.bonemold",
  // Sling-only
  cloth: "UESRPG.Labels.WEAPON_MATERIAL.cloth",
  hemp: "UESRPG.Labels.WEAPON_MATERIAL.hemp",
  leatherStraps: "UESRPG.Labels.WEAPON_MATERIAL.leatherStraps",
  netchLeatherStraps: "UESRPG.Labels.WEAPON_MATERIAL.netchLeatherStraps",
  silk: "UESRPG.Labels.WEAPON_MATERIAL.silk",
  dreughHide: "UESRPG.Labels.WEAPON_MATERIAL.dreughHide",
  // Special melee-only
  wood: "UESRPG.Labels.WEAPON_MATERIAL.wood",
  bone: "UESRPG.Labels.WEAPON_MATERIAL.bone"
});

export const AMMO_MATERIAL_LABELS = Object.freeze({
  standard: "UESRPG.Labels.AMMO_MATERIAL.standard",
  chitin: "UESRPG.Labels.AMMO_MATERIAL.chitin",
  iron: "UESRPG.Labels.AMMO_MATERIAL.iron",
  silver: "UESRPG.Labels.AMMO_MATERIAL.silver",
  steel: "UESRPG.Labels.AMMO_MATERIAL.steel",
  dwemer: "UESRPG.Labels.AMMO_MATERIAL.dwemer",
  moonstone: "UESRPG.Labels.AMMO_MATERIAL.moonstone",
  orichalcum: "UESRPG.Labels.AMMO_MATERIAL.orichalcum",
  adamantium: "UESRPG.Labels.AMMO_MATERIAL.adamantium",
  malachite: "UESRPG.Labels.AMMO_MATERIAL.malachite",
  stalhrim: "UESRPG.Labels.AMMO_MATERIAL.stalhrim",
  daedric: "UESRPG.Labels.AMMO_MATERIAL.daedric",
  ebony: "UESRPG.Labels.AMMO_MATERIAL.ebony",
  dragonbone: "UESRPG.Labels.AMMO_MATERIAL.dragonbone"
});

// ── Ammunition arrow types ────────────────────────────────────────────────────

export const AMMO_ARROW_TYPE_LABELS = Object.freeze({
  none: "UESRPG.Labels.AMMO_ARROW_TYPE.none",
  slashing: "UESRPG.Labels.AMMO_ARROW_TYPE.slashing",
  splitting: "UESRPG.Labels.AMMO_ARROW_TYPE.splitting"
});

// ── Armor weight classes ──────────────────────────────────────────────────────

export const ARMOR_WEIGHT_CLASS_LABELS = Object.freeze({
  none: "UESRPG.Labels.ARMOR_WEIGHT_CLASS.none",
  light: "UESRPG.Labels.ARMOR_WEIGHT_CLASS.light",
  medium: "UESRPG.Labels.ARMOR_WEIGHT_CLASS.medium",
  heavy: "UESRPG.Labels.ARMOR_WEIGHT_CLASS.heavy",
  superheavy: "UESRPG.Labels.ARMOR_WEIGHT_CLASS.superheavy",
  crippling: "UESRPG.Labels.ARMOR_WEIGHT_CLASS.crippling"
});

// ── Armor class (partial/full) ────────────────────────────────────────────────

export const ARMOR_CLASS_LABELS = Object.freeze({
  partial: "UESRPG.Labels.ARMOR_CLASS.partial",
  full: "UESRPG.Labels.ARMOR_CLASS.full"
});

// ── Actor size ────────────────────────────────────────────────────────────────

export const ACTOR_SIZE_LABELS = Object.freeze({
  puny: "UESRPG.Labels.ACTOR_SIZE.puny",
  tiny: "UESRPG.Labels.ACTOR_SIZE.tiny",
  small: "UESRPG.Labels.ACTOR_SIZE.small",
  standard: "UESRPG.Labels.ACTOR_SIZE.standard",
  large: "UESRPG.Labels.ACTOR_SIZE.large",
  huge: "UESRPG.Labels.ACTOR_SIZE.huge",
  enormous: "UESRPG.Labels.ACTOR_SIZE.enormous"
});

// ── Actor armor class (none, super_light, light, medium, heavy, super_heavy) ──

export const ACTOR_ARMOR_CLASS_LABELS = Object.freeze({
  none: "UESRPG.Labels.ACTOR_ARMOR_CLASS.none",
  super_light: "UESRPG.Labels.ACTOR_ARMOR_CLASS.super_light",
  light: "UESRPG.Labels.ACTOR_ARMOR_CLASS.light",
  medium: "UESRPG.Labels.ACTOR_ARMOR_CLASS.medium",
  heavy: "UESRPG.Labels.ACTOR_ARMOR_CLASS.heavy",
  super_heavy: "UESRPG.Labels.ACTOR_ARMOR_CLASS.super_heavy"
});

// ── Supply dice (1d2, 1d4, 1d6, 1d8, 1d10) ────────────────────────────────────

export const SUPPLY_DICE_LABELS = Object.freeze({
  "1d2": "UESRPG.Labels.SUPPLY_DICE.1d2",
  "1d4": "UESRPG.Labels.SUPPLY_DICE.1d4",
  "1d6": "UESRPG.Labels.SUPPLY_DICE.1d6",
  "1d8": "UESRPG.Labels.SUPPLY_DICE.1d8",
  "1d10": "UESRPG.Labels.SUPPLY_DICE.1d10"
});

// ── Armor materials ───────────────────────────────────────────────────────────

export const ARMOR_MATERIAL_LABELS = Object.freeze({
  padded: "UESRPG.Labels.ARMOR_MATERIAL.padded",
  hide: "UESRPG.Labels.ARMOR_MATERIAL.hide",
  chitin: "UESRPG.Labels.ARMOR_MATERIAL.chitin",
  leather: "UESRPG.Labels.ARMOR_MATERIAL.leather",
  netchLeather: "UESRPG.Labels.ARMOR_MATERIAL.netchLeather",
  fur: "UESRPG.Labels.ARMOR_MATERIAL.fur",
  bone: "UESRPG.Labels.ARMOR_MATERIAL.bone",
  bonemold: "UESRPG.Labels.ARMOR_MATERIAL.bonemold",
  iron: "UESRPG.Labels.ARMOR_MATERIAL.iron",
  moonstone: "UESRPG.Labels.ARMOR_MATERIAL.moonstone",
  dreughHide: "UESRPG.Labels.ARMOR_MATERIAL.dreughHide",
  steel: "UESRPG.Labels.ARMOR_MATERIAL.steel",
  mithril: "UESRPG.Labels.ARMOR_MATERIAL.mithril",
  dwemer: "UESRPG.Labels.ARMOR_MATERIAL.dwemer",
  orichalcum: "UESRPG.Labels.ARMOR_MATERIAL.orichalcum",
  adamantium: "UESRPG.Labels.ARMOR_MATERIAL.adamantium",
  malachite: "UESRPG.Labels.ARMOR_MATERIAL.malachite",
  dragonscale: "UESRPG.Labels.ARMOR_MATERIAL.dragonscale",
  ebony: "UESRPG.Labels.ARMOR_MATERIAL.ebony",
  stalhrim: "UESRPG.Labels.ARMOR_MATERIAL.stalhrim",
  daedric: "UESRPG.Labels.ARMOR_MATERIAL.daedric",
  dragonbone: "UESRPG.Labels.ARMOR_MATERIAL.dragonbone"
});

// ── Shield types ──────────────────────────────────────────────────────────────

export const SHIELD_TYPE_LABELS = Object.freeze({
  normal: "UESRPG.Labels.SHIELD_TYPE.normal",
  tower: "UESRPG.Labels.SHIELD_TYPE.tower",
  targe: "UESRPG.Labels.SHIELD_TYPE.targe",
  buckler: "UESRPG.Labels.SHIELD_TYPE.buckler"
});

// ── Spell schools ─────────────────────────────────────────────────────────────

export const SPELL_SCHOOL_LABELS = Object.freeze({
  alteration: "UESRPG.Labels.SPELL_SCHOOL.alteration",
  conjuration: "UESRPG.Labels.SPELL_SCHOOL.conjuration",
  destruction: "UESRPG.Labels.SPELL_SCHOOL.destruction",
  illusion: "UESRPG.Labels.SPELL_SCHOOL.illusion",
  mysticism: "UESRPG.Labels.SPELL_SCHOOL.mysticism",
  necromancy: "UESRPG.Labels.SPELL_SCHOOL.necromancy",
  restoration: "UESRPG.Labels.SPELL_SCHOOL.restoration"
});

// ── Spell ranks ───────────────────────────────────────────────────────────────

export const SPELL_RANK_LABELS = Object.freeze({
  1: "UESRPG.Labels.SPELL_RANK.1",
  2: "UESRPG.Labels.SPELL_RANK.2",
  3: "UESRPG.Labels.SPELL_RANK.3",
  4: "UESRPG.Labels.SPELL_RANK.4",
  5: "UESRPG.Labels.SPELL_RANK.5",
  6: "UESRPG.Labels.SPELL_RANK.6",
  7: "UESRPG.Labels.SPELL_RANK.7"
});

// ── Training ranks ────────────────────────────────────────────────────────────

export const TRAINING_RANK_LABELS = Object.freeze({
  untrained: "UESRPG.Labels.TRAINING_RANK.untrained",
  novice: "UESRPG.Labels.TRAINING_RANK.novice",
  apprentice: "UESRPG.Labels.TRAINING_RANK.apprentice",
  journeyman: "UESRPG.Labels.TRAINING_RANK.journeyman",
  adept: "UESRPG.Labels.TRAINING_RANK.adept",
  expert: "UESRPG.Labels.TRAINING_RANK.expert",
  master: "UESRPG.Labels.TRAINING_RANK.master",
  grandmaster: "UESRPG.Labels.TRAINING_RANK.grandmaster",
  legendary: "UESRPG.Labels.TRAINING_RANK.legendary"
});

export const NPC_MAGIC_RANK_LABELS = Object.freeze({
  untrained: "UESRPG.Labels.TRAINING_RANK.untrained",
  novice: "UESRPG.Labels.TRAINING_RANK.novice",
  apprentice: "UESRPG.Labels.TRAINING_RANK.apprentice",
  journeyman: "UESRPG.Labels.TRAINING_RANK.journeyman",
  adept: "UESRPG.Labels.TRAINING_RANK.adept",
  expert: "UESRPG.Labels.TRAINING_RANK.expert",
  master: "UESRPG.Labels.TRAINING_RANK.master"
});

// ── Religion domains ──────────────────────────────────────────────────────────

export const RELIGION_DOMAIN_LABELS = Object.freeze({
  covenant: "UESRPG.Labels.RELIGION_DOMAIN.covenant",
  duty: "UESRPG.Labels.RELIGION_DOMAIN.duty",
  hearth: "UESRPG.Labels.RELIGION_DOMAIN.hearth",
  grace: "UESRPG.Labels.RELIGION_DOMAIN.grace",
  nature: "UESRPG.Labels.RELIGION_DOMAIN.nature",
  exchange: "UESRPG.Labels.RELIGION_DOMAIN.exchange",
  knowledge: "UESRPG.Labels.RELIGION_DOMAIN.knowledge",
  victory: "UESRPG.Labels.RELIGION_DOMAIN.victory",
  cycle: "UESRPG.Labels.RELIGION_DOMAIN.cycle",
  fate: "UESRPG.Labels.RELIGION_DOMAIN.fate",
  twilight: "UESRPG.Labels.RELIGION_DOMAIN.twilight",
  ruin: "UESRPG.Labels.RELIGION_DOMAIN.ruin",
  universal: "UESRPG.Labels.RELIGION_DOMAIN.universal"
});

// ── Invocation circles ────────────────────────────────────────────────────────

export const INVOCATION_CIRCLE_LABELS = Object.freeze({
  1: "UESRPG.Labels.INVOCATION_CIRCLE.1",
  2: "UESRPG.Labels.INVOCATION_CIRCLE.2",
  3: "UESRPG.Labels.INVOCATION_CIRCLE.3",
  4: "UESRPG.Labels.INVOCATION_CIRCLE.4"
});

// ── Circumstance modifiers ────────────────────────────────────────────────────
// Keys are stringified numeric values — JS object access coerces numbers to
// strings automatically, so CIRCUMSTANCE_MOD_LABELS[30] resolves correctly.

export const CIRCUMSTANCE_MOD_LABELS = Object.freeze({
  30: "UESRPG.Labels.CIRCUMSTANCE_MOD.30",
  20: "UESRPG.Labels.CIRCUMSTANCE_MOD.20",
  10: "UESRPG.Labels.CIRCUMSTANCE_MOD.10",
  0: "UESRPG.Labels.CIRCUMSTANCE_MOD.0",
  "-10": "UESRPG.Labels.CIRCUMSTANCE_MOD.-10",
  "-20": "UESRPG.Labels.CIRCUMSTANCE_MOD.-20",
  "-30": "UESRPG.Labels.CIRCUMSTANCE_MOD.-30"
});

// ── Item quality and trait labels (shared across types) ───────────────────────
// Covers both QUALITIES_CORE_BY_TYPE and TRAITS_BY_TYPE key spaces.
// The two sets are disjoint, so a single map is safe.

export const ITEM_QUALITY_LABELS = Object.freeze({
  // Structured qualities (QUALITIES_CORE_BY_TYPE + QUALITIES_CATALOG)
  slashing: "UESRPG.Labels.ITEM_QUALITY.slashing",
  splitting: "UESRPG.Labels.ITEM_QUALITY.splitting",
  crushing: "UESRPG.Labels.ITEM_QUALITY.crushing",
  piercing: "UESRPG.Labels.ITEM_QUALITY.piercing",
  magic: "UESRPG.Labels.ITEM_QUALITY.magic",
  silver: "UESRPG.Labels.ITEM_QUALITY.silver",
  primitive: "UESRPG.Labels.ITEM_QUALITY.primitive",
  proven: "UESRPG.Labels.ITEM_QUALITY.proven",
  reload: "UESRPG.Labels.ITEM_QUALITY.reload",
  damaged: "UESRPG.Labels.ITEM_QUALITY.damaged",
  specialDamageRule: "UESRPG.Labels.ITEM_QUALITY.specialDamageRule",
  // Extended weapon traits (TRAITS_BY_TYPE.weapon)
  concealable: "UESRPG.Labels.ITEM_QUALITY.concealable",
  concussive: "UESRPG.Labels.ITEM_QUALITY.concussive",
  complex: "UESRPG.Labels.ITEM_QUALITY.complex",
  dueling: "UESRPG.Labels.ITEM_QUALITY.dueling",
  entangling: "UESRPG.Labels.ITEM_QUALITY.entangling",
  exploitWeakness: "UESRPG.Labels.ITEM_QUALITY.exploitWeakness",
  flail: "UESRPG.Labels.ITEM_QUALITY.flail",
  focus: "UESRPG.Labels.ITEM_QUALITY.focus",
  handToHand: "UESRPG.Labels.ITEM_QUALITY.handToHand",
  hooked: "UESRPG.Labels.ITEM_QUALITY.hooked",
  impaling: "UESRPG.Labels.ITEM_QUALITY.impaling",
  mounted: "UESRPG.Labels.ITEM_QUALITY.mounted",
  shieldSplitter: "UESRPG.Labels.ITEM_QUALITY.shieldSplitter",
  sling: "UESRPG.Labels.ITEM_QUALITY.sling",
  small: "UESRPG.Labels.ITEM_QUALITY.small",
  snare: "UESRPG.Labels.ITEM_QUALITY.snare",
  thrown: "UESRPG.Labels.ITEM_QUALITY.thrown",
  twoHanded: "UESRPG.Labels.ITEM_QUALITY.twoHanded",
  unwieldy: "UESRPG.Labels.ITEM_QUALITY.unwieldy",
  // Armor traits (TRAITS_BY_TYPE.armor)
  shield: "UESRPG.Labels.ITEM_QUALITY.shield",
  helmet: "UESRPG.Labels.ITEM_QUALITY.helmet"
});

// ── Resolver helpers ──────────────────────────────────────────────────────────

/**
 * Resolve a display label for a given key from a label map.
 * Falls back to humanizing the key string on a cache miss.
 *
 * @param {object} labelMap - A frozen key→label map from this module.
 * @param {string|number} key - The catalog key.
 * @param {string} [fallback] - Explicit fallback (default: humanized key).
 * @returns {string} Display label.
 */
export function resolveLabel(labelMap, key, fallback) {
  const k = String(key ?? "");
  const found = labelMap?.[k] ?? labelMap?.[key];
  if (found != null) return String(found);
  if (fallback != null) return String(fallback);
  // Humanize camelCase / kebab identifiers as last resort.
  return k
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase()) || k;
}

/**
 * Add `label` fields from a label map to quality/trait catalog entries.
 * Returns a new array — the source catalog is never mutated.
 *
 * @param {Array<{key: string}>} entries - Catalog entries (from QUALITIES_CORE_BY_TYPE etc.)
 * @param {object} labelMap - Key→label map (typically ITEM_QUALITY_LABELS).
 * @returns {Array<{key: string, label: string}>} New entries with `label` injected.
 */
export function resolveQualityCatalog(entries, labelMap) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    ...entry,
    label: resolveLabel(labelMap, entry?.key, entry?.key ?? "")
  }));
}
