/**
 * @module traits/features/rule-elements
 * @description Per-item Rule Elements — PF2e-style configurable automation building blocks.
 *
 * Each Rule Element describes a single automation effect (modifier, flag, DoS
 * adjustment, reroll grant, etc.) with optional condition gates. Stored in
 * `flags.uesrpg-3ev4.ruleElements` as a flat array on any trait/talent/power
 * item.
 *
 * Design:
 *  - Pure data helpers — no mutations, no side-effects.
 *  - Compatible with AppV1 — mutations go through item.setFlag / unsetFlag.
 *  - Type registry drives both the UI (field definitions) and the engine
 *    (what each rule element does at evaluation time).
 *  - Conditions are composable: every rule element has an optional conditions
 *    array that gates its activation.
 */
import { isPredicate } from "../../rules/predicate.js";
import { normalizeRulePhase } from "../../rules/phases.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";

const SYSTEM_ID = "uesrpg-3ev4";
const FLAG_KEY  = "ruleElements";

const RULE_ELEMENT_WORKFLOWS = Object.freeze(["skill", "characteristic", "combat", "magic", "all"]);

function _clone(value) {
  if (typeof foundry !== "undefined" && foundry?.utils?.deepClone) {
    return foundry.utils.deepClone(value);
  }
  if (typeof structuredClone === "function") return structuredClone(value);
  if (Array.isArray(value)) return value.map((v) => _clone(v));
  if (value && typeof value === "object") return { ...value };
  return value;
}

function _slug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9:_-]/g, "");
}

function _asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function _normalizeWorkflows(value) {
  const workflows = _asArray(value)
    .map((w) => _slug(w))
    .filter(Boolean)
    .filter((w) => RULE_ELEMENT_WORKFLOWS.includes(w));
  if (workflows.includes("all")) return ["all"];
  return workflows.length ? Array.from(new Set(workflows)) : ["all"];
}

function _normalizeCondition(condition) {
  if (!condition || typeof condition !== "object") return null;
  const type = String(condition.type ?? "").trim();
  if (!type) return null;
  return { ...condition, type };
}

// ─── Memoization cache for predicate parsing ───────────────────────
// Avoids repeated JSON.parse() of the same predicate string across rolls.
/** @type {Map<string, *>} */
const _predicateCache = new Map();
const _PREDICATE_CACHE_MAX = 512;

function _normalizePredicate(predicate) {
  if (predicate == null || predicate === "") return null;
  if (typeof predicate === "string") {
    const text = predicate.trim();
    if (!text) return null;

    // Check memoization cache first.
    if (_predicateCache.has(text)) return _clone(_predicateCache.get(text));

    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        // Cache the parsed result (bounded to prevent unbounded growth).
        if (_predicateCache.size < _PREDICATE_CACHE_MAX) {
          _predicateCache.set(text, parsed);
        }
        return parsed;
      } catch (_e) {
        return text;
      }
    }
    return text;
  }
  return _clone(predicate);
}

function _normalizeSupportPhases(phases) {
  const list = Array.isArray(phases) ? phases : [];
  const out = [];
  for (const phase of list) {
    const canonical = normalizeRulePhase(phase, { fallback: "" });
    if (!canonical) continue;
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}

// ─── Shared option dictionaries ──────────────────────────────────────

/** All characteristics for selects. */
export const CHARACTERISTIC_OPTIONS = Object.freeze({
  str: "Strength",   end: "Endurance", agi: "Agility",
  int: "Intelligence", wp: "Willpower", prc: "Perception",
  prs: "Personality", lck: "Luck",
});

/** Common target paths for Flat Modifiers. */
export const MODIFIER_TARGET_OPTIONS = Object.freeze({
  "system.hpBonus":       "Hit Points (HP+)",
  "system.spBonus":       "Stamina (SP+)",
  "system.mpBonus":       "Magicka (MP+)",
  "system.lpBonus":       "Luck Points (LP+)",
  "system.wtBonus":       "Wound Threshold (WT+)",
  "system.iniBonus":      "Initiative (INI+)",
  "system.speedBonus":    "Speed+",
  "system.swimBonus":     "Swim Speed+",
  "system.flyBonus":      "Fly Speed+",
  "system.diseaseR":      "Disease Resistance",
  "system.fireR":         "Fire Resistance",
  "system.frostR":        "Frost Resistance",
  "system.shockR":        "Shock Resistance",
  "system.poisonR":       "Poison Resistance",
  "system.magicR":        "Magic Resistance",
  "system.natToughnessR": "Natural Toughness",
  "system.silverR":       "Silver Resistance",
  "system.sunlightR":     "Sunlight Resistance",
  "system.characteristicBonus.strChaBonus": "Characteristic: STR",
  "system.characteristicBonus.endChaBonus": "Characteristic: END",
  "system.characteristicBonus.agiChaBonus": "Characteristic: AGI",
  "system.characteristicBonus.intChaBonus": "Characteristic: INT",
  "system.characteristicBonus.wpChaBonus":  "Characteristic: WP",
  "system.characteristicBonus.prcChaBonus": "Characteristic: PRC",
  "system.characteristicBonus.prsChaBonus": "Characteristic: PRS",
  "system.characteristicBonus.lckChaBonus": "Characteristic: LCK",
});

/** Boolean flag paths. */
export const FLAG_TARGET_OPTIONS = Object.freeze({
  "system.halfFatiguePenalty":  "½ Fatigue Penalty",
  "system.halfWoundPenalty":    "½ Wound Penalty",
  "system.addHalfSpeed":        "Add ½ Speed",
  "system.doubleSwimSpeed":     "Double Swim Speed",
  "system.untrainedException":  "No Untrained Combat Penalty",
  "system.halfSpeed":           "½ Speed",
  "system.mechanical":          "Define as Mechanical",
  "system.painIntolerant":      "Wound Penalty to -30 (Pain Intolerant)",
  "system.addIBToMP":           "Add IB to Magicka",
});

/** Override target paths. */
export const OVERRIDE_TARGET_OPTIONS = Object.freeze({
  "system.replace.ini.characteristic": "Replace Initiative Characteristic",
  "system.replace.wt.characteristic":  "Replace Wound Threshold Characteristic",
});

/** Test type options for DoS rules. */
export const TEST_TYPE_OPTIONS = Object.freeze({
  combatStyle: "Combat Style",
  skill:       "Specific Skill",
  any:         "Any Test",
});

/** TN modifier application targets. */
export const TN_APPLIES_TO_OPTIONS = Object.freeze({
  attacker:   "Attacker (Self)",
  defender:   "Defender (Enemy)",
  skill:      "Skill Test",
});

/** Damage types for damage bonus rules. */
export const DAMAGE_TYPE_OPTIONS = Object.freeze({
  physical: "Physical",
  fire:     "Fire",
  frost:    "Frost",
  shock:    "Shock",
  poison:   "Poison",
  magic:    "Magic",
  silver:   "Silver",
  sunlight: "Sunlight",
  untyped:  "Untyped",
});

/** Reroll scope options. */
export const REROLL_SCOPE_OPTIONS = Object.freeze({
  specific: "Specific Skill",
  any:      "Any Skill",
  endurance: "Endurance Only",
  willpower: "Willpower Only",
});

/** Defense types for override rules. */
export const DEFENSE_TYPE_OPTIONS = Object.freeze({
  parry:   "Parry",
  evade:   "Evade",
  block:   "Block",
  counter: "Counter Attack",
});

/** Attack mode options for conditions and defense overrides. */
export const ATTACK_MODE_OPTIONS = Object.freeze({
  melee:  "Melee",
  ranged: "Ranged",
  aoe:    "AoE",
  any:    "Any",
});

/** Duration mode options. */
export const DURATION_MODE_OPTIONS = Object.freeze({
  rounds: "Rounds",
  turns:  "Turns",
  encounter: "Encounter",
  shortRest: "Until Short Rest",
  longRest:  "Until Long Rest",
  permanent: "Permanent",
});

/** Spell school options. */
export const SPELL_SCHOOL_OPTIONS = Object.freeze({
  any:          "Any School",
  alteration:   "Alteration",
  conjuration:  "Conjuration",
  destruction:  "Destruction",
  illusion:     "Illusion",
  mysticism:    "Mysticism",
  necromancy:   "Necromancy",
  restoration:  "Restoration",
});

/** Sense loss reduction modes. */
export const SENSE_REDUCTION_OPTIONS = Object.freeze({
  halve:  "Halve Penalty",
  negate: "Negate Penalty",
});

/** Proximity comparison operators. */
export const PROXIMITY_OPERATOR_OPTIONS = Object.freeze({
  ">=": "≥ (at least)",
  "==": "= (exactly)",
  "<=": "≤ (at most)",
  ">":  "> (more than)",
  "<":  "< (fewer than)",
});

/** Proximity range categories. */
export const PROXIMITY_RANGE_OPTIONS = Object.freeze({
  melee:  "Melee Range (2m)",
  close:  "Close Range (10m)",
  medium: "Medium Range (25m)",
  any:    "Any Range",
});

/** Stacking options for per-element stacking override. */
export const STACKING_OPTIONS = Object.freeze({
  add:     "Additive",
  highest: "Highest Value",
  none:    "No Stacking",
  any:     "Any (Boolean)",
});

/** Spell modifier sub-categories. */
export const SPELL_CATEGORY_OPTIONS = Object.freeze({
  any:            "Any",
  conventional:   "Conventional",
  unconventional: "Unconventional",
});

/** DoS replacement source options. */
export const RANK_SOURCE_OPTIONS = Object.freeze({
  combatStyle: "Combat Style Rank",
  skill:       "Specific Skill Rank",
});

/** Workflow scope options for runtime gating. */
export const RULE_ELEMENT_WORKFLOW_OPTIONS = Object.freeze({
  all: "All Workflows",
  skill: "Skill Opposed",
  characteristic: "Characteristic Opposed",
  combat: "Combat Opposed",
  magic: "Magic Opposed"
});


// ─── Condition Type Registry ─────────────────────────────────────────

/**
 * Condition types gate when a rule element applies.
 * Each condition is evaluated at runtime; ALL conditions must pass (AND logic).
 */
export const CONDITION_TYPES = Object.freeze({
  proximity: {
    label: "Proximity (Opponents in Range)",
    icon: "fa-users",
    fields: {
      operator: { type: "select", label: "Operator",  options: "proximityOperatorOptions" },
      value:    { type: "number",  label: "Count",     default: 2 },
      range:    { type: "select",  label: "Range",     options: "proximityRangeOptions" },
    },
  },
  attackMode: {
    label: "Attack Mode",
    icon: "fa-sword",
    fields: {
      mode: { type: "select", label: "Mode", options: "attackModeOptions" },
    },
  },
  attackVariant: {
    label: "Attack Variant",
    icon: "fa-crosshairs",
    fields: {
      variant: { type: "select", label: "Variant", options: "attackVariantOptions" },
    },
  },
  hidden: {
    label: "Actor is Hidden",
    icon: "fa-eye-slash",
    fields: {},
  },
  inCombat: {
    label: "In Active Combat",
    icon: "fa-swords",
    fields: {},
  },
  skillTest: {
    label: "Specific Skill Test",
    icon: "fa-graduation-cap",
    fields: {
      skillName: { type: "text", label: "Skill Name" },
    },
  },
  weaponType: {
    label: "Weapon Type Equipped",
    icon: "fa-shield",
    fields: {
      mode: { type: "select", label: "Weapon", options: "attackModeOptions" },
    },
  },
  allyHasTalent: {
    label: "Ally Has Talent (in Range)",
    icon: "fa-handshake",
    fields: {
      talentName: { type: "text",   label: "Talent Name" },
      range:      { type: "select", label: "Range", options: "proximityRangeOptions" },
    },
  },
});


// ─── Rule Element Type Registry ──────────────────────────────────────

/**
 * Master registry of all rule element types.
 *
 * Each type defines:
 *  - label / description — for UI display
 *  - family — groups types in the "Add" dropdown
 *  - icon — FontAwesome icon class
 *  - fields — type-specific config fields (rendered in the UI)
 *  - defaultValues — default config for a new element of this type
 *
 * Field `options` values are keys into the option dictionaries returned by
 * getRuleElementOptions().
 */
export const RULE_ELEMENT_TYPES = Object.freeze({

  // ── Passive / Always-On ────────────────────────────────────────

  flatModifier: {
    label: "Flat Modifier",
    description: "Adds a numeric bonus or penalty to a target stat, resistance, or characteristic.",
    family: "Passive",
    icon: "fa-plus-minus",
    fields: {
      target:   { type: "select", label: "Target",   options: "modifierTargetOptions" },
      value:    { type: "number", label: "Value",     default: 0 },
      stacking: { type: "select", label: "Stacking",  options: "stackingOptions" },
    },
    defaultValues: { target: "system.hpBonus", value: 0, stacking: "add" },
  },

  booleanFlag: {
    label: "Boolean Flag",
    description: "Sets a boolean flag on the actor (e.g., ½ Fatigue Penalty, Double Swim Speed).",
    family: "Passive",
    icon: "fa-toggle-on",
    fields: {
      target: { type: "select",   label: "Flag",   options: "flagTargetOptions" },
      value:  { type: "checkbox",  label: "Active", default: true },
    },
    defaultValues: { target: "system.halfFatiguePenalty", value: true },
  },

  overrideValue: {
    label: "Override Value",
    description: "Overrides a derived value — e.g., replace Initiative characteristic or WT calculation.",
    family: "Passive",
    icon: "fa-arrows-rotate",
    fields: {
      target:        { type: "select", label: "Target",   options: "overrideTargetOptions" },
      characteristic: { type: "select", label: "Set To Characteristic", options: "characteristicOptions" },
    },
    defaultValues: { target: "system.replace.ini.characteristic", characteristic: "" },
  },

  // ── Combat / Workflow ──────────────────────────────────────────

  dosBonus: {
    label: "DoS Bonus",
    description: "Adds bonus Degrees of Success on a successful combat or skill test (e.g., Brawler +1 DoS with 2+ opponents).",
    family: "Combat",
    icon: "fa-arrow-up-1-9",
    fields: {
      bonus:    { type: "number", label: "DoS Bonus",   default: 1 },
      testType: { type: "select", label: "Test Type",    options: "testTypeOptions" },
      skillName: { type: "text",  label: "Skill Name (if Specific Skill)" },
    },
    defaultValues: { bonus: 1, testType: "combatStyle", skillName: "" },
  },

  dosReplacement: {
    label: "DoS Replacement Choice",
    description: "After a successful test, offers a choice: keep rolled DoS or use a skill rank instead (e.g., Champion, Tricky Fighter).",
    family: "Combat",
    icon: "fa-scale-balanced",
    fields: {
      useRankOf:  { type: "select", label: "Rank Source",  options: "rankSourceOptions" },
      skillName:  { type: "text",   label: "Skill Name (if Specific Skill)" },
    },
    defaultValues: { useRankOf: "combatStyle", skillName: "" },
  },

  tnModifier: {
    label: "TN Modifier",
    description: "Applies a bonus or penalty to Test Target Numbers (e.g., Precise +20 attacker TN, Lightning Reflexes -20 defender TN).",
    family: "Combat",
    icon: "fa-bullseye",
    fields: {
      value:     { type: "number", label: "TN Modifier",   default: 0 },
      appliesTo: { type: "select", label: "Applies To",     options: "tnAppliesToOptions" },
      skillName: { type: "text",   label: "Skill Name (if Skill Test)" },
    },
    defaultValues: { value: 0, appliesTo: "attacker", skillName: "" },
  },

  damageBonus: {
    label: "Damage Bonus",
    description: "Adds bonus damage to attacks. Can specify type and whether it ignores AR (e.g., Sneak Attack, Cryomancer +1 frost).",
    family: "Combat",
    icon: "fa-burst",
    fields: {
      formula:    { type: "text",     label: "Formula (e.g., @stealth.rank)" },
      flatValue:  { type: "number",   label: "Or Flat Value",  default: 0 },
      damageType: { type: "select",   label: "Damage Type",     options: "damageTypeOptions" },
      ignoresAR:  { type: "checkbox", label: "Ignores AR",      default: false },
    },
    defaultValues: { formula: "", flatValue: 0, damageType: "physical", ignoresAR: false },
  },

  wtDelta: {
    label: "Wound Threshold Delta",
    description: "Modifies the effective Wound Threshold of attacked enemies (e.g., Crippling Strikes WT−1).",
    family: "Combat",
    icon: "fa-heart-crack",
    fields: {
      delta: { type: "number", label: "WT Change", default: -1 },
    },
    defaultValues: { delta: -1 },
  },

  rerollEligibility: {
    label: "Reroll Grant",
    description: "Allows a single reroll of a failed test (e.g., Grandmaster for a specific skill, Die-Hard for Endurance).",
    family: "Combat",
    icon: "fa-dice",
    fields: {
      scope:     { type: "select", label: "Scope",     options: "rerollScopeOptions" },
      skillName: { type: "text",   label: "Skill Name (if Specific)" },
      maxUses:   { type: "number", label: "Max Per Test", default: 1 },
    },
    defaultValues: { scope: "specific", skillName: "", maxUses: 1 },
  },

  defenseOverride: {
    label: "Defense Override",
    description: "Unlocks or modifies defense options normally unavailable (e.g., Lightning Reflexes: Parry vs Ranged at −20).",
    family: "Combat",
    icon: "fa-shield-halved",
    fields: {
      allow:   { type: "select", label: "Allow Defense",  options: "defenseTypeOptions" },
      against: { type: "select", label: "Against",         options: "attackModeOptions" },
      tnMod:   { type: "number", label: "TN Modifier",     default: 0 },
    },
    defaultValues: { allow: "parry", against: "ranged", tnMod: 0 },
  },

  // ── Magic ──────────────────────────────────────────────────────

  spellModifier: {
    label: "Spell Modifier",
    description: "Modifies spell casting parameters — restraint WB, cost, effect values (e.g., Creative +1 WB, Mage Guard +1 Reinforce).",
    family: "Magic",
    icon: "fa-hat-wizard",
    fields: {
      restraintWbDelta: { type: "number", label: "Restraint WB Δ",   default: 0 },
      effectDelta:      { type: "number", label: "Effect Value Δ",    default: 0 },
      costDelta:        { type: "number", label: "Cost Δ (MP)",        default: 0 },
      spellSchool:      { type: "select", label: "School",             options: "spellSchoolOptions" },
      spellCategory:    { type: "select", label: "Category",           options: "spellCategoryOptions" },
    },
    defaultValues: { restraintWbDelta: 0, effectDelta: 0, costDelta: 0, spellSchool: "any", spellCategory: "any" },
  },

  // ── Sense / Condition ──────────────────────────────────────────

  senseLossReduction: {
    label: "Sense Loss Reduction",
    description: "Reduces or negates penalties from sense loss conditions like Blinded or Deafened (e.g., Honed Senses halves, One with All negates).",
    family: "Passive",
    icon: "fa-ear-listen",
    fields: {
      mode: { type: "select", label: "Mode", options: "senseReductionOptions" },
    },
    defaultValues: { mode: "halve" },
  },

  // ── Custom / General ───────────────────────────────────────────

  note: {
    label: "Note / Description",
    description: "Attach a descriptive note to document non-automated effects or homebrew behavior.",
    family: "General",
    icon: "fa-note-sticky",
    fields: {
      text: { type: "text", label: "Note Text" },
    },
    defaultValues: { text: "" },
  },
});

/**
 * Runtime support matrix for Rule Elements.
 * Drives sheet status labels and runtime phase/workflow gating.
 */
export const RULE_ELEMENT_RUNTIME_SUPPORT = Object.freeze({
  flatModifier:       Object.freeze({ status: "active", phases: ["actorPrep"], workflows: ["all"] }),
  booleanFlag:        Object.freeze({ status: "active", phases: ["actorPrep"], workflows: ["all"] }),
  overrideValue:      Object.freeze({ status: "active", phases: ["actorPrep"], workflows: ["all"] }),
  senseLossReduction: Object.freeze({ status: "active", phases: ["actorPrep"], workflows: ["all"] }),
  tnModifier:         Object.freeze({ status: "active", phases: ["preRoll"], workflows: ["all"] }),
  dosBonus:           Object.freeze({ status: "active", phases: ["postRoll"], workflows: ["all"] }),
  dosReplacement:     Object.freeze({ status: "active", phases: ["postRoll"], workflows: ["all"] }),
  damageBonus:        Object.freeze({ status: "active", phases: ["preDamage"], workflows: ["combat", "magic"] }),
  wtDelta:            Object.freeze({ status: "active", phases: ["preDamage"], workflows: ["combat", "magic"] }),
  defenseOverride:    Object.freeze({ status: "active", phases: ["preRoll"], workflows: ["combat", "magic"] }),
  rerollEligibility:  Object.freeze({ status: "active", phases: ["postRoll"], workflows: ["all"] }),
  spellModifier:      Object.freeze({ status: "active", phases: ["preRoll"], workflows: ["magic"] }),
  note:               Object.freeze({ status: "informational", phases: [], workflows: ["all"] })
});

/**
 * Clone-safe accessor for the runtime support matrix.
 * @returns {object}
 */
export function getRuleElementRuntimeSupport() {
  return _clone(RULE_ELEMENT_RUNTIME_SUPPORT);
}

/**
 * Normalize a persisted rule-element payload into a stable shape.
 * Preserves unknown fields for forward compatibility.
 *
 * @param {object} raw
 * @returns {object}
 */
export function normalizeRuleElement(raw = {}) {
  const input = (raw && typeof raw === "object") ? raw : {};
  const typeKey = String(input.type ?? "").trim();
  const typeDef = RULE_ELEMENT_TYPES[typeKey] ?? RULE_ELEMENT_TYPES.note;
  const type = RULE_ELEMENT_TYPES[typeKey] ? typeKey : "note";

  const normalized = {
    ...input,
    id: input.id ?? foundry.utils.randomID(16),
    type,
    label: String(input.label ?? typeDef.label ?? "Rule Element").trim() || typeDef.label || "Rule Element",
    enabled: input.enabled ?? true,
    conditions: _asArray(input.conditions).map(_normalizeCondition).filter(Boolean),
    workflows: _normalizeWorkflows(input.workflows),
    predicate: _normalizePredicate(input.predicate),
  };

  for (const [fieldKey, fieldDef] of Object.entries(typeDef.fields ?? {})) {
    if (normalized[fieldKey] == null && Object.prototype.hasOwnProperty.call(typeDef.defaultValues ?? {}, fieldKey)) {
      normalized[fieldKey] = _clone(typeDef.defaultValues[fieldKey]);
      continue;
    }
    if (normalized[fieldKey] == null && Object.prototype.hasOwnProperty.call(fieldDef ?? {}, "default")) {
      normalized[fieldKey] = _clone(fieldDef.default);
    }
  }

  return normalized;
}

function _requiresField(type, element, field) {
  if (type === "tnModifier" && field === "skillName") return _slug(element?.appliesTo) === "skill";
  if (type === "dosBonus" && field === "skillName") return _slug(element?.testType) === "skill";
  if (type === "dosReplacement" && field === "skillName") return _slug(element?.useRankOf) === "skill";
  if (type === "rerollEligibility" && field === "skillName") return _slug(element?.scope) === "specific";
  if (type === "defenseOverride" && field === "allow") return true;
  return false;
}

/**
 * Validate a rule element for authoring and runtime diagnostics.
 *
 * @param {object} raw
 * @param {object} [options]
 * @param {string|null} [options.workflow]
 * @param {string|null} [options.phase]
 * @returns {{valid:boolean, errors:Array, warnings:Array, element:object, support:object, eligible:boolean, eligibleByWorkflow:boolean, eligibleByPhase:boolean}}
 */
export function validateRuleElement(raw, { workflow = null, phase = null } = {}) {
  const element = normalizeRuleElement(raw);
  const typeDef = RULE_ELEMENT_TYPES[element.type];
  const support = RULE_ELEMENT_RUNTIME_SUPPORT[element.type] ?? { status: "planned", phases: [], workflows: ["all"] };
  const errors = [];
  const warnings = [];

  if (!typeDef) {
    warnings.push(`Unknown rule-element type "${element.type}" will be treated as note.`);
  }

  if (element.predicate != null && !isPredicate(element.predicate)) {
    errors.push("Predicate is invalid. Use a roll-option string, an array, or a single logic object.");
  }

  const fields = typeDef?.fields ?? {};
  for (const [fieldKey, fieldDef] of Object.entries(fields)) {
    const value = element[fieldKey];
    if (_requiresField(element.type, element, fieldKey) && (value == null || String(value).trim() === "")) {
      errors.push(`Field "${fieldDef.label ?? fieldKey}" is required for this configuration.`);
      continue;
    }
    if (fieldDef.type === "number" && value != null && value !== "" && !Number.isFinite(Number(value))) {
      errors.push(`Field "${fieldDef.label ?? fieldKey}" must be numeric.`);
      continue;
    }
    if (fieldDef.type === "select" && fieldDef.options) {
      const opts = getRuleElementOptions()[fieldDef.options] ?? null;
      if (opts && value != null && value !== "" && !Object.prototype.hasOwnProperty.call(opts, String(value))) {
        warnings.push(`Field "${fieldDef.label ?? fieldKey}" has an unknown option "${value}".`);
      }
    }
  }

  if (!Array.isArray(element.conditions)) {
    errors.push("Conditions must be an array.");
  }

  for (const cond of element.conditions) {
    const condType = String(cond?.type ?? "").trim();
    if (!condType) {
      errors.push("Condition entry is missing a type.");
      continue;
    }
    const condDef = CONDITION_TYPES[condType];
    if (!condDef) {
      warnings.push(`Condition type "${condType}" is not recognized; runtime will treat it as residual.`);
      continue;
    }
    for (const [fieldKey, fieldDef] of Object.entries(condDef.fields ?? {})) {
      const value = cond[fieldKey];
      if (fieldDef.type === "number" && value != null && value !== "" && !Number.isFinite(Number(value))) {
        errors.push(`Condition "${condDef.label}" field "${fieldDef.label ?? fieldKey}" must be numeric.`);
      }
    }
  }

  const wf = workflow ? _slug(workflow) : null;
  const ph = phase ? normalizeRulePhase(phase, { fallback: "" }) : null;
  const scope = _normalizeWorkflows(element.workflows);
  const supportWorkflows = Array.isArray(support.workflows) ? support.workflows : ["all"];
  const supportPhases = _normalizeSupportPhases(support.phases);

  const eligibleByWorkflow = !wf
    ? true
    : (scope.includes("all") || scope.includes(wf))
      && (supportWorkflows.includes("all") || supportWorkflows.includes(wf));
  const eligibleByPhase = !ph || supportPhases.includes(ph);
  const eligible = eligibleByWorkflow && eligibleByPhase && support.status !== "informational";

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    element,
    support,
    eligible,
    eligibleByWorkflow,
    eligibleByPhase
  };
}


// ─── Family grouping for the "Add Rule Element" dropdown ─────────────

/**
 * Returns rule element types grouped by family for the "Add" dropdown.
 * @returns {object} { familyName: [{ key, label, description, icon }] }
 */
export function getRuleElementTypesByFamily() {
  const grouped = {};
  for (const [key, def] of Object.entries(RULE_ELEMENT_TYPES)) {
    const fam = def.family || "General";
    if (!grouped[fam]) grouped[fam] = [];
    grouped[fam].push({ key, label: def.label, description: def.description, icon: def.icon });
  }
  return grouped;
}


// ─── Defaults & Factories ────────────────────────────────────────────

/**
 * Create a new blank rule element of the given type.
 * @param {string} type - Key from RULE_ELEMENT_TYPES
 * @returns {object} A new rule element object with a unique ID.
 */
export function createRuleElement(type) {
  const def = RULE_ELEMENT_TYPES[type];
  if (!def) {
    console.warn(`uesrpg-3ev4 | rule-elements: unknown type "${type}"`);
    return null;
  }
  return {
    id: foundry.utils.randomID(16),
    type,
    label: def.label,
    enabled: true,
    ...(def.defaultValues ? structuredClone(def.defaultValues) : {}),
    conditions: [],
    workflows: ["all"],
    predicate: null
  };
}

/**
 * Create a new blank condition of the given type.
 * @param {string} type - Key from CONDITION_TYPES
 * @returns {object|null}
 */
export function createCondition(type) {
  const def = CONDITION_TYPES[type];
  if (!def) return null;
  const cond = { type };
  for (const [fk, fdef] of Object.entries(def.fields)) {
    cond[fk] = fdef.default ?? (fdef.type === "number" ? 0 : "");
  }
  return cond;
}


// ─── Flag Read / Write helpers ───────────────────────────────────────

/**
 * Read the rule elements array from an item's flags.
 * Always returns a safe array (never null/undefined).
 *
 * @param {Item} item
 * @returns {object[]}
 */
export function getRuleElements(item) {
  if (!item) return [];
  const raw = item.getFlag?.(SYSTEM_ID, FLAG_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.map((el) => normalizeRuleElement(el));
}

/**
 * Persist the full rule elements array to an item's flags.
 * Replaces the entire array (flag-level atomic write).
 *
 * @param {Item} item
 * @param {object[]} elements
 * @returns {Promise}
 */
export async function setRuleElements(item, elements) {
  if (!item) return;
  const safe = Array.isArray(elements) ? elements.map((el) => normalizeRuleElement(el)) : [];
  return requestUpdateDocument(item, { [`flags.${SYSTEM_ID}.${FLAG_KEY}`]: safe });
}

// ─── RE-authoritative deduplication ──────────────────────────────────

/**
 * Determine whether an item has at least one enabled Rule Element of the
 * given type family.  When true, the Rule Element runtime is the
 * authoritative handler for that effect family and the corresponding
 * hardcoded interceptor should yield (skip).
 *
 * This is a **read-time computed check** — nothing is persisted.
 *
 * @param {Item} item        Feature item (trait / talent / power)
 * @param {string} reType    Rule Element type key (e.g. "tnModifier", "dosBonus")
 * @returns {boolean}
 */
export function isREAuthoritative(item, reType) {
  if (!item || !reType) return false;
  const elements = getRuleElements(item);
  if (!elements.length) return false;
  const targetType = String(reType).trim();
  return elements.some(
    (el) => el.enabled !== false && String(el.type ?? "") === targetType
  );
}

/**
 * Convenience: check whether a talent (looked up by slug from an actor)
 * has RE-authoritative coverage for a given type, **and** the corresponding
 * workflow runtime is currently enabled.
 *
 * Used by interceptor functions to decide whether to yield to the RE runtime.
 *
 * @param {Actor} actor
 * @param {string} talentSlug  Slug used by `getTalentItem(actor, slug)`
 * @param {string} reType      Rule Element type key
 * @param {string} workflow    Workflow key ("combat" | "magic" | "skill" | "characteristic")
 * @param {Function} getTalentItemFn  Reference to talents-api.getTalentItem (injected to avoid circular deps)
 * @returns {boolean}
 */
export function shouldYieldToRE(actor, talentSlug, reType, workflow, getTalentItemFn) {
  if (!actor || !talentSlug || !reType || !workflow) return false;
  if (typeof getTalentItemFn !== "function") return false;

  // Check whether the workflow runtime is actually enabled.
  // Import-free check: read settings directly.
  try {
    const WORKFLOW_SETTINGS = {
      skill: "enableRuleElementsRuntimeSkill",
      characteristic: "enableRuleElementsRuntimeCharacteristic",
      combat: "enableRuleElementsRuntimeCombat",
      magic: "enableRuleElementsRuntimeMagic"
    };
    const masterOn = Boolean(game?.settings?.get?.(SYSTEM_ID, "enableRuleElementsRuntime"));
    const wfKey = WORKFLOW_SETTINGS[String(workflow).toLowerCase()];
    if (!masterOn || !wfKey) return false;
    const wfOn = Boolean(game?.settings?.get?.(SYSTEM_ID, wfKey));
    if (!wfOn) return false;
  } catch (_e) {
    return false;
  }

  const talentItem = getTalentItemFn(actor, talentSlug);
  if (!talentItem) return false;
  return isREAuthoritative(talentItem, reType);
}


// ─── Options for template selects ────────────────────────────────────

/**
 * Returns all option dictionaries needed by the rule-elements partial.
 * @returns {object}
 */
export function getRuleElementOptions() {
  return {
    modifierTargetOptions:     MODIFIER_TARGET_OPTIONS,
    flagTargetOptions:         FLAG_TARGET_OPTIONS,
    overrideTargetOptions:     OVERRIDE_TARGET_OPTIONS,
    characteristicOptions:     CHARACTERISTIC_OPTIONS,
    testTypeOptions:           TEST_TYPE_OPTIONS,
    tnAppliesToOptions:        TN_APPLIES_TO_OPTIONS,
    damageTypeOptions:         DAMAGE_TYPE_OPTIONS,
    rerollScopeOptions:        REROLL_SCOPE_OPTIONS,
    defenseTypeOptions:        DEFENSE_TYPE_OPTIONS,
    attackModeOptions:         ATTACK_MODE_OPTIONS,
    durationModeOptions:       DURATION_MODE_OPTIONS,
    spellSchoolOptions:        SPELL_SCHOOL_OPTIONS,
    spellCategoryOptions:      SPELL_CATEGORY_OPTIONS,
    senseReductionOptions:     SENSE_REDUCTION_OPTIONS,
    proximityOperatorOptions:  PROXIMITY_OPERATOR_OPTIONS,
    proximityRangeOptions:     PROXIMITY_RANGE_OPTIONS,
    stackingOptions:           STACKING_OPTIONS,
    rankSourceOptions:         RANK_SOURCE_OPTIONS,
    workflowOptions:           RULE_ELEMENT_WORKFLOW_OPTIONS,
    attackVariantOptions: Object.freeze({
      standard:  "Standard",
      precision: "Precision",
    }),
  };
}
