/**
 * Chapter 9 alchemical effect catalog.
 * Only effects carrying the Potion or Toxin attribute are listed publicly.
 */

const ELEMENT_OPTIONS = Object.freeze([
  { value: "fire", label: "Fire" },
  { value: "frost", label: "Frost" },
  { value: "shock", label: "Shock" },
  { value: "poison", label: "Poison" },
]);

const CHARACTERISTIC_OPTIONS = Object.freeze([
  { value: "str", label: "Strength" },
  { value: "end", label: "Endurance" },
  { value: "agi", label: "Agility" },
  { value: "int", label: "Intelligence" },
  { value: "wp", label: "Willpower" },
  { value: "prc", label: "Perception" },
  { value: "prs", label: "Personality" },
]);

const DETECT_OPTIONS = Object.freeze([
  { value: "life", label: "Life" },
  { value: "magic", label: "Magic" },
  { value: "undead", label: "Undead" },
  { value: "other", label: "Other" },
]);

const param = (key, label, options) => Object.freeze({ key, label, options });
const entry = (data) => {
  const normalized = {
    slRange: [1, 8],
    levelOptions: [],
    parameters: [],
    baseDuration: null,
    toxinOverrides: {},
    automation: "manual",
    notes: "",
    ...data,
  };
  const [slMin, slMax] = normalized.slRange;
  return Object.freeze({
    ...normalized,
    costType: normalized.fixedCost != null ? "fixed" : "multiplier",
    levelType: slMin === slMax
      ? "fixed"
      : (normalized.levelOptions.length ? "discrete" : "continuous"),
  });
};

const _CATALOG = Object.freeze([
  // Alteration — Potion
  entry({ key: "elementalArmor", label: "Elemental Armor", school: "alteration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 4, baseDuration: { value: 1, unit: "minutes" }, parameters: [param("element", "Type", ELEMENT_OPTIONS)] }),
  entry({ key: "magicArmor", label: "Magic Armor", school: "alteration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 6, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "armor", label: "Armor", school: "alteration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 5, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "feather", label: "Feather", school: "alteration", attributes: ["potion", "upkeep", "instant"], fixedCost: 10, slRange: [3, 3], levelOptions: [3], baseDuration: { value: 1, unit: "rounds" }, automation: "partial" }),
  entry({ key: "shield", label: "Shield", school: "alteration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 2, baseDuration: { value: 1, unit: "rounds" } }),
  entry({ key: "magicShield", label: "Magic Shield", school: "alteration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 2, baseDuration: { value: 1, unit: "rounds" } }),
  entry({ key: "typeShield", label: "[Type] Shield", school: "alteration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 1, baseDuration: { value: 1, unit: "rounds" }, parameters: [param("element", "Type", ELEMENT_OPTIONS)] }),
  entry({ key: "jump", label: "Jump", school: "alteration", attributes: ["potion", "instant"], costMultiplier: 1, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "levitate", label: "Levitate", school: "alteration", attributes: ["potion", "upkeep"], costMultiplier: 6, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "slowfall", label: "Slowfall", school: "alteration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 1, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "waterBreathing", label: "Water Breathing", school: "alteration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 1, baseDuration: { value: 1, unit: "minutes", scaleWithSL: true } }),
  entry({ key: "waterWalking", label: "Water Walking", school: "alteration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 1, baseDuration: { value: 1, unit: "minutes", scaleWithSL: true } }),

  // Alteration — Toxin
  entry({ key: "burden", label: "Burden", school: "alteration", attributes: ["toxin", "upkeep"], costMultiplier: 3, baseDuration: { value: 1, unit: "rounds" }, toxinSave: { characteristic: "str", label: "Strength", modifierFormula: "30 - (10 * SL)" } }),

  // Destruction — Toxin
  entry({ key: "drainMagicka", label: "Drain Magicka", school: "destruction", attributes: ["toxin", "upkeep"], costMultiplier: 2, toxinOverrides: { removeUpkeep: true }, toxinSave: { characteristic: "wp", label: "Willpower", modifierFormula: "0" } }),
  entry({ key: "fatigue", label: "Fatigue", school: "destruction", attributes: ["toxin", "attack", "upkeep"], costMultiplier: 2, toxinOverrides: { removeUpkeep: true }, toxinSave: { characteristic: "end", label: "Endurance", modifierFormula: "30 - (10 * SL)" }, automation: "automatic" }),

  // Illusion — Potion
  entry({ key: "chameleon", label: "Chameleon", school: "illusion", attributes: ["potion", "upkeep", "instant"], costMultiplier: 3, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "invisibility", label: "Invisibility", school: "illusion", attributes: ["potion", "upkeep"], fixedCost: 12, slRange: [5, 5], levelOptions: [5], baseDuration: { value: 1, unit: "rounds" } }),
  entry({ key: "light", label: "Light", school: "illusion", attributes: ["potion", "upkeep", "instant"], costMultiplier: 1, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "muffle", label: "Muffle", school: "illusion", attributes: ["potion", "upkeep", "instant"], costMultiplier: 3, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "nightEye", label: "Night Eye", school: "illusion", attributes: ["potion", "upkeep", "instant"], costMultiplier: 3, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "sanctuary", label: "Sanctuary", school: "illusion", attributes: ["potion", "upkeep", "instant"], costMultiplier: 7, baseDuration: { value: 1, unit: "rounds" } }),

  // Illusion — Toxin
  entry({ key: "blind", label: "Blind", school: "illusion", attributes: ["toxin", "upkeep"], costMultiplier: 3, baseDuration: { value: 1, unit: "rounds" }, toxinSave: { characteristic: "wp", label: "Willpower", modifierFormula: "30 - (10 * SL)" } }),
  entry({ key: "calm", label: "Calm", school: "illusion", attributes: ["toxin"], costMultiplier: 3, baseDuration: { value: 1, unit: "minutes" }, toxinSave: { characteristic: "wp", label: "Willpower", modifierFormula: "30 - (10 * SL)" } }),
  entry({ key: "charm", label: "Charm", school: "illusion", attributes: ["toxin", "upkeep", "instant"], costMultiplier: 2, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "frenzy", label: "Frenzy", school: "illusion", attributes: ["toxin"], costMultiplier: 4, toxinSave: { characteristic: "wp", label: "Willpower", modifierFormula: "30 - (10 * SL)" } }),
  entry({ key: "paralyze", label: "Paralyze", school: "illusion", attributes: ["toxin", "upkeep"], costMultiplier: 7, baseDuration: { value: 1, unit: "rounds" }, toxinSave: { characteristic: "wp", label: "Willpower", modifierFormula: "30 - (10 * SL)" } }),
  entry({ key: "silence", label: "Silence", school: "illusion", attributes: ["toxin", "upkeep"], costMultiplier: 3, baseDuration: { value: 1, unit: "rounds" }, toxinSave: { characteristic: "wp", label: "Willpower", modifierFormula: "30 - (10 * SL)" } }),

  // Mysticism — Potion
  entry({ key: "detect", label: "Detect [Type]", school: "mysticism", attributes: ["potion", "upkeep", "instant"], costMultiplier: 5, baseDuration: { value: 1, unit: "minutes" }, parameters: [param("detectType", "Type", DETECT_OPTIONS)] }),
  entry({ key: "dispel", label: "Dispel", school: "mysticism", attributes: ["potion"], costMultiplier: 4, automation: "partial" }),
  entry({ key: "etherealForm", label: "Ethereal Form", school: "mysticism", attributes: ["potion", "upkeep"], fixedCost: 10, slRange: [5, 5], levelOptions: [5], baseDuration: { value: 1, unit: "rounds" } }),
  entry({ key: "mark", label: "Mark", school: "mysticism", attributes: ["potion", "instant"], fixedCost: 5, slRange: [2, 2], levelOptions: [2] }),
  entry({ key: "recall", label: "Recall", school: "mysticism", attributes: ["potion", "instant"], fixedCost: 15, slRange: [3, 3], levelOptions: [3] }),
  entry({ key: "reflect", label: "Reflect", school: "mysticism", attributes: ["potion", "upkeep", "instant"], costMultiplier: 3, baseDuration: { value: 1, unit: "rounds" } }),
  entry({ key: "spellAbsorption", label: "Spell Absorption", school: "mysticism", attributes: ["potion", "upkeep", "instant"], costMultiplier: 3, baseDuration: { value: 1, unit: "rounds" } }),
  entry({ key: "telekinesis", label: "Telekinesis", school: "mysticism", attributes: ["potion", "upkeep", "instant"], costMultiplier: 3, baseDuration: { value: 1, unit: "minutes" } }),
  entry({ key: "telepathy", label: "Telepathy", school: "mysticism", attributes: ["potion", "upkeep", "instant"], costMultiplier: 3, baseDuration: { value: 1, unit: "minutes" } }),

  // Restoration — Potion
  entry({ key: "cureDisease", label: "Cure Disease", school: "restoration", attributes: ["potion", "instant"], costMultiplier: 3, slRange: [2, 4], levelOptions: [2, 4] }),
  entry({ key: "cureParalysis", label: "Cure Paralysis", school: "restoration", attributes: ["potion", "instant"], fixedCost: 8, slRange: [2, 2], levelOptions: [2] }),
  entry({ key: "fortifyCharacteristic", label: "Fortify [Characteristic]", school: "restoration", attributes: ["potion", "upkeep"], costMultiplier: 8, baseDuration: { value: 1, unit: "rounds" }, parameters: [param("characteristic", "Characteristic", CHARACTERISTIC_OPTIONS)] }),
  entry({ key: "heal", label: "Heal", school: "restoration", attributes: ["potion", "instant"], costMultiplier: 2, automation: "automatic" }),
  entry({ key: "rejuvenate", label: "Rejuvenate", school: "restoration", attributes: ["potion", "instant"], fixedCost: 16, slRange: [3, 3], levelOptions: [3] }),
  entry({ key: "replenish", label: "Replenish", school: "restoration", attributes: ["potion", "instant"], costMultiplier: 3, automation: "automatic" }),
  entry({ key: "elementalResistance", label: "Elemental Resistance", school: "restoration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 2, baseDuration: { value: 1, unit: "rounds" }, parameters: [param("element", "Type", ELEMENT_OPTIONS)] }),
  entry({ key: "resistanceToMagic", label: "Resistance to Magic", school: "restoration", attributes: ["potion", "upkeep", "instant"], costMultiplier: 4, baseDuration: { value: 1, unit: "rounds" } }),
  entry({ key: "stabilize", label: "Stabilize", school: "restoration", attributes: ["potion", "instant"], fixedCost: 1, slRange: [1, 1], levelOptions: [1] }),

  // Restoration — Toxin
  entry({ key: "turnUndead", label: "Turn Undead", school: "restoration", attributes: ["toxin", "upkeep"], costMultiplier: 3, toxinSave: { characteristic: "wp", label: "Willpower", modifierFormula: "30 - (10 * SL)" } }),
]);

// Hidden compatibility definitions for already-created products. These do not
// appear in the new workshop catalog.
const _LEGACY = Object.freeze({
  restoreHealth: entry({ key: "restoreHealth", label: "Restore Health", school: "restoration", attributes: ["potion"], costMultiplier: 10, automation: "automatic", legacy: true }),
  restoreMagicka: entry({ key: "restoreMagicka", label: "Restore Magicka", school: "restoration", attributes: ["potion"], costMultiplier: 10, automation: "automatic", legacy: true }),
  restoreStamina: entry({ key: "restoreStamina", label: "Restore Stamina", school: "restoration", attributes: ["potion"], costMultiplier: 10, automation: "automatic", legacy: true }),
  fortifyAttribute: entry({ key: "fortifyAttribute", label: "Fortify Attribute", school: "restoration", attributes: ["potion", "upkeep"], costMultiplier: 10, baseDuration: { value: 5, unit: "minutes" }, legacy: true }),
  shieldSpell: entry({ key: "shieldSpell", label: "Shield", school: "restoration", attributes: ["potion", "upkeep"], costMultiplier: 10, baseDuration: { value: 5, unit: "minutes" }, legacy: true }),
  slowFall: entry({ key: "slowFall", label: "Slow Fall", school: "alteration", attributes: ["potion", "upkeep"], costMultiplier: 5, baseDuration: { value: 10, unit: "minutes" }, legacy: true }),
  waterbreathing: entry({ key: "waterbreathing", label: "Waterbreathing", school: "alteration", attributes: ["potion", "upkeep"], costMultiplier: 10, baseDuration: { value: 10, unit: "minutes" }, legacy: true }),
  levitation: entry({ key: "levitation", label: "Levitation", school: "alteration", attributes: ["potion", "upkeep"], costMultiplier: 10, baseDuration: { value: 5, unit: "minutes" }, legacy: true }),
  detectLife: entry({ key: "detectLife", label: "Detect Life", school: "mysticism", attributes: ["potion", "upkeep"], costMultiplier: 5, baseDuration: { value: 5, unit: "minutes" }, legacy: true }),
  detectDead: entry({ key: "detectDead", label: "Detect Dead", school: "mysticism", attributes: ["potion", "upkeep"], costMultiplier: 5, baseDuration: { value: 5, unit: "minutes" }, legacy: true }),
  drainHealth: entry({ key: "drainHealth", label: "Drain Health", school: "mysticism", attributes: ["toxin"], costMultiplier: 10, automation: "automatic", legacy: true }),
  drainStamina: entry({ key: "drainStamina", label: "Drain Stamina", school: "mysticism", attributes: ["toxin"], costMultiplier: 10, automation: "automatic", legacy: true }),
  demoralize: entry({ key: "demoralize", label: "Demoralize", school: "illusion", attributes: ["toxin"], costMultiplier: 10, automation: "automatic", legacy: true }),
});

export const QUALITY_TIERS = Object.freeze({
  ubiquitous: { strength: 2, depth: 1, label: "Ubiquitous" },
  plentiful: { strength: 5, depth: 2, label: "Plentiful" },
  common: { strength: 10, depth: 3, label: "Common" },
  uncommon: { strength: 15, depth: 4, label: "Uncommon" },
  rare: { strength: 25, depth: 5, label: "Rare" },
  veryRare: { strength: 50, depth: 6, label: "Very Rare" },
  extremelyRare: { strength: 100, depth: 7, label: "Extremely Rare" },
  legendary: { strength: 200, depth: 8, label: "Legendary" },
});

export const ALCHEMY_SCHOOLS = Object.freeze([
  "alteration", "conjuration", "destruction", "illusion", "mysticism", "necromancy", "restoration",
]);

export const POISON_DICE = Object.freeze({
  1: "1d4", 2: "1d6", 3: "1d8", 4: "1d10", 5: "1d12", 6: "2d8", 7: "2d10", 8: "2d12",
});

const _CATALOG_BY_KEY = new Map(_CATALOG.map((effect) => [effect.key, effect]));
const _POTION_EFFECTS = Object.freeze(_CATALOG.filter((effect) => effect.attributes.includes("potion")));
const _TOXIN_EFFECTS = Object.freeze(_CATALOG.filter((effect) => effect.attributes.includes("toxin")));

function _listBySchool(list, school) {
  const wanted = String(school ?? "").trim().toLowerCase();
  return (wanted ? list.filter((effect) => effect.school === wanted) : list).slice();
}

export function listPotionEffects({ school = null } = {}) {
  return _listBySchool(_POTION_EFFECTS, school);
}

export function listToxinEffects({ school = null } = {}) {
  return _listBySchool(_TOXIN_EFFECTS, school);
}

export function getEffectByKey(effectKey) {
  const key = String(effectKey ?? "").trim();
  return _CATALOG_BY_KEY.get(key) ?? _LEGACY[key] ?? null;
}

export function computeEffectCost(effectKey, sl) {
  const effect = getEffectByKey(effectKey);
  if (!effect) return 0;
  if (effect.fixedCost != null) return Math.max(0, Number(effect.fixedCost) || 0);
  return Math.max(0, Math.ceil((Number(effect.costMultiplier) || 0) * Math.max(1, Number(sl) || 1)));
}

export function getEffectToxinOverrides(effectKey) {
  return { ...(getEffectByKey(effectKey)?.toxinOverrides ?? {}) };
}

export function computeUpkeepDuration(effectKey, ingredientStrength, effectCost, spellLevel = 1) {
  const effect = getEffectByKey(effectKey);
  if (!effect?.baseDuration || !effect.attributes.includes("upkeep")) return null;
  return computeAlchemyEffectDuration(effectKey, ingredientStrength, effectCost, spellLevel);
}

/**
 * Compute the stored duration for any timed catalog effect. Upkeep effects use
 * the Chapter 6 ingredient-strength multiplier; other timed effects retain
 * their printed duration.
 */
export function computeAlchemyEffectDuration(effectKey, ingredientStrength, effectCost, spellLevel = 1) {
  const effect = getEffectByKey(effectKey);
  if (!effect?.baseDuration) return null;
  const cost = Number(effectCost);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const base = Number(effect.baseDuration.value ?? 0) * (effect.baseDuration.scaleWithSL ? Math.max(1, Number(spellLevel) || 1) : 1);
  const multiplier = effect.attributes.includes("upkeep")
    ? Math.max(1, Math.floor((Number(ingredientStrength) || 0) / cost))
    : 1;
  return {
    unit: String(effect.baseDuration.unit ?? "rounds"),
    value: Math.max(1, Math.floor(base * multiplier)),
  };
}

export function effectHasUpkeep(effectKey) {
  return getEffectByKey(effectKey)?.attributes.includes("upkeep") ?? false;
}

export function isToxinUpkeep(effectKey) {
  const effect = getEffectByKey(effectKey);
  return Boolean(effect?.attributes.includes("upkeep") && effect?.toxinOverrides?.removeUpkeep !== true);
}
