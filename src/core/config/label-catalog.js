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
  inferior: "Inferior",
  common: "Common",
  superior: "Superior"
});

// ── Weapon materials ──────────────────────────────────────────────────────────

export const WEAPON_MATERIAL_LABELS = Object.freeze({
  // Legacy/compat
  standard: "Standard",
  chitin: "Chitin",
  iron: "Iron",
  silver: "Silver",
  steel: "Steel",
  dwemer: "Dwemer",
  moonstone: "Moonstone",
  orichalcum: "Orichalcum",
  adamantium: "Adamantium",
  malachite: "Malachite",
  stalhrim: "Stalhrim",
  daedric: "Daedric",
  ebony: "Ebony",
  dragonbone: "Dragonbone",
  // Ranged-only
  bonemold: "Bonemold",
  // Sling-only
  cloth: "Cloth",
  hemp: "Hemp",
  leatherStraps: "Leather Straps",
  netchLeatherStraps: "Netch Leather Straps",
  silk: "Silk",
  dreughHide: "Dreugh Hide",
  // Special melee-only
  wood: "Wood",
  bone: "Bone"
});

// ── Ammunition materials ──────────────────────────────────────────────────────

export const AMMO_MATERIAL_LABELS = Object.freeze({
  standard: "Standard",
  chitin: "Chitin",
  iron: "Iron",
  silver: "Silver",
  steel: "Steel",
  dwemer: "Dwemer",
  moonstone: "Moonstone",
  orichalcum: "Orichalcum",
  adamantium: "Adamantium",
  malachite: "Malachite",
  stalhrim: "Stalhrim",
  daedric: "Daedric",
  ebony: "Ebony",
  dragonbone: "Dragonbone"
});

// ── Ammunition arrow types ────────────────────────────────────────────────────

export const AMMO_ARROW_TYPE_LABELS = Object.freeze({
  none: "None",
  slashing: "Slashing",
  splitting: "Splitting"
});

// ── Armor weight classes ──────────────────────────────────────────────────────

export const ARMOR_WEIGHT_CLASS_LABELS = Object.freeze({
  none: "None",
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
  superheavy: "Super Heavy",
  crippling: "Crippling"
});

// ── Armor classes ─────────────────────────────────────────────────────────────

export const ARMOR_CLASS_LABELS = Object.freeze({
  partial: "Partial",
  full: "Full"
});

// ── Armor materials ───────────────────────────────────────────────────────────

export const ARMOR_MATERIAL_LABELS = Object.freeze({
  padded: "Padded",
  hide: "Hide",
  chitin: "Chitin",
  leather: "Leather",
  netchLeather: "Netch Leather",
  fur: "Fur",
  bone: "Bone",
  bonemold: "Bonemold",
  iron: "Iron",
  moonstone: "Moonstone",
  dreughHide: "Dreugh Hide",
  steel: "Steel",
  mithril: "Mithril",
  dwemer: "Dwemer",
  orichalcum: "Orichalcum",
  adamantium: "Adamantium",
  malachite: "Malachite",
  dragonscale: "Dragonscale",
  ebony: "Ebony",
  stalhrim: "Stalhrim",
  daedric: "Daedric",
  dragonbone: "Dragonbone"
});

// ── Shield types ──────────────────────────────────────────────────────────────

export const SHIELD_TYPE_LABELS = Object.freeze({
  normal: "Normal",
  tower: "Tower",
  targe: "Targe",
  buckler: "Buckler"
});

// ── Spell schools ─────────────────────────────────────────────────────────────

export const SPELL_SCHOOL_LABELS = Object.freeze({
  alteration: "Alteration",
  conjuration: "Conjuration",
  destruction: "Destruction",
  illusion: "Illusion",
  mysticism: "Mysticism",
  necromancy: "Necromancy",
  restoration: "Restoration"
});

// ── Spell ranks ───────────────────────────────────────────────────────────────

export const SPELL_RANK_LABELS = Object.freeze({
  1: "Novice",
  2: "Apprentice",
  3: "Adept",
  4: "Expert",
  5: "Master",
  6: "Grandmaster",
  7: "Legendary"
});

// ── Circumstance modifiers ────────────────────────────────────────────────────
// Keys are stringified numeric values — JS object access coerces numbers to
// strings automatically, so CIRCUMSTANCE_MOD_LABELS[30] resolves correctly.

export const CIRCUMSTANCE_MOD_LABELS = Object.freeze({
  30: "Major Advantage (+30)",
  20: "Advantage (+20)",
  10: "Minor Advantage (+10)",
  0: "\u2014",
  "-10": "Minor Disadvantage (-10)",
  "-20": "Disadvantage (-20)",
  "-30": "Major Disadvantage (-30)"
});

// ── Item quality and trait labels (shared across types) ───────────────────────
// Covers both QUALITIES_CORE_BY_TYPE and TRAITS_BY_TYPE key spaces.
// The two sets are disjoint, so a single map is safe.

export const ITEM_QUALITY_LABELS = Object.freeze({
  // Structured qualities (QUALITIES_CORE_BY_TYPE + QUALITIES_CATALOG)
  slashing: "Slashing",
  splitting: "Splitting",
  crushing: "Crushing",
  piercing: "Piercing",
  magic: "Magic",
  silver: "Silver",
  primitive: "Primitive",
  proven: "Proven",
  reload: "Reload",
  damaged: "Damaged",
  specialDamageRule: "Special Damage",
  // Extended weapon traits (TRAITS_BY_TYPE.weapon)
  concealable: "Concealable",
  concussive: "Concussive",
  complex: "Complex",
  dueling: "Dueling Weapon",
  entangling: "Entangling",
  exploitWeakness: "Exploit Weakness",
  flail: "Flail",
  focus: "Focus",
  handToHand: "Hand-to-Hand",
  hooked: "Hooked",
  impaling: "Impaling",
  mounted: "Mounted",
  shieldSplitter: "Shield Splitter",
  sling: "Sling",
  small: "Small",
  snare: "Snare",
  thrown: "Thrown",
  twoHanded: "Two-Handed",
  unwieldy: "Unwieldy",
  // Armor traits (TRAITS_BY_TYPE.armor)
  shield: "Shield",
  helmet: "Helmet"
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
