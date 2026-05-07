/**
 * src/core/active-effects/modifier-registry.js
 *
 * Single source of truth for all valid Active Effect modifier keys.
 *
 * Target: Foundry VTT v13.351
 */

import { CHARACTERISTIC_KEYS, CHARACTERISTIC_LABELS, MAGIC_SCHOOL_KEYS } from "../domain/constants.js";
import { isCreatureTypeConditionalKey, stripCreatureTypeSuffix } from "../rules/creature-types.js";

/**
 * @typedef {object} ModifierKeyEntry
 * @property {string} key
 * @property {string} label
 * @property {string} category
 * @property {"numeric"|"boolean"|"string"} valueType
 * @property {boolean} [spellRelevant]
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

function _capitalize(value) {
  const text = String(value ?? "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

for (const c of CHARACTERISTIC_KEYS) {
  _reg(`system.modifiers.characteristics.${c}`, CHARACTERISTIC_LABELS[c], "characteristics", "numeric", true);
}

_reg("system.modifiers.combat.attackTN", "Attack TN", "combat", "numeric", true);
_reg("system.modifiers.combat.opposed.attackTN", "Opposed Attack TN", "combat", "numeric", true);
_reg("system.modifiers.combat.defenseTN.total", "Defense TN (Total)", "combat");
_reg("system.modifiers.combat.defenseTN.evade", "Defense TN (Evade)", "combat");
_reg("system.modifiers.combat.defenseTN.block", "Defense TN (Block)", "combat");
_reg("system.modifiers.combat.defenseTN.parry", "Defense TN (Parry)", "combat");
_reg("system.modifiers.combat.defenseTN.counter", "Defense TN (Counter)", "combat");
_reg("system.modifiers.combat.attackLimit.total", "Attack Limit (Total)", "combat");
_reg("system.modifiers.combat.attackLimit.melee", "Attack Limit (Melee)", "combat");
_reg("system.modifiers.combat.attackLimit.ranged", "Attack Limit (Ranged)", "combat");
_reg("system.modifiers.combat.evadeAoOCost", "Evade AoO AP Cost", "combat");

_reg("system.modifiers.tests.all", "All Tests", "tests", "numeric", true);
_reg("system.modifiers.tests.fear", "Fear Test Bonus", "tests", "numeric", true);
_reg("system.modifiers.tests.social", "Social Test Bonus", "tests", "numeric", true);
_reg("system.modifiers.tests.observe", "Observe Test Bonus", "tests", "numeric", true);
_reg("system.modifiers.tests.panic", "Panic Test Bonus", "tests", "numeric", true);
_reg("system.modifiers.tests.horror", "Horror Test Bonus", "tests", "numeric", true);

_reg("system.modifiers.skills._all", "All Skills", "skills", "numeric", true);
_reg("system.modifiers.skills.frenziedPenalty", "Frenzied Skill Penalty Modifier", "skills", "numeric", true);
_reg("system.modifiers.skills.physicalExertion", "Physical Exertion Skill Modifier", "skills", "numeric", true);
for (const school of MAGIC_SCHOOL_KEYS) {
  _reg(`system.modifiers.skills.${school}`, `Skill: ${_capitalize(school)}`, "skills", "numeric", true);
}

_reg("system.modifiers.magic.castingTN._all", "Casting TN (All)", "magic", "numeric", true);
for (const school of MAGIC_SCHOOL_KEYS) {
  _reg(`system.modifiers.magic.castingTN.${school}`, `Casting TN: ${_capitalize(school)}`, "magic", "numeric", true);
}

_reg("system.modifiers.magic.cost._all", "Magic Cost (All)", "magic", "numeric", true);
for (const school of MAGIC_SCHOOL_KEYS) {
  _reg(`system.modifiers.magic.cost.${school}`, `Magic Cost: ${_capitalize(school)}`, "magic", "numeric", true);
}

_reg("system.modifiers.magic.spellReflect", "Spell Reflect", "magic", "numeric", true);
_reg("system.modifiers.magic.spellAbsorption", "Spell Absorption", "magic", "numeric", true);
_reg("system.modifiers.magic.negateChance", "Spell Negate Chance", "magic", "numeric", true);
_reg("system.modifiers.magic.spellRestraintBonus", "Spell Restraint Bonus", "magic", "numeric", true);
_reg("system.modifiers.magic.damage.fire", "Magic Damage: Fire", "magic", "numeric", true);
_reg("system.modifiers.magic.damage.frost", "Magic Damage: Frost", "magic", "numeric", true);
_reg("system.modifiers.magic.damage.shock", "Magic Damage: Shock", "magic", "numeric", true);

_reg("system.modifiers.stealth.visual", "Stealth: Visual", "stealth", "numeric", true);
_reg("system.modifiers.stealth.auditory", "Stealth: Auditory", "stealth", "numeric", true);

_reg("system.modifiers.combat.damage.dealt", "Damage Dealt", "damage", "numeric", true);
_reg("system.modifiers.combat.damage.taken", "Damage Taken", "damage", "numeric", true);
_reg("system.modifiers.combat.penetration", "Penetration", "damage", "numeric", true);
_reg("system.modifiers.combat.mitigation.flat", "Flat Mitigation", "damage", "numeric", true);
_reg("system.modifiers.damage.fromSunlight", "Damage from Sunlight", "damage", "numeric", true);
_reg("system.modifiers.damage.fromSilver", "Damage from Silver", "damage", "numeric", true);
_reg("system.modifiers.damage.fromMagic", "Damage from Magic", "damage", "numeric", true);

_reg("system.modifiers.combat.armorRating", "Armor Rating (Global)", "armor", "numeric", true);
_reg("system.modifiers.combat.magicArmorRating", "Magic Armor Rating (Global)", "armor", "numeric", true);

const _RES_TYPES = Object.freeze([
  ["fireR", "Fire"],
  ["frostR", "Frost"],
  ["shockR", "Shock"],
  ["poisonR", "Poison"],
  ["diseaseR", "Disease"],
  ["magicR", "Magic"],
  ["silverR", "Silver"],
  ["sunlightR", "Sunlight"],
  ["physicalR", "Physical"]
]);
const _RES_TYPE_KEYS = new Set(_RES_TYPES.map(([key]) => key));
for (const [key, label] of _RES_TYPES) {
  _reg(`system.resistance.${key}`, `Resistance: ${label}`, "resistance", "numeric", true);
  _reg(`system.modifiers.resistance.${key}`, `Resistance Mod: ${label}`, "resistance", "numeric", true);
}
_reg("system.resistances.poison", "Resistance: Poison (Alias)", "resistance");
_reg("system.resistances.disease", "Resistance: Disease (Alias)", "resistance");
_reg("system.traits.resistance.fire", "Trait Resistance: Fire", "resistance", "numeric", true);
_reg("system.traits.resistance.frost", "Trait Resistance: Frost", "resistance", "numeric", true);
_reg("system.traits.resistance.shock", "Trait Resistance: Shock", "resistance", "numeric", true);
_reg("system.traits.resistance.poison", "Trait Resistance: Poison", "resistance", "numeric", true);
_reg("system.traits.resistance.disease", "Trait Resistance: Disease", "resistance", "numeric", true);
_reg("system.modifiers.resistance.natToughness", "Natural Toughness", "resistance", "numeric", true);

_reg("system.modifiers.initiative.base", "Initiative Base", "initiative");
_reg("system.modifiers.initiative.bonus", "Initiative Bonus", "initiative");
_reg("system.modifiers.initiative.value", "Initiative Value", "initiative");
_reg("system.modifiers.initiative.mult.agi", "Initiative Mult: AGI", "initiative");
_reg("system.modifiers.initiative.mult.int", "Initiative Mult: INT", "initiative");
_reg("system.modifiers.initiative.mult.prc", "Initiative Mult: PRC", "initiative");
_reg("system.modifiers.initiative.flat", "Initiative Flat", "initiative");

_reg("system.modifiers.speed.base", "Speed Base", "speed", "numeric", true);
_reg("system.modifiers.speed.bonus", "Speed Bonus", "speed", "numeric", true);
_reg("system.modifiers.speed.value", "Speed Value", "speed", "numeric", true);
_reg("system.modifiers.speed.flySpeed", "Fly Speed", "speed", "numeric", true);
_reg("system.modifiers.speed.swimSpeed", "Swim Speed", "speed", "numeric", true);

_reg("system.modifiers.movement.fallDamage", "Fall Damage Reduction", "movement", "numeric", true);
_reg("system.modifiers.movement.climbSpeed", "Climb Speed", "movement", "numeric", true);
_reg("system.modifiers.movement.dashMultiplier", "Dash Multiplier", "movement", "numeric", true);
_reg("system.modifiers.movement.sprintMultiplier", "Sprint Multiplier", "movement", "numeric", true);
_reg("system.modifiers.movement.hiddenSpeedMultiplier", "Hidden Speed Multiplier", "movement", "numeric", true);
_reg("system.traits.movement.waterBreathing", "Water Breathing", "movement", "boolean", true);
_reg("system.traits.movement.waterWalking", "Water Walking", "movement", "boolean", true);

_reg("system.modifiers.hp.base", "HP Base", "resources", "numeric", true);
_reg("system.modifiers.hp.max", "HP Max", "resources", "numeric", true);
_reg("system.modifiers.magicka.base", "Magicka Base", "resources", "numeric", true);
_reg("system.modifiers.magicka.bonus", "Magicka Bonus", "resources", "numeric", true);
_reg("system.modifiers.magicka.max", "Magicka Max", "resources", "numeric", true);
_reg("system.modifiers.magicka.value", "Magicka Value", "resources", "numeric", true);
_reg("system.modifiers.stamina.base", "Stamina Base", "resources", "numeric", true);
_reg("system.modifiers.stamina.max", "Stamina Max", "resources", "numeric", true);
_reg("system.modifiers.luck_points.base", "Luck Points Base", "resources", "numeric", true);
_reg("system.modifiers.luck_points.max", "Luck Points Max", "resources");
_reg("system.modifiers.action_points.max", "Action Points Max", "resources", "numeric", true);
_reg("system.modifiers.action_points.value", "Action Points Value", "resources", "numeric", true);
_reg("system.modifiers.lucky_numbers.max", "Lucky Numbers Max", "resources");
_reg("system.modifiers.lucky_numbers.value", "Lucky Numbers Value", "resources");
_reg("system.modifiers.unlucky_numbers.max", "Unlucky Numbers Max", "resources");
_reg("system.modifiers.unlucky_numbers.value", "Unlucky Numbers Value", "resources");

_reg("system.modifiers.recovery.naturalHealing.multiplier", "Natural Healing Multiplier", "recovery");
_reg("system.modifiers.recovery.naturalHealing.flatBonus", "Natural Healing Flat Bonus", "recovery");
_reg("system.modifiers.recovery.magicka.multiplier", "Magicka Recovery Multiplier", "recovery");
_reg("system.modifiers.recovery.stamina.multiplier", "Stamina Recovery Multiplier", "recovery");

_reg("system.modifiers.wound_threshold.bonus", "Wound Threshold Bonus", "wounds");
_reg("system.modifiers.wound_threshold.value", "Wound Threshold Value", "wounds");
_reg("system.traits.immunity.passiveWounds", "Passive Wound Immunity", "wounds", "boolean");

_reg("system.modifiers.carry.base", "Carry Base", "encumbrance");
_reg("system.modifiers.carry.bonus", "Carry Bonus", "encumbrance");
_reg("system.modifiers.carry.override", "Carry Override", "encumbrance");
_reg("system.modifiers.encumbrance.testPenalty", "Encumbrance Test Penalty", "encumbrance");
_reg("system.modifiers.encumbrance.penalty", "Encumbrance Penalty (Legacy)", "encumbrance");
_reg("system.modifiers.encumbrance.speedPenalty", "Encumbrance Speed Penalty", "encumbrance");
_reg("system.modifiers.encumbrance.staminaPenalty", "Encumbrance Stamina Penalty", "encumbrance");

_reg("system.modifiers.fatigue.bonus", "Fatigue Bonus", "fatigue");
_reg("system.modifiers.fatigue.penalty", "Fatigue Penalty", "fatigue");
_reg("system.modifiers.exhaustion.bonus", "Exhaustion Bonus (Alias)", "fatigue");
_reg("system.modifiers.exhaustion.penalty", "Exhaustion Penalty (Alias)", "fatigue");

const _CONDITION_IMMUNITIES = Object.freeze([
  "paralysis",
  "stunned",
  "unconscious",
  "prone",
  "fear",
  "horror",
  "charm",
  "bleeding",
  "burning",
  "poisoned",
  "disease",
  "fatigue",
  "exhaustion"
]);
for (const c of _CONDITION_IMMUNITIES) {
  _reg(`system.traits.immunity.${c}`, `Immunity: ${_capitalize(c)}`, "conditions", "boolean", true);
}

_reg("system.traits.condition.silenced", "Silenced", "conditions", "boolean", true);
_reg("system.traits.condition.invisible", "Invisible", "conditions", "boolean", true);
_reg("system.traits.condition.blinded", "Blinded", "conditions", "boolean", true);
_reg("system.traits.condition.paralyzed", "Paralyzed", "conditions", "boolean", true);
_reg("system.traits.condition.frenzied", "Frenzied", "conditions", "boolean", true);
_reg("system.traits.condition.calmed", "Calmed", "conditions", "boolean", true);
_reg("system.traits.condition.panicked", "Panicked", "conditions", "boolean", true);
_reg("system.traits.condition.horrified", "Horrified", "conditions", "boolean", true);

_reg("system.modifiers.degrees.success.all", "DoS Bonus: All Successes", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.skills.all", "DoS Bonus: All Skills", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.combat.all", "DoS Bonus: Combat (All)", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.combat.attack", "DoS Bonus: Combat Attack", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.combat.defense", "DoS Bonus: Combat Defense", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.magic.all", "DoS Bonus: Magic (All)", "degrees", "numeric", true);
for (const school of MAGIC_SCHOOL_KEYS) {
  _reg(`system.modifiers.degrees.success.magic.${school}`, `DoS Bonus: ${_capitalize(school)}`, "degrees", "numeric", true);
}
_reg("system.modifiers.degrees.success.social", "DoS Bonus: Social", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.observe", "DoS Bonus: Observe", "degrees", "numeric", true);

_reg("system.modifiers.degrees.success.minimum.all", "Minimum DoS: All Successes", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.minimum.skills.all", "Minimum DoS: All Skills", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.minimum.combat.attack", "Minimum DoS: Combat Attack", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.minimum.combat.defense", "Minimum DoS: Combat Defense", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.minimum.magic.all", "Minimum DoS: Magic (All)", "degrees", "numeric", true);
for (const school of MAGIC_SCHOOL_KEYS) {
  _reg(`system.modifiers.degrees.success.minimum.magic.${school}`, `Minimum DoS: ${_capitalize(school)}`, "degrees", "numeric", true);
}
_reg("system.modifiers.degrees.success.minimum.social", "Minimum DoS: Social", "degrees", "numeric", true);
_reg("system.modifiers.degrees.success.minimum.observe", "Minimum DoS: Observe", "degrees", "numeric", true);

_reg("system.modifiers.degrees.failure.skills.all", "DoF Modifier: All Skills", "degrees", "numeric", true);
_reg("system.modifiers.degrees.failure.combat.all", "DoF Modifier: Combat (All)", "degrees", "numeric", true);
_reg("system.modifiers.degrees.failure.combat.attack", "DoF Modifier: Combat Attack", "degrees", "numeric", true);
_reg("system.modifiers.degrees.failure.combat.defense", "DoF Modifier: Combat Defense", "degrees", "numeric", true);
_reg("system.modifiers.degrees.failure.magic.all", "DoF Modifier: Magic (All)", "degrees", "numeric", true);
for (const school of MAGIC_SCHOOL_KEYS) {
  _reg(`system.modifiers.degrees.failure.magic.${school}`, `DoF Modifier: ${_capitalize(school)}`, "degrees", "numeric", true);
}
_reg("system.modifiers.degrees.failure.social", "DoF Modifier: Social", "degrees", "numeric", true);
_reg("system.modifiers.degrees.failure.observe", "DoF Modifier: Observe", "degrees", "numeric", true);
_reg("system.modifiers.degrees.failure.backfire", "DoF Modifier: Backfire Severity", "degrees", "numeric", true);

const _CAPABILITY_FLAGS = Object.freeze([
  ["flags.uesrpg-3ev4.combat.followupAttackFree", "Follow-up Attack is Free", "combat", false],
  ["flags.uesrpg-3ev4.combat.followupIgnoresRoundLimit", "Follow-up Ignores Round Limit", "combat", false],
  ["flags.uesrpg-3ev4.combat.noAoO", "No Attacks of Opportunity", "combat", false],
  ["flags.uesrpg-3ev4.combat.noAoOAlliesInReach", "No AoO for Allies in Reach", "combat", false],
  ["flags.uesrpg-3ev4.combat.preventEnemyDisengage", "Prevent Enemy Disengage", "combat", false],
  ["flags.uesrpg-3ev4.combat.noAoOWhileFlying", "No AoO While Flying", "combat", false],
  ["flags.uesrpg-3ev4.combat.cannotBeParried", "Cannot Be Parried", "combat", false],
  ["flags.uesrpg-3ev4.combat.autoGrappleOnBite", "Auto Grapple on Bite", "combat", false],
  ["flags.uesrpg-3ev4.combat.autoGrappleOnHit", "Auto Grapple on Hit", "combat", false],
  ["flags.uesrpg-3ev4.combat.ignoreNonMagicAR", "Ignore Non-Magic AR", "combat", false],
  ["flags.uesrpg-3ev4.combat.onlyMagicCanHarm", "Only Magic Can Harm", "combat", false],
  ["flags.uesrpg-3ev4.movement.canClimbWalls", "Can Climb Walls", "movement", true],
  ["flags.uesrpg-3ev4.movement.ignoreTerrainSlow", "Ignore Terrain Slow", "movement", true],
  ["flags.uesrpg-3ev4.movement.standFromProneFree", "Stand from Prone is Free", "movement", true],
  ["flags.uesrpg-3ev4.movement.standFromProneNoAoO", "Stand from Prone Avoids AoO", "movement", true],
  ["flags.uesrpg-3ev4.senses.darkSight", "Dark Sight", "senses", true],
  ["flags.uesrpg-3ev4.senses.echolocation", "Echolocation", "senses", true],
  ["flags.uesrpg-3ev4.senses.alwaysAwakeForSurprise", "Always Awake for Surprise", "senses", true],
  ["flags.uesrpg-3ev4.magic.ignoreVerbalComponents", "Ignore Verbal Components", "magic", true],
  ["flags.uesrpg-3ev4.magic.ignoreSomaticComponents", "Ignore Somatic Components", "magic", true],
  ["flags.uesrpg-3ev4.magic.rerollResistMagic", "Reroll Resist Magic", "magic", true],
  ["flags.uesrpg-3ev4.magic.upkeepViaAP", "Upkeep via AP", "magic", true],
  ["flags.uesrpg-3ev4.damage.contactOnGrapple", "Contact Damage on Grapple", "damage", false],
  ["flags.uesrpg-3ev4.damage.burningImmune", "Burning Immune", "damage", true],
  ["flags.uesrpg-3ev4.healing.regenerationRoundStart", "Regeneration at Round Start", "healing", true],
  ["flags.uesrpg-3ev4.encounter.triggersPanicTest", "Triggers Panic Test", "encounter", true],
  ["flags.uesrpg-3ev4.encounter.triggersHorrorTest", "Triggers Horror Test", "encounter", true]
]);
for (const [key, label, category, spellRelevant] of _CAPABILITY_FLAGS) {
  _reg(key, label, category, "boolean", spellRelevant);
}

function _isDynamicKnownNumericModifierKey(key) {
  if (key.startsWith("system.modifiers.skills.")) return true;
  if (key.startsWith("system.modifiers.combat.armorRating.")) return true;
  if (key.startsWith("system.modifiers.combat.magicArmorRating.")) return true;
  if (key.startsWith("system.modifiers.degrees.success.skills.")) return true;
  if (key.startsWith("system.modifiers.degrees.success.minimum.skills.")) return true;
  if (key.startsWith("system.modifiers.degrees.failure.skills.")) return true;
  return false;
}

function _isKnownNumericModifierKey(key) {
  const entry = _BY_KEY.get(key);
  if (entry) return entry.valueType === "numeric";

  const conditionalResistance = key.match(/^system\.(?:modifiers\.)?resistance\.([a-zA-Z0-9]+)$/);
  if (conditionalResistance && _RES_TYPE_KEYS.has(conditionalResistance[1])) return true;

  return _isDynamicKnownNumericModifierKey(key);
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isKnownModifierKey(key) {
  if (_BY_KEY.has(key)) return true;
  if (typeof key !== "string") return false;

  if (isCreatureTypeConditionalKey(key)) {
    const baseKey = stripCreatureTypeSuffix(key);
    if (baseKey !== key && _isKnownNumericModifierKey(baseKey)) return true;
  }

  const conditionalResistance = key.match(/^system\.(?:modifiers\.)?resistance\.([a-zA-Z0-9]+)\.[a-z0-9-]+$/);
  if (conditionalResistance && _RES_TYPE_KEYS.has(conditionalResistance[1])) return true;
  return _isDynamicKnownNumericModifierKey(key);
}

/**
 * @param {string} key
 * @returns {ModifierKeyEntry|null}
 */
export function getModifierKeyEntry(key) {
  return _BY_KEY.get(key) ?? null;
}

/**
 * @returns {ModifierKeyEntry[]}
 */
export function getAllModifierKeys() {
  return [..._ENTRIES];
}

/**
 * @param {string} category
 * @returns {ModifierKeyEntry[]}
 */
export function getModifierKeysByCategory(category) {
  return _ENTRIES.filter((entry) => entry.category === category);
}

/**
 * @returns {ModifierKeyEntry[]}
 */
export function getSpellRelevantKeys() {
  return _ENTRIES.filter((entry) => entry.spellRelevant);
}

/**
 * @returns {string[]}
 */
export function getModifierCategories() {
  return [...new Set(_ENTRIES.map((entry) => entry.category))];
}

/**
 * @param {Array<{key: string, value: any, mode: number}>} changes
 * @param {{warn?: boolean, context?: string}} [opts]
 * @returns {Array<{key: string, message: string}>}
 */
export function validateAEChanges(changes, opts = {}) {
  const warnings = [];
  if (!Array.isArray(changes)) return warnings;

  const shouldWarn = opts.warn !== false;
  const ctx = opts.context ? ` (${opts.context})` : "";

  for (const change of changes) {
    const key = change?.key;
    if (!key || typeof key !== "string") continue;
    if (isKnownModifierKey(key)) continue;

    const message = `Unknown AE modifier key: "${key}"${ctx}`;
    warnings.push({ key, message });
    if (!shouldWarn) continue;

    try {
      console.warn(`UESRPG | modifier-registry | ${message}`);
    } catch (_e) {
      // no-op
    }
  }

  return warnings;
}
