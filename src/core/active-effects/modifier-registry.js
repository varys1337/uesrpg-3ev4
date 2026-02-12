/**
 * src/core/active-effects/modifier-registry.js
 *
 * Single source of truth for all valid Active Effect modifier keys.
 *
 * Purpose:
 * - Canonical list of every AE change key recognised by the system.
 * - Categorised for discoverability (characteristics, combat, magic, etc.).
 * - Spell-effect builders and the modifier evaluator validate against this registry.
 * - Dev-mode warnings emitted for unrecognised key writes.
 *
 * Every key listed in docs/Active Effect Wiki.md is represented here.
 * When adding new modifier keys, add them here FIRST, then consume them.
 *
 * Target: Foundry VTT v13.351
 */

// ─── Registry Definitions ────────────────────────────────────────────────────

/**
 * @typedef {object} ModifierKeyEntry
 * @property {string} key — dot-path AE change key
 * @property {string} label — human-readable label
 * @property {string} category — grouping category
 * @property {"numeric"|"boolean"|"string"} valueType — expected change value type
 * @property {boolean} [spellRelevant] — true if this key is commonly written by spell effects
 */

/** @type {ModifierKeyEntry[]} */
const _ENTRIES = [];

/** @type {Map<string, ModifierKeyEntry>} */
const _BY_KEY = new Map();

function _reg(key, label, category, valueType = "numeric", spellRelevant = false) {
  const entry = { key, label, category, valueType, spellRelevant };
  _ENTRIES.push(entry);
  _BY_KEY.set(key, entry);
}

// ─── 1. Characteristics ──────────────────────────────────────────────────────

const _CHARS = ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"];
const _CHAR_LABELS = {
  str: "Strength", end: "Endurance", agi: "Agility", int: "Intelligence",
  wp: "Willpower", prc: "Perception", prs: "Personality", lck: "Luck"
};
for (const c of _CHARS) {
  _reg(`system.modifiers.characteristics.${c}`, _CHAR_LABELS[c], "characteristics", "numeric", true);
}

// ─── 2. Combat & Rolls ──────────────────────────────────────────────────────

// 2.1 Attack TN
_reg("system.modifiers.combat.attackTN", "Attack TN", "combat", "numeric", true);

// 2.2 Defense TNs
_reg("system.modifiers.combat.defenseTN.total", "Defense TN (Total)", "combat");
_reg("system.modifiers.combat.defenseTN.evade", "Defense TN (Evade)", "combat");
_reg("system.modifiers.combat.defenseTN.block", "Defense TN (Block)", "combat");
_reg("system.modifiers.combat.defenseTN.parry", "Defense TN (Parry)", "combat");
_reg("system.modifiers.combat.defenseTN.counter", "Defense TN (Counter)", "combat");

// 2.3 Skills
_reg("system.modifiers.tests.all", "All Tests", "skills", "numeric", true);
_reg("system.modifiers.skills._all", "All Skills", "skills", "numeric", true);

// Per-school skills (also usable for general skills if key matches)
const _SCHOOLS = ["alteration", "conjuration", "destruction", "illusion", "mysticism", "necromancy", "restoration"];
for (const s of _SCHOOLS) {
  _reg(`system.modifiers.skills.${s}`, `Skill: ${s.charAt(0).toUpperCase() + s.slice(1)}`, "skills", "numeric", true);
}

// 2.4 Magic casting TN lanes
_reg("system.modifiers.magic.castingTN._all", "Casting TN (All)", "magic", "numeric", true);
for (const s of _SCHOOLS) {
  _reg(`system.modifiers.magic.castingTN.${s}`, `Casting TN: ${s.charAt(0).toUpperCase() + s.slice(1)}`, "magic", "numeric", true);
}

// 2.5 Spell defense (Mysticism / Alteration)
_reg("system.modifiers.magic.spellReflect", "Spell Reflect (level threshold)", "magic", "numeric", true);
_reg("system.modifiers.magic.spellAbsorption", "Spell Absorption (level threshold)", "magic", "numeric", true);

// 2.6 Stealth modifier lanes (Illusion)
_reg("system.modifiers.stealth.visual", "Stealth: Visual (Observe penalty)", "stealth", "numeric", true);
_reg("system.modifiers.stealth.auditory", "Stealth: Auditory (Observe penalty)", "stealth", "numeric", true);

// 2.7 Situational test modifiers
_reg("system.modifiers.tests.fear", "Fear Test Bonus", "skills", "numeric", true);
_reg("system.modifiers.tests.social", "Social Test Bonus (Charm)", "skills", "numeric", true);
_reg("system.modifiers.tests.observe", "Observe/Perception Test Bonus", "skills", "numeric", true);

// ─── 3. Damage System ────────────────────────────────────────────────────────

// Attacker
_reg("system.modifiers.combat.damage.dealt", "Bonus Damage Dealt", "damage", "numeric", true);
_reg("system.modifiers.combat.penetration", "Penetration", "damage", "numeric", true);

// Defender
_reg("system.modifiers.combat.damage.taken", "Damage Taken Modifier", "damage", "numeric", true);
_reg("system.modifiers.combat.mitigation.flat", "Flat Mitigation", "damage", "numeric", true);

// Armor Rating
_reg("system.modifiers.combat.armorRating", "Armor Rating (Global)", "armor", "numeric", true);
// Location-specific AR keys are dynamic; we register a pattern prefix
// e.g. system.modifiers.combat.armorRating.head, .chest, etc.

// Resistances
const _RES_TYPES = [
  ["fireR", "Fire"], ["frostR", "Frost"], ["shockR", "Shock"],
  ["poisonR", "Poison"], ["diseaseR", "Disease"], ["magicR", "Magic"],
  ["silverR", "Silver"], ["sunlightR", "Sunlight"], ["physicalR", "Physical"]
];
for (const [k, l] of _RES_TYPES) {
  _reg(`system.resistance.${k}`, `Resistance: ${l}`, "resistance", "numeric", true);
  _reg(`system.modifiers.resistance.${k}`, `Resistance Mod: ${l}`, "resistance", "numeric", true);
}
// Alias lanes
_reg("system.resistances.poison", "Resistance: Poison (alias)", "resistance");
_reg("system.resistances.disease", "Resistance: Disease (alias)", "resistance");
_reg("system.traits.resistance.fire", "Trait Resistance: Fire", "resistance", "numeric", true);
_reg("system.traits.resistance.frost", "Trait Resistance: Frost", "resistance", "numeric", true);
_reg("system.traits.resistance.shock", "Trait Resistance: Shock", "resistance", "numeric", true);
_reg("system.traits.resistance.poison", "Trait Resistance: Poison", "resistance", "numeric", true);
_reg("system.traits.resistance.disease", "Trait Resistance: Disease", "resistance", "numeric", true);

// Natural Toughness
_reg("system.modifiers.resistance.natToughness", "Natural Toughness", "resistance", "numeric", true);

// ─── 4. Derived Stats ────────────────────────────────────────────────────────

// Initiative
_reg("system.modifiers.initiative.base", "Initiative Base", "initiative");
_reg("system.modifiers.initiative.bonus", "Initiative Bonus", "initiative");
_reg("system.modifiers.initiative.value", "Initiative Value", "initiative");
_reg("system.modifiers.initiative.mult.agi", "Initiative Mult: AGI", "initiative");
_reg("system.modifiers.initiative.mult.int", "Initiative Mult: INT", "initiative");
_reg("system.modifiers.initiative.mult.prc", "Initiative Mult: PRC", "initiative");
_reg("system.modifiers.initiative.flat", "Initiative Flat", "initiative");

// Speed
_reg("system.modifiers.speed.base", "Speed Base", "speed", "numeric", true);
_reg("system.modifiers.speed.bonus", "Speed Bonus", "speed", "numeric", true);
_reg("system.modifiers.speed.value", "Speed Value", "speed", "numeric", true);
_reg("system.modifiers.speed.flySpeed", "Fly Speed", "speed", "numeric", true);
_reg("system.modifiers.speed.swimSpeed", "Swim Speed", "speed", "numeric", true);

// Movement
_reg("system.modifiers.movement.fallDamage", "Fall Damage Reduction", "movement", "numeric", true);
_reg("system.traits.movement.waterBreathing", "Water Breathing", "movement", "boolean", true);
_reg("system.traits.movement.waterWalking", "Water Walking", "movement", "boolean", true);

// ─── 5. Resources ────────────────────────────────────────────────────────────

_reg("system.modifiers.hp.max", "HP Max", "resources", "numeric", true);

_reg("system.modifiers.magicka.base", "Magicka Base", "resources", "numeric", true);
_reg("system.modifiers.magicka.bonus", "Magicka Bonus", "resources", "numeric", true);
_reg("system.modifiers.magicka.max", "Magicka Max", "resources", "numeric", true);
_reg("system.modifiers.magicka.value", "Magicka Value", "resources", "numeric", true);

_reg("system.modifiers.stamina.max", "Stamina Max", "resources", "numeric", true);
_reg("system.modifiers.luck_points.max", "Luck Points Max", "resources");

// Action Points
_reg("system.modifiers.action_points.max", "Action Points Max", "resources", "numeric", true);
_reg("system.modifiers.action_points.value", "Action Points Value", "resources", "numeric", true);

// Lucky/Unlucky Numbers
_reg("system.modifiers.lucky_numbers.max", "Lucky Numbers Max", "resources");
_reg("system.modifiers.lucky_numbers.value", "Lucky Numbers Value (alias)", "resources");
_reg("system.modifiers.unlucky_numbers.max", "Unlucky Numbers Max", "resources");
_reg("system.modifiers.unlucky_numbers.value", "Unlucky Numbers Value (alias)", "resources");

// ─── 6. Wound Threshold ─────────────────────────────────────────────────────

_reg("system.modifiers.wound_threshold.bonus", "Wound Threshold Bonus", "wounds");
_reg("system.modifiers.wound_threshold.value", "Wound Threshold Value", "wounds");
_reg("system.traits.immunity.passiveWounds", "Passive Wound Immunity", "wounds", "boolean");

// ─── 7. Carry & Encumbrance ─────────────────────────────────────────────────

_reg("system.modifiers.carry.base", "Carry Base", "encumbrance");
_reg("system.modifiers.carry.bonus", "Carry Bonus", "encumbrance");
_reg("system.modifiers.carry.override", "Carry Override", "encumbrance");

_reg("system.modifiers.encumbrance.testPenalty", "Encumbrance Test Penalty", "encumbrance");
_reg("system.modifiers.encumbrance.penalty", "Encumbrance Penalty (legacy)", "encumbrance");
_reg("system.modifiers.encumbrance.speedPenalty", "Encumbrance Speed Penalty", "encumbrance");
_reg("system.modifiers.encumbrance.staminaPenalty", "Encumbrance Stamina Penalty", "encumbrance");

// ─── 8. Fatigue ──────────────────────────────────────────────────────────────

_reg("system.modifiers.fatigue.bonus", "Fatigue Bonus", "fatigue");
_reg("system.modifiers.fatigue.penalty", "Fatigue Penalty", "fatigue");
_reg("system.modifiers.exhaustion.bonus", "Exhaustion Bonus (alias)", "fatigue");
_reg("system.modifiers.exhaustion.penalty", "Exhaustion Penalty (alias)", "fatigue");

// ─── 10. Condition Immunities ────────────────────────────────────────────────

const _CONDITION_IMMUNITIES = [
  "paralysis", "stunned", "unconscious", "prone", "fear", "horror", "charm",
  "bleeding", "burning", "poisoned", "disease", "fatigue", "exhaustion"
];
for (const c of _CONDITION_IMMUNITIES) {
  _reg(`system.traits.immunity.${c}`, `Immunity: ${c.charAt(0).toUpperCase() + c.slice(1)}`, "conditions", "boolean", true);
}

// ─── 11. Condition State Flags ───────────────────────────────────────────────

_reg("system.traits.condition.silenced", "Silenced (blocks verbal casting)", "conditions", "boolean", true);
_reg("system.traits.condition.invisible", "Invisible", "conditions", "boolean", true);
_reg("system.traits.condition.blinded", "Blinded (sight-based test penalties)", "conditions", "boolean", true);
_reg("system.traits.condition.paralyzed", "Paralyzed (incapacitated)", "conditions", "boolean", true);
_reg("system.traits.condition.frenzied", "Frenzied (forced hostility)", "conditions", "boolean", true);
_reg("system.traits.condition.calmed", "Calmed (suppresses hostility)", "conditions", "boolean", true);
_reg("system.traits.condition.panicked", "Panicked (fear flight)", "conditions", "boolean", true);
_reg("system.traits.condition.horrified", "Horrified (severe fear)", "conditions", "boolean", true);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if a key is a known/approved modifier key.
 * @param {string} key
 * @returns {boolean}
 */
export function isKnownModifierKey(key) {
  if (_BY_KEY.has(key)) return true;
  // Dynamic pattern: per-skill keys (system.modifiers.skills.<anything>)
  if (typeof key === "string" && key.startsWith("system.modifiers.skills.")) return true;
  // Dynamic pattern: per-location AR (system.modifiers.combat.armorRating.<location>)
  if (typeof key === "string" && key.startsWith("system.modifiers.combat.armorRating.")) return true;
  return false;
}

/**
 * Look up a modifier key entry.
 * @param {string} key
 * @returns {ModifierKeyEntry|null}
 */
export function getModifierKeyEntry(key) {
  return _BY_KEY.get(key) ?? null;
}

/**
 * Get all registered modifier key entries.
 * @returns {ModifierKeyEntry[]}
 */
export function getAllModifierKeys() {
  return [..._ENTRIES];
}

/**
 * Get all modifier keys for a specific category.
 * @param {string} category
 * @returns {ModifierKeyEntry[]}
 */
export function getModifierKeysByCategory(category) {
  return _ENTRIES.filter(e => e.category === category);
}

/**
 * Get all modifier keys marked as spell-relevant.
 * @returns {ModifierKeyEntry[]}
 */
export function getSpellRelevantKeys() {
  return _ENTRIES.filter(e => e.spellRelevant);
}

/**
 * Get all unique categories.
 * @returns {string[]}
 */
export function getModifierCategories() {
  return [...new Set(_ENTRIES.map(e => e.category))];
}

/**
 * Validate an array of AE changes against the registry.
 * Returns an array of warnings for unknown keys.
 *
 * @param {Array<{key: string, value: any, mode: number}>} changes
 * @param {object} [opts]
 * @param {boolean} [opts.warn=true] — emit console.warn for unknowns
 * @param {string} [opts.context] — context string for log messages
 * @returns {Array<{key: string, message: string}>}
 */
export function validateAEChanges(changes, opts = {}) {
  const warnings = [];
  if (!Array.isArray(changes)) return warnings;
  const shouldWarn = opts.warn !== false;
  const ctx = opts.context ? ` (${opts.context})` : "";

  for (const ch of changes) {
    const key = ch?.key;
    if (!key || typeof key !== "string") continue;
    if (!isKnownModifierKey(key)) {
      const msg = `Unknown AE modifier key: "${key}"${ctx}`;
      warnings.push({ key, message: msg });
      if (shouldWarn) {
        try { console.warn(`UESRPG | modifier-registry | ${msg}`); } catch (_e) { /* no-op */ }
      }
    }
  }
  return warnings;
}

