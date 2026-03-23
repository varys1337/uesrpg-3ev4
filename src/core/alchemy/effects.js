/**
 * Alchemy Effects Catalog + API
 *
 * Authoritative source for all alchemical effects drawn from the Rules Compendium
 * Appendix (Spell Effects / Spell Attributes tables). Only effects with the
 * "potion" or "toxin" attribute appear here; pure enchanting effects live in
 * src/data/spell-effects.json.
 *
 * Public API:
 *   listPotionEffects({ school })  → effects eligible for potion crafting
 *   listToxinEffects({ school })   → effects eligible for toxin crafting
 *   getEffectByKey(key)            → single effect entry or null
 *   computeEffectCost(key, sl)     → numeric cost (honors fixedCost)
 *   getEffectToxinOverrides(key)   → { removeUpkeep? }
 *   computeUpkeepDuration(key, ingredientStrength, effectCost) → { rounds } | null
 *   QUALITY_TIERS                  → quality name → { strength, depth }
 *   ALCHEMY_SCHOOLS                → string[]
 *   POISON_DICE                    → level → formula
 */

// ── Inline catalog (avoids browser ES module JSON assertion issues) ───────────
//
// Each entry:
//   key           Unique identifier matching spell-effects.json where possible.
//   label         Display name.
//   school        Alchemical school (alteration | illusion | mysticism | restoration | destruction).
//   attributes    Array of "potion", "toxin", "upkeep" as applicable.
//   costFormula   String evaluated as JS with SL substituted, e.g. "SL * 10".
//   fixedCost     Number (overrides costFormula when present).
//   slRange       [min, max] spell levels allowed.
//   baseDuration  { unit: "minutes"|"rounds", value: number } — base upkeep duration.
//                 Final duration = baseDuration.value * floor(ingredientStrength / effectCost).
//   toxinOverrides { removeUpkeep: bool } — modifications when used in a toxin.
//   notes         Human-readable clarification string.

/** @type {Array<object>} */
const _CATALOG = [
  // ── Restoration ─────────────────────────────────────────────────────────────
  {
    key: "restoreHealth",
    label: "Restore Health",
    school: "restoration",
    attributes: ["potion"],
    costFormula: "SL * 10",
    slRange: [1, 7],
    baseDuration: null,
    notes: "Restores SL Health instantly. No upkeep — duration scaling does not apply.",
  },
  {
    key: "restoreMagicka",
    label: "Restore Magicka",
    school: "restoration",
    attributes: ["potion"],
    costFormula: "SL * 10",
    slRange: [1, 7],
    baseDuration: null,
    notes: "Restores SL Magicka instantly.",
  },
  {
    key: "restoreStamina",
    label: "Restore Stamina",
    school: "restoration",
    attributes: ["potion"],
    costFormula: "SL * 10",
    slRange: [1, 7],
    baseDuration: null,
    notes: "Restores SL Stamina Points instantly.",
  },
  {
    key: "fortifyAttribute",
    label: "Fortify Attribute",
    school: "restoration",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 10",
    slRange: [1, 7],
    baseDuration: { unit: "minutes", value: 5 },
    notes: "Temporarily increases a chosen attribute by SL × 5 for the duration. Choose which attribute to fortify.",
  },
  {
    key: "shieldSpell",
    label: "Shield",
    school: "restoration",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 10",
    slRange: [1, 7],
    baseDuration: { unit: "minutes", value: 5 },
    notes: "Provides SL Magic Armor Rating to the drinker for the duration.",
  },

  // ── Alteration ───────────────────────────────────────────────────────────────
  {
    key: "feather",
    label: "Feather",
    school: "alteration",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 5",
    slRange: [1, 7],
    baseDuration: { unit: "minutes", value: 10 },
    notes: "Reduces the drinker's Encumbrance by SL × 5 for the duration.",
  },
  {
    key: "slowFall",
    label: "Slow Fall",
    school: "alteration",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 5",
    slRange: [1, 3],
    baseDuration: { unit: "minutes", value: 10 },
    notes: "Reduces or negates fall damage for the drinker.",
  },
  {
    key: "waterbreathing",
    label: "Waterbreathing",
    school: "alteration",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 10",
    slRange: [1, 3],
    baseDuration: { unit: "minutes", value: 10 },
    notes: "Allows the drinker to breathe underwater for the duration.",
  },
  {
    key: "levitation",
    label: "Levitation",
    school: "alteration",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 10",
    slRange: [1, 5],
    baseDuration: { unit: "minutes", value: 5 },
    notes: "Allows the drinker to levitate and move through the air.",
  },
  {
    key: "burden",
    label: "Burden",
    school: "alteration",
    attributes: ["toxin", "upkeep"],
    costFormula: "SL * 5",
    slRange: [1, 7],
    baseDuration: { unit: "minutes", value: 5 },
    toxinOverrides: { removeUpkeep: true },
    notes: "Increases the target's Encumbrance by SL × 5. When used as a toxin: effect is not Upkeep.",
  },

  // ── Illusion ─────────────────────────────────────────────────────────────────
  {
    key: "nightEye",
    label: "Night Eye",
    school: "illusion",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 5",
    slRange: [1, 3],
    baseDuration: { unit: "minutes", value: 10 },
    notes: "Grants the ability to see in darkness. SL determines effectiveness.",
  },
  {
    key: "chameleon",
    label: "Chameleon",
    school: "illusion",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 15",
    slRange: [1, 5],
    baseDuration: { unit: "minutes", value: 5 },
    notes: "Partially or fully renders the drinker invisible. SL determines transparency level.",
  },
  {
    key: "invisibility",
    label: "Invisibility",
    school: "illusion",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 20",
    slRange: [1, 5],
    baseDuration: { unit: "minutes", value: 3 },
    notes: "Renders the drinker fully invisible until they take an action that breaks invisibility.",
  },
  {
    key: "calm",
    label: "Calm",
    school: "illusion",
    attributes: ["potion", "toxin", "upkeep"],
    costFormula: "SL * 10",
    slRange: [1, 5],
    baseDuration: { unit: "minutes", value: 5 },
    toxinOverrides: { removeUpkeep: true },
    toxinSave: { characteristic: "end", label: "Endurance" },
    notes: "Calms the target. As a potion: calms the drinker. As a toxin: effect is not Upkeep.",
  },
  {
    key: "frenzy",
    label: "Frenzy",
    school: "illusion",
    attributes: ["toxin", "upkeep"],
    costFormula: "SL * 10",
    slRange: [1, 5],
    baseDuration: { unit: "minutes", value: 3 },
    toxinOverrides: { removeUpkeep: true },
    toxinSave: { characteristic: "end", label: "Endurance" },
    notes: "Forces the target to attack the nearest creature. When used as a toxin: effect is not Upkeep.",
  },
  {
    key: "demoralize",
    label: "Demoralize",
    school: "illusion",
    attributes: ["toxin"],
    costFormula: "SL * 10",
    slRange: [1, 5],
    baseDuration: null,
    notes: "Forces the target to flee in fear. When used as a toxin: not considered Upkeep.",
  },

  // ── Mysticism ────────────────────────────────────────────────────────────────
  {
    key: "detectLife",
    label: "Detect Life",
    school: "mysticism",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 5",
    slRange: [1, 5],
    baseDuration: { unit: "minutes", value: 5 },
    notes: "Reveals living creatures within SL × 5 metres.",
  },
  {
    key: "detectDead",
    label: "Detect Dead",
    school: "mysticism",
    attributes: ["potion", "upkeep"],
    costFormula: "SL * 5",
    slRange: [1, 5],
    baseDuration: { unit: "minutes", value: 5 },
    notes: "Reveals undead creatures within SL × 5 metres.",
  },
  {
    key: "dispel",
    label: "Dispel",
    school: "mysticism",
    attributes: ["potion"],
    costFormula: "SL * 10",
    slRange: [1, 7],
    baseDuration: null,
    notes: "Dispels magical effects with Dispel Strength = SL. Instant.",
  },
  {
    key: "drainHealth",
    label: "Drain Health",
    school: "mysticism",
    attributes: ["toxin", "upkeep"],
    costFormula: "SL * 10",
    slRange: [1, 7],
    baseDuration: { unit: "minutes", value: 5 },
    toxinOverrides: { removeUpkeep: true },
    toxinSave: { characteristic: "end", label: "Endurance" },
    notes: "Drains SL Health from the target. When used as a toxin: not considered Upkeep.",
  },
  {
    key: "drainMagicka",
    label: "Drain Magicka",
    school: "mysticism",
    attributes: ["toxin", "upkeep"],
    costFormula: "SL * 10",
    slRange: [1, 7],
    baseDuration: { unit: "minutes", value: 5 },
    toxinOverrides: { removeUpkeep: true },
    toxinSave: { characteristic: "end", label: "Endurance" },
    notes: "Drains SL Magicka from the target. When used as a toxin: not considered Upkeep.",
  },
  {
    key: "drainStamina",
    label: "Drain Stamina",
    school: "mysticism",
    attributes: ["toxin", "upkeep"],
    costFormula: "SL * 10",
    slRange: [1, 7],
    baseDuration: { unit: "minutes", value: 5 },
    toxinOverrides: { removeUpkeep: true },
    toxinSave: { characteristic: "end", label: "Endurance" },
    notes: "Drains SL Stamina Points from the target. When used as a toxin: not considered Upkeep.",
  },
  {
    key: "paralyze",
    label: "Paralyze",
    school: "mysticism",
    attributes: ["toxin"],
    costFormula: "SL * 20",
    slRange: [1, 5],
    baseDuration: null,
    toxinSave: { characteristic: "end", label: "Endurance" },
    notes: "Inflicts the Paralyzed condition on the target. When used as a toxin: not considered Upkeep.",
  },
  {
    key: "silence",
    label: "Silence",
    school: "mysticism",
    attributes: ["toxin"],
    costFormula: "SL * 15",
    slRange: [1, 5],
    baseDuration: null,
    toxinSave: { characteristic: "end", label: "Endurance" },
    notes: "Inflicts the Silenced condition on the target. When used as a toxin: not considered Upkeep.",
  },
];

// ── Quality tier constants ────────────────────────────────────────────────────

/**
 * Ingredient quality tiers mapping quality name → { strength, depth }.
 * Strength = maximum cost capacity for an effect.
 * Depth = maximum spell level allowed for an effect.
 */
export const QUALITY_TIERS = Object.freeze({
  ubiquitous:    { strength: 2,   depth: 1, label: "Ubiquitous" },
  plentiful:     { strength: 5,   depth: 2, label: "Plentiful" },
  common:        { strength: 10,  depth: 3, label: "Common" },
  uncommon:      { strength: 15,  depth: 4, label: "Uncommon" },
  rare:          { strength: 25,  depth: 5, label: "Rare" },
  veryRare:      { strength: 50,  depth: 6, label: "Very Rare" },
  extremelyRare: { strength: 100, depth: 7, label: "Extremely Rare" },
  legendary:     { strength: 200, depth: 8, label: "Legendary" },
});

/** Schools that can appear on alchemical ingredients. */
export const ALCHEMY_SCHOOLS = Object.freeze([
  "alteration",
  "destruction",
  "illusion",
  "mysticism",
  "restoration",
]);

/**
 * Poison damage dice by poison level (1–8).
 * RAW §1.3: level → formula.
 */
export const POISON_DICE = Object.freeze({
  1: "1d4",
  2: "1d6",
  3: "1d8",
  4: "1d10",
  5: "1d12",
  6: "2d8",
  7: "2d10",
  8: "2d12",
});

// ── Internal map for O(1) lookups ─────────────────────────────────────────────
const _CATALOG_BY_KEY = Object.fromEntries(_CATALOG.map(e => [e.key, e]));

// ── Precompiled cost functions (one Function per catalog entry, compiled at module load) ──
// Eliminates repeated `new Function(...)` calls during brew validation/preview/creation.
const _COMPILED_COST_FNS = new Map();
for (const entry of _CATALOG) {
  if (entry.fixedCost != null) continue;
  const formula = (entry.costFormula ?? "SL * 10").replace(/\bSL\b/gi, "sl");
  try {
    // eslint-disable-next-line no-new-func
    _COMPILED_COST_FNS.set(entry.key, new Function("sl", `return (${formula});`));
  } catch (_) {
    _COMPILED_COST_FNS.set(entry.key, () => 0);
  }
}

// ── Precomputed effect lists (avoids filtering _CATALOG on every call) ─────────
const _POTION_EFFECTS = Object.freeze(_CATALOG.filter(e => e.attributes.includes("potion")));
const _TOXIN_EFFECTS  = Object.freeze(_CATALOG.filter(e => e.attributes.includes("toxin")));

const _POTION_BY_SCHOOL = new Map();
const _TOXIN_BY_SCHOOL  = new Map();
for (const e of _POTION_EFFECTS) {
  if (!_POTION_BY_SCHOOL.has(e.school)) _POTION_BY_SCHOOL.set(e.school, []);
  _POTION_BY_SCHOOL.get(e.school).push(e);
}
for (const e of _TOXIN_EFFECTS) {
  if (!_TOXIN_BY_SCHOOL.has(e.school)) _TOXIN_BY_SCHOOL.set(e.school, []);
  _TOXIN_BY_SCHOOL.get(e.school).push(e);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return all effects that can appear in a potion (have the "potion" attribute).
 * @param {object} opts
 * @param {string|null} opts.school  Filter by school. Null = all schools.
 * @returns {object[]}
 */
export function listPotionEffects({ school = null } = {}) {
  if (school) return (_POTION_BY_SCHOOL.get(school) ?? []).slice();
  return _POTION_EFFECTS.slice();
}

/**
 * Return all effects that can appear in a toxin (have the "toxin" attribute).
 * @param {object} opts
 * @param {string|null} opts.school  Filter by school. Null = all schools.
 * @returns {object[]}
 */
export function listToxinEffects({ school = null } = {}) {
  if (school) return (_TOXIN_BY_SCHOOL.get(school) ?? []).slice();
  return _TOXIN_EFFECTS.slice();
}

/**
 * Look up a single effect by key.
 * @param {string} effectKey
 * @returns {object|null}
 */
export function getEffectByKey(effectKey) {
  return _CATALOG_BY_KEY[effectKey] ?? null;
}

/**
 * Compute the numeric cost of an effect at a given spell level.
 * Honors fixedCost. Uses precompiled cost functions for performance.
 * Falls back gracefully if the function cannot be evaluated.
 * @param {string} effectKey
 * @param {number} sl  Spell level.
 * @returns {number}
 */
export function computeEffectCost(effectKey, sl) {
  const effect = getEffectByKey(effectKey);
  if (!effect) return 0;
  if (effect.fixedCost != null) return Number(effect.fixedCost);
  const safeSl = Math.max(1, Number(sl) || 1);
  const fn = _COMPILED_COST_FNS.get(effectKey);
  if (!fn) return 0;
  try {
    return Math.ceil(Number(fn(safeSl)) || 0);
  } catch (err) {
    console.warn(`UESRPG | alchemy.computeEffectCost: compiled fn for "${effectKey}" failed`, err);
    return 0;
  }
}

/**
 * Return toxin-specific overrides for an effect (e.g. removeUpkeep).
 * Returns an empty object if the effect has no toxin overrides.
 * @param {string} effectKey
 * @returns {{ removeUpkeep?: boolean }}
 */
export function getEffectToxinOverrides(effectKey) {
  return getEffectByKey(effectKey)?.toxinOverrides ?? {};
}

/**
 * Compute the final upkeep duration for a potion effect.
 *
 * RAW: finalDuration = baseDuration * floor(ingredientStrength / effectCost)
 *
 * Returns null if the effect has no upkeep (instant effects).
 *
 * @param {string} effectKey
 * @param {number} ingredientStrength  Effective ingredient strength (after talent bonuses).
 * @param {number} effectCost         Cost of the effect at the chosen SL.
 * @returns {{ unit: string, value: number }|null}
 */
export function computeUpkeepDuration(effectKey, ingredientStrength, effectCost) {
  const effect = getEffectByKey(effectKey);
  if (!effect?.baseDuration) return null;
  if (!effect.attributes.includes("upkeep")) return null;
  if (!effectCost || effectCost <= 0) return null;

  const multiplier = Math.max(1, Math.floor(ingredientStrength / effectCost));
  return {
    unit: effect.baseDuration.unit,
    value: effect.baseDuration.value * multiplier,
  };
}

/**
 * Check whether an effect has the "upkeep" attribute.
 * When used inside a toxin and the effect has `toxinOverrides.removeUpkeep = true`,
 * the Upkeep attribute is stripped — use isToxinUpkeep() for that case.
 * @param {string} effectKey
 * @returns {boolean}
 */
export function effectHasUpkeep(effectKey) {
  return getEffectByKey(effectKey)?.attributes.includes("upkeep") ?? false;
}

/**
 * Whether an effect retains Upkeep when included in a toxin.
 * Per RAW: some effects note "when included in a toxin, not considered Upkeep."
 * @param {string} effectKey
 * @returns {boolean}
 */
export function isToxinUpkeep(effectKey) {
  const effect = getEffectByKey(effectKey);
  if (!effect) return false;
  if (!effect.attributes.includes("upkeep")) return false;
  return !(effect.toxinOverrides?.removeUpkeep === true);
}
