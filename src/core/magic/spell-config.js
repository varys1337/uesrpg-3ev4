/**
 * @module spell-config
 * src/core/magic/spell-config.js
 *
 * Consolidated spell configuration module: validation, scaling, and normalization.
 *
 * Merges:
 *  - scaling-validator.js    → validateScalingLevels, formatValidationMessage
 *  - spell-config-validator.js → validateSpellConfig, formatSpellValidationMessage, getSpellCoverageReport
 *  - normalize-spell-config.js → normalizeSpellConfig, getEngineDefaults, + option getters
 *
 * Design:
 *  - Never writes/mutates objects — read-only normalization & validation.
 *  - Adapts legacy fields to canonical shape.
 *  - Fills defaults for missing engine fields.
 *
 * Target: Foundry VTT v13.351
 */

// ── Shared Private Helpers ───────────────────────────────────────────────────

import { _num, _strTrim as _str } from "./_primitives.js";
import { _bool } from "../../utils/coerce.js";

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Scaling Validation (from scaling-validator.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate scaling levels for consistency and RAW compliance.
 *
 * Validation Rules:
 * 1. Level values must be 1-7
 * 2. Level values must be unique within the array
 * 3. Cost must be >= 0
 * 4. If spell has damage, scaling entries should have damageFormula (warning)
 * 5. Duration unit consistency (warning)
 *
 * @param {Array} levels - Array of scaling level objects
 * @param {object} [options] - Validation options
 * @param {boolean} [options.spellHasDamage] - Whether parent spell has damage
 * @param {string} [options.baseDurationUnit] - Base spell duration unit for consistency checks
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateScalingLevels(levels, options = {}) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(levels) || levels.length === 0) {
    return { valid: true, errors: [], warnings: [] }; // No scaling is valid
  }

  // Rule 1: Level values must be 1-7
  for (const [idx, entry] of levels.entries()) {
    const lvl = _num(entry.level, NaN); // NaN intentional: level MUST be numeric
    if (!Number.isFinite(lvl) || lvl < 1 || lvl > 7) {
      errors.push(`Scaling entry ${idx + 1}: Level must be 1-7 (got ${entry.level})`);
    }
  }

  // Rule 2: Level values must be unique
  const usedLevels = new Set();
  for (const [idx, entry] of levels.entries()) {
    const lvl = _num(entry.level, NaN);
    if (Number.isFinite(lvl)) {
      if (usedLevels.has(lvl)) {
        errors.push(`Scaling entry ${idx + 1}: Duplicate level ${lvl}`);
      }
      usedLevels.add(lvl);
    }
  }

  // Rule 3: Cost must be >= 0
  for (const [idx, entry] of levels.entries()) {
    const cost = _num(entry.cost, NaN); // NaN intentional: cost MUST be numeric
    if (!Number.isFinite(cost) || cost < 0) {
      errors.push(`Scaling entry ${idx + 1}: Cost must be >= 0 (got ${entry.cost})`);
    }
  }

  // Rule 4: If spell has damage, scaling entries should have damageFormula (warning)
  if (options.spellHasDamage) {
    for (const [idx, entry] of levels.entries()) {
      if (!entry.damageFormula || entry.damageFormula.trim() === "") {
        warnings.push(`Scaling entry ${idx + 1}: Missing damageFormula (spell has damage)`);
      }
    }
  }

  // Rule 5: Duration unit consistency (warning)
  if (options.baseDurationUnit && options.baseDurationUnit !== "instant") {
    for (const [idx, entry] of levels.entries()) {
      const unit = entry.duration?.unit;
      if (unit && unit !== options.baseDurationUnit && unit !== "instant") {
        warnings.push(`Scaling entry ${idx + 1}: Duration unit "${unit}" differs from base "${options.baseDurationUnit}"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Format scaling validation result as user-friendly HTML message.
 * @param {{valid: boolean, errors: string[], warnings: string[]}} result
 * @returns {string}
 */
export function formatValidationMessage(result) {
  if (result.valid && result.warnings.length === 0) {
    return "Scaling levels valid.";
  }

  const parts = [];

  if (result.errors.length > 0) {
    parts.push(`<strong>Errors:</strong><ul>${result.errors.map(e => `<li>${e}</li>`).join('')}</ul>`);
  }

  if (result.warnings.length > 0) {
    parts.push(`<strong>Warnings:</strong><ul>${result.warnings.map(w => `<li>${w}</li>`).join('')}</ul>`);
  }

  return parts.join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Spell Config Validation (from spell-config-validator.js)
// ═══════════════════════════════════════════════════════════════════════════════

/** @private Known modifier key prefixes for validation */
const KNOWN_MODIFIER_PREFIXES = [
  "system.modifiers.",
  "system.characteristics.",
  "system.combat_tracking.",
  "system.hp.",
  "system.magicka.",
  "system.stamina."
];

/**
 * Validate a complete spell item configuration.
 *
 * @param {Item} item - Spell item document
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateSpellConfig(item) {
  const errors = [];
  const warnings = [];

  if (!item || item.type !== "spell") {
    errors.push("Not a spell item.");
    return { valid: false, errors, warnings };
  }

  const sys = item.system ?? {};

  _validateMetadata(sys, errors, warnings);
  _validateCasting(sys, errors, warnings);
  _validateTargeting(sys, errors, warnings);
  _validateRangeAndAoE(sys, errors, warnings);
  _validateDurationUpkeep(sys, errors, warnings);
  _validateOverTime(sys, errors, warnings);
  _validateRune(sys, errors, warnings);
  _validateZone(sys, errors, warnings);
  _validateSummon(sys, errors, warnings);
  _validateScaling(sys, errors, warnings);
  _validateEffects(sys, errors, warnings);
  _validatePersistence(sys, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Format validation results as HTML for Dialog display.
 * @param {{ errors: string[], warnings: string[] }} result
 * @returns {string}
 */
export function formatSpellValidationMessage(result) {
  const parts = [];
  if (result.errors.length > 0) {
    parts.push('<div class="spell-validation-errors"><h4 style="color: #c00; margin: 4px 0;">Errors (block save)</h4><ul>');
    for (const e of result.errors) {
      parts.push(`<li style="color: #c00;">${_escapeHtml(e)}</li>`);
    }
    parts.push("</ul></div>");
  }
  if (result.warnings.length > 0) {
    parts.push('<div class="spell-validation-warnings"><h4 style="color: #a60; margin: 4px 0;">Warnings</h4><ul>');
    for (const w of result.warnings) {
      parts.push(`<li style="color: #a60;">${_escapeHtml(w)}</li>`);
    }
    parts.push("</ul></div>");
  }
  return parts.join("");
}

/**
 * Get a coverage report for QA display.
 * Shows which engine capabilities are configured vs unconfigured.
 *
 * @param {Item} item - Spell item
 * @returns {Array<{capability: string, configured: boolean, details: string}>}
 */
export function getSpellCoverageReport(item) {
  const sys = item?.system ?? {};
  const report = [];

  report.push({
    capability: "School & Level",
    configured: !!_str(sys.school) && _num(sys.level) > 0,
    details: _str(sys.school) ? `${sys.school} L${sys.level}` : "Not set"
  });

  report.push({
    capability: "Spell Type",
    configured: !!_str(sys.spellType),
    details: _str(sys.spellType) || "Not set"
  });

  report.push({
    capability: "Cost",
    configured: _num(sys.cost) > 0,
    details: `${_num(sys.cost)} MP`
  });

  report.push({
    capability: "Damage",
    configured: !!_str(sys.damageFormula),
    details: _str(sys.damageFormula) ? `${sys.damageFormula} (${sys.damageType})` : "None"
  });

  report.push({
    capability: "Range & Delivery",
    configured: !!_str(sys.rangeType) && sys.rangeType !== "none",
    details: _str(sys.rangeType) || "None"
  });

  const dur = sys.duration ?? {};
  const durUnit = _str(dur.unit);
  report.push({
    capability: "Duration",
    configured: durUnit !== "" && durUnit !== "instant",
    details: durUnit === "instant" ? "Instant" : `${_num(dur.value)} ${durUnit}`
  });

  report.push({
    capability: "Upkeep",
    configured: _bool(sys.hasUpkeep),
    details: _bool(sys.hasUpkeep) ? "Enabled" : "Disabled"
  });

  report.push({
    capability: "Overload",
    configured: _bool(sys.hasOverload),
    details: _bool(sys.hasOverload) ? (_str(sys.overloadBonusDamage) || "Enabled") : "Disabled"
  });

  report.push({
    capability: "Reinforce",
    configured: _bool(sys.hasReinforce),
    details: _bool(sys.hasReinforce) ? "Enabled" : "Disabled"
  });

  report.push({
    capability: "Scaling Levels",
    configured: Array.isArray(sys.scaling?.levels) && sys.scaling.levels.length > 0,
    details: `${Array.isArray(sys.scaling?.levels) ? sys.scaling.levels.length : 0} tiers`
  });

  report.push({
    capability: "OverTime",
    configured: _bool(sys.hasOverTime),
    details: _bool(sys.hasOverTime) ? `${_str(sys.overTime?.trigger)} / ${_str(sys.overTime?.payloadType)}` : "Disabled"
  });

  report.push({
    capability: "Zone/Persistent",
    configured: _bool(sys.isZonePersistent),
    details: _bool(sys.isZonePersistent) ? "Enabled" : "Disabled"
  });

  report.push({
    capability: "Rune/Trap",
    configured: _bool(sys.isRuneSpell),
    details: _bool(sys.isRuneSpell) ? `Trigger: ${_str(sys.runeTriggerType) || "none"}` : "Disabled"
  });

  report.push({
    capability: "Summon",
    configured: _bool(sys.isSummonSpell),
    details: _bool(sys.isSummonSpell) ? "Enabled" : "Disabled"
  });

  const engine = sys.engine ?? {};
  report.push({
    capability: "Effect Recipes",
    configured: Array.isArray(engine.effects?.recipes) && engine.effects.recipes.length > 0,
    details: `${Array.isArray(engine.effects?.recipes) ? engine.effects.recipes.length : 0} recipes`
  });

  report.push({
    capability: "Dispel Policy",
    configured: !!_str(engine.persistence?.dispelStrength),
    details: _str(engine.persistence?.dispelStrength) || "level (default)"
  });

  report.push({
    capability: "Embedded AEs",
    configured: (item.effects?.size ?? 0) > 0,
    details: `${item.effects?.size ?? 0} effects`
  });

  return report;
}

// ── Private spell validators ─────────────────────────────────────────────────

function _validateMetadata(sys, errors, warnings) {
  if (_num(sys.level) < 1 || _num(sys.level) > 7) {
    warnings.push("Spell level should be 1–7.");
  }
  if (!_str(sys.school)) {
    warnings.push("No school selected.");
  }
}

function _validateCasting(sys, errors, warnings) {
  if (_num(sys.cost) < 0) {
    errors.push("Cost cannot be negative.");
  }
  if (_bool(sys.hasOverload) && !_str(sys.overloadBonusDamage) && !_str(sys.overloadEffect)) {
    warnings.push("Overload enabled but no bonus damage or effect description set.");
  }
  if (_bool(sys.isDamagingSpell) && !_str(sys.damageFormula)) {
    warnings.push("Marked as damaging but no damage formula set.");
  }
  if (_str(sys.damageFormula) && !_bool(sys.isAttackSpell) && !_bool(sys.isDirect)) {
    warnings.push("Has damage formula but is neither Attack nor Direct spell.");
  }
}

function _validateTargeting(sys, errors, warnings) {
  const engine = sys.engine?.targeting;
  if (!engine) return;
  const mode = _str(engine.mode);
  if (mode === "multi" && _num(engine.maxTargets) < 2) {
    warnings.push("Multi-target mode but maxTargets < 2.");
  }
}

function _validateRangeAndAoE(sys, errors, warnings) {
  const rangeType = _str(sys.rangeType);
  if (rangeType === "aoe") {
    if (_num(sys.aoeSize) <= 0) {
      errors.push("AoE requires size > 0.");
    }
    const shape = _str(sys.aoeShape);
    if (shape === "ray" && _num(sys.aoeWidth) <= 0) {
      warnings.push("Ray AoE should have width > 0.");
    }
    if (shape === "rect" && (_num(sys.aoeSize) <= 0 || _num(sys.aoeWidth) <= 0)) {
      warnings.push("Rectangle AoE should have both size and width > 0.");
    }
  }
  if (rangeType === "ranged" && !_str(sys.range)) {
    warnings.push("Ranged spell but no range value specified.");
  }
}

function _validateDurationUpkeep(sys, errors, warnings) {
  const dur = sys.duration ?? {};
  const unit = _str(dur.unit);
  const value = _num(dur.value);

  if (_bool(sys.hasUpkeep)) {
    if (unit === "instant") {
      errors.push("Upkeep requires non-instant duration.");
    }
  }
  if (unit !== "instant" && unit !== "permanent" && value <= 0) {
    warnings.push(`Duration unit is "${unit}" but value is 0 — effectively instant.`);
  }
}

function _validateOverTime(sys, errors, warnings) {
  if (!_bool(sys.hasOverTime)) return;
  const ot = sys.overTime ?? {};

  if (!_str(ot.trigger)) {
    errors.push("OverTime enabled but no trigger set.");
  }
  const payloadType = _str(ot.payloadType);
  if (!payloadType) {
    errors.push("OverTime enabled but no payload type set.");
  }
  if ((payloadType === "damage" || payloadType === "heal") && !_str(ot.formula)) {
    errors.push("OverTime damage/heal requires a formula.");
  }
  if (payloadType === "saveThenApply") {
    if (!_str(ot.saveKey)) {
      errors.push("OverTime save requires a save characteristic.");
    }
    if (_num(ot.saveTN) <= 0) {
      warnings.push("OverTime save TN is 0 — targets always succeed.");
    }
  }
  if (!_str(ot.label)) {
    warnings.push("OverTime has no label (recommended for chat clarity).");
  }

  const dur = sys.duration ?? {};
  if (_str(dur.unit) === "instant" && !_bool(sys.hasUpkeep)) {
    warnings.push("OverTime on an instant spell with no upkeep may never trigger.");
  }
}

function _validateRune(sys, errors, warnings) {
  if (!_bool(sys.isRuneSpell)) return;
  const triggerType = _str(sys.runeTriggerType);
  if (!triggerType) {
    warnings.push("Rune enabled but no trigger type selected.");
  }
  if (triggerType === "proximity" && _num(sys.runeTriggerRadius) <= 0) {
    errors.push("Proximity rune requires trigger radius > 0.");
  }
  if (triggerType === "time" && _num(sys.runeTriggerDelay) <= 0) {
    warnings.push("Timed rune has delay of 0 — triggers immediately.");
  }

  if (_str(sys.rangeType) !== "aoe") {
    warnings.push("Rune spell without AoE range — detonation may have no area.");
  }
}

function _validateZone(sys, errors, warnings) {
  if (!_bool(sys.isZonePersistent)) return;
  if (_str(sys.rangeType) !== "aoe") {
    errors.push("Persistent Zone requires AoE range type.");
  }
  const dur = sys.duration ?? {};
  if (_str(dur.unit) === "instant") {
    warnings.push("Persistent Zone with instant duration — zone persists indefinitely?");
  }
}

function _validateSummon(sys, errors, warnings) {
  if (!_bool(sys.isSummonSpell)) return;
  if (_num(sys.mindlockValue) <= 0) {
    warnings.push("Summon spell has no Mindlock AP reduction.");
  }
}

function _validateScaling(sys, errors, warnings) {
  const levels = sys?.scaling?.levels;
  if (!Array.isArray(levels) || levels.length === 0) return;

  const spellHasDamage = !!_str(sys.damageFormula);
  const baseDurationUnit = _str(sys.duration?.unit) || "instant";

  const result = validateScalingLevels(levels, { spellHasDamage, baseDurationUnit });
  errors.push(...result.errors);
  warnings.push(...result.warnings);
}

function _validateEffects(sys, errors, warnings) {
  const recipes = sys?.engine?.effects?.recipes;
  if (!Array.isArray(recipes) || recipes.length === 0) return;

  for (const [idx, recipe] of recipes.entries()) {
    if (!recipe || typeof recipe !== "object") continue;
    const key = _str(recipe.key);
    if (!key) {
      errors.push(`Effect recipe ${idx + 1}: missing modifier key.`);
      continue;
    }
    const matchesKnown = KNOWN_MODIFIER_PREFIXES.some(p => key.startsWith(p));
    if (!matchesKnown) {
      warnings.push(`Effect recipe ${idx + 1}: key "${key}" may not be a recognized modifier.`);
    }
    const mode = _str(recipe.mode);
    if (!["add", "override", "multiply"].includes(mode)) {
      errors.push(`Effect recipe ${idx + 1}: invalid mode "${mode}".`);
    }
    if (_str(recipe.value) === "") {
      errors.push(`Effect recipe ${idx + 1}: missing value.`);
    }
  }
}

function _validatePersistence(sys, errors, warnings) {
  const engine = sys?.engine?.persistence;
  if (!engine) return;
  const strength = _str(engine.dispelStrength);
  if (strength === "fixed" && _num(engine.dispelFixedValue) <= 0) {
    warnings.push("Dispel strength is 'fixed' but value is 0.");
  }
  const dur = sys.duration ?? {};
  if (_str(dur.unit) === "instant" && strength !== "level") {
    warnings.push("Instant spell with non-default dispel policy — may be unnecessary.");
  }
}

/** @private */
function _escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Spell Config Normalization (from normalize-spell-config.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Frozen engine defaults for spell configuration.
 * @type {Readonly<object>}
 */
const ENGINE_DEFAULTS = Object.freeze({
  targeting: Object.freeze({
    mode: "single",
    maxTargets: 1
  }),
  effects: Object.freeze({
    recipes: [],
    stackingPolicy: "replace",
    ownershipPolicy: "target"
  }),
  persistence: Object.freeze({
    dispelStrength: "level",
    dispelFixedValue: 0
  }),
  summon: Object.freeze({
    actorUuid: "",
    quantity: 1
  }),
  conjure: Object.freeze({
    mode: "none",
    itemUuid: "",
    itemLabel: "",
    actorUuid: "",
    actorLabel: "",
    bindingCharacteristic: "wp",
    bindingModifier: 0,
    summonItems: null,
    summonActors: null
  }),
  disintegrate: Object.freeze({
    enabled: false,
    target: "armor"
  }),
  drain: Object.freeze({
    enabled: false,
    type: "none",
    transferToCaster: false
  }),
  defenseModel: "opposed",
  characteristicDefense: Object.freeze({
    defenderCharacteristic: "end",
    modifierMode: "spellStrength",
    modifierFormula: "",
    onSuccess: "negate",
    onFailure: "consequences"
  }),
  consequences: Object.freeze({
    staminaDelta: 0,
    healthDelta: 0,
    magickaDelta: 0,
    applyCondition: "",
    description: ""
  }),
  cloak: Object.freeze({
    enabled: false,
    range: 1,
    excludeSelf: true,
    requireAttackTest: false,
    useSpellDamage: true
  })
});

/**
 * Produce a canonical SpellConfigNormalized from a spell item.
 * Pure read — no side effects or item mutations.
 *
 * @param {Item} item - Spell item document
 * @returns {object} Normalized spell configuration
 * @throws {Error} If item is not a spell
 */
export function normalizeSpellConfig(item) {
  if (!item || item.type !== "spell") {
    throw new Error("normalizeSpellConfig: requires a spell item");
  }

  const sys = item.system ?? {};

  return {
    identity: {
      name: _str(item.name),
      img: _str(item.img),
      uuid: _str(item.uuid)
    },
    metadata: {
      school: _str(sys.school),
      form: _str(sys.form),
      spellType: _normalizeSpellType(sys.spellType),
      level: Math.max(0, Math.min(7, _num(sys.level, 0)))
    },
    casting: {
      cost: _num(sys.cost, 0),
      isInstant: _bool(sys.isInstant),
      isDirect: _bool(sys.isDirect),
      isAttack: _bool(sys.isAttackSpell),
      isDamaging: _bool(sys.isDamagingSpell) || _hasDamageFormula(sys),
      hasUpkeep: _bool(sys.hasUpkeep),
      hasOverload: _bool(sys.hasOverload),
      hasReinforce: _bool(sys.hasReinforce),
      overloadEffect: _str(sys.overloadEffect),
      overloadBonusDamage: _str(sys.overloadBonusDamage),
      reinforceDescription: _str(sys.reinforceDescription)
    },
    damage: {
      formula: _str(sys.damageFormula),
      type: _normalizeDamageType(sys.damageType),
      isHealing: _isHealingType(sys.damageType)
    },
    targeting: _normalizeTargetingConfig(sys),
    range: {
      type: _normalizeRangeType(sys.rangeType),
      text: _str(sys.range)
    },
    aoe: {
      shape: _str(sys.aoeShape) || "circle",
      size: _num(sys.aoeSize, 0),
      width: _num(sys.aoeWidth, 0),
      pulse: _bool(sys.aoePulse),
      includeCaster: _bool(sys.aoeIncludeCaster)
    },
    duration: _normalizeDuration(sys.duration),
    mindlock: {
      value: _num(sys.mindlockValue, 0)
    },
    rune: {
      isRune: _bool(sys.isRuneSpell),
      triggerType: _str(sys.runeTriggerType),
      triggerRadius: _num(sys.runeTriggerRadius, 3),
      triggerDelay: _num(sys.runeTriggerDelay, 0)
    },
    summon: _normalizeSummon(sys),
    conjure: _normalizeConjure(sys),
    zone: {
      isPersistent: _bool(sys.isZonePersistent)
    },
    overTime: _normalizeOverTime(sys),
    scaling: _normalizeScaling(sys.scaling),
    effects: _normalizeEffectsConfig(sys),
    persistence: _normalizePersistenceConfig(sys),
    disintegrate: _normalizeDisintegrate(sys),
    drain: _normalizeDrain(sys),
    defenseModel: _normalizeDefenseModel(sys),
    characteristicDefense: _normalizeCharacteristicDefense(sys),
    consequences: _normalizeConsequences(sys),
    cloak: _normalizeCloak(sys)
  };
}

/**
 * Get the engine defaults for use in templates/prepare.
 * @returns {object} Deep clone of ENGINE_DEFAULTS
 */
export function getEngineDefaults() {
  return structuredClone(ENGINE_DEFAULTS);
}

// ── Option Getters (select dropdown options for UI) ──────────────────────────

/**
 * Get available stacking policies for select options.
 * @returns {object}
 */
export function getStackingPolicyOptions() {
  return {
    replace: "Replace (remove old, apply new)",
    stack: "Stack (add to existing)",
    refresh: "Refresh (reset duration, keep changes)"
  };
}

/**
 * Get available ownership policies for select options.
 * @returns {object}
 */
export function getOwnershipPolicyOptions() {
  return {
    target: "Apply to Target(s)",
    self: "Apply to Caster",
    both: "Apply to Both"
  };
}

/**
 * Get available dispel strength modes.
 * @returns {object}
 */
export function getDispelStrengthOptions() {
  return {
    level: "Spell Level (default)",
    fixed: "Fixed Value",
    immune: "Cannot be Dispelled"
  };
}

/**
 * Get available targeting modes.
 * @returns {object}
 */
export function getTargetingModeOptions() {
  return {
    self: "Self Only",
    single: "Single Target",
    multi: "Multiple Targets",
    template: "Template / AoE"
  };
}

/**
 * Get available effect recipe modes.
 * @returns {object}
 */
export function getEffectRecipeModeOptions() {
  return {
    add: "Add (numeric bonus)",
    override: "Override (set value)",
    multiply: "Multiply (factor)"
  };
}

/**
 * Get available conjuration mode options.
 * @returns {object}
 */
export function getConjureModeOptions() {
  return {
    none: "None",
    item: "Conjure Item (Any Type)",
    creature: "Summon Creature",
    sunder: "Sunder Binding"
  };
}

/**
 * Get available disintegrate target type options.
 * @returns {object}
 */
export function getDisintegrateTargetOptions() {
  return {
    armor: "Armor / Shield",
    weapon: "Weapon"
  };
}

/**
 * Get available drain type options.
 * @returns {object}
 */
export function getDrainTypeOptions() {
  return {
    none: "None",
    magicka: "Magicka (current pool)",
    health: "Health (current pool)"
  };
}

/**
 * Get available characteristic options for binding tests.
 * @returns {object}
 */
export function getBindingCharacteristicOptions() {
  return {
    str: "Strength (STR)",
    end: "Endurance (END)",
    agi: "Agility (AGI)",
    int: "Intelligence (INT)",
    wp: "Willpower (WP)",
    prc: "Perception (PRC)",
    prs: "Personality (PRS)",
    lck: "Luck (LCK)"
  };
}

/**
 * Get defense model options.
 * @returns {object}
 */
export function getDefenseModelOptions() {
  return {
    opposed: "Opposed (Block / Evade / Ward)",
    characteristic: "Characteristic Defense Test"
  };
}

/**
 * Get characteristic defense on-success options.
 * @returns {object}
 */
export function getCharacteristicDefenseSuccessOptions() {
  return {
    negate: "Negate (no effect)",
    halve: "Halve consequences",
    endEffect: "End spell effect"
  };
}

/**
 * Get characteristic defense on-failure options.
 * @returns {object}
 */
export function getCharacteristicDefenseFailureOptions() {
  return {
    consequences: "Apply consequences",
    damage: "Apply spell damage"
  };
}

/**
 * Get available condition options for consequence payloads.
 * @returns {object}
 */
export function getConsequenceConditionOptions() {
  return {
    "": "None",
    dazed: "Dazed",
    stunned: "Stunned",
    prone: "Prone",
    blinded: "Blinded",
    deafened: "Deafened",
    frightened: "Frightened",
    poisoned: "Poisoned",
    paralyzed: "Paralyzed"
  };
}

// ── Private normalization helpers ────────────────────────────────────────────

function _normalizeSpellType(v) {
  const s = _str(v).toLowerCase();
  return s === "unconventional" ? "unconventional" : "conventional";
}

function _normalizeDamageType(v) {
  const s = _str(v).toLowerCase();
  const valid = ["none", "fire", "frost", "shock", "poison", "magic", "physical", "healing", "temporaryhealing"];
  return valid.includes(s) ? s : "none";
}

function _isHealingType(v) {
  const s = _str(v).toLowerCase();
  return s === "healing" || s === "temporaryhealing";
}

function _hasDamageFormula(sys) {
  const f = _str(sys?.damageFormula);
  return f !== "" && f !== "0";
}

function _normalizeRangeType(v) {
  const s = _str(v).toLowerCase();
  const valid = ["none", "ranged", "melee", "aoe"];
  return valid.includes(s) ? s : "none";
}

function _normalizeDuration(dur) {
  if (!dur || typeof dur !== "object") {
    return { value: 0, unit: "rounds", isInstant: true, isPermanent: false, isFinite: false };
  }
  const value = _num(dur.value, 0);
  const unit = _str(dur.unit || "rounds").toLowerCase();
  const isInstant = unit === "instant" || value === 0;
  const isPermanent = unit === "permanent";
  const isFinite = !isInstant && !isPermanent && ["rounds", "minutes", "hours", "days"].includes(unit);
  return { value, unit, isInstant, isPermanent, isFinite };
}

function _normalizeTargetingConfig(sys) {
  const engine = sys?.engine?.targeting;
  return {
    mode: _str(engine?.mode) || _inferTargetingMode(sys),
    maxTargets: Math.max(1, _num(engine?.maxTargets, 1))
  };
}

function _inferTargetingMode(sys) {
  if (_str(sys?.rangeType) === "aoe") return "template";
  if (_bool(sys?.isDirect) && !_bool(sys?.isAttackSpell)) return "self";
  return "single";
}

function _normalizeOverTime(sys) {
  const hasOT = _bool(sys?.hasOverTime);
  const ot = sys?.overTime ?? {};
  return {
    enabled: hasOT,
    trigger: _str(ot.trigger) || "turnStart",
    cadenceEvery: Math.max(1, _num(ot.cadenceEvery, 1)),
    cadenceUnit: _str(ot.cadenceUnit) || "rounds",
    payloadType: _normalizePayloadType(_str(ot.payloadType)),
    formula: _str(ot.formula) || "1d6",
    damageType: _normalizeDamageType(ot.damageType || "fire"),
    saveKey: _str(ot.saveKey),
    saveTN: _num(ot.saveTN, 0),
    saveSuccess: _str(ot.saveSuccess) || "endEffect",
    saveFailure: _str(ot.saveFailure) || "damage",
    maxTicks: ot.maxTicks != null ? _num(ot.maxTicks, 0) : null,
    label: _str(ot.label),
    chatLog: ot.chatLog !== false
  };
}

function _normalizePayloadType(raw) {
  const s = _str(raw).toLowerCase();
  if (s === "healing") return "heal";
  if (["damage", "heal", "endEffect", "saveThenApply"].includes(s)) return s;
  if (s === "endeffect") return "endEffect";
  if (s === "savethanapply" || s === "savethenApply") return "saveThenApply";
  return s || "damage";
}

function _normalizeScaling(scaling) {
  if (!scaling) return { levels: [], hasScaling: false };
  let levels = scaling.levels;
  if (!Array.isArray(levels)) {
    levels = (levels && typeof levels === "object") ? Object.values(levels) : [];
  }
  levels = levels.filter(l => l && typeof l === "object").map(l => ({
    level: _num(l.level, 1),
    cost: _num(l.cost, 0),
    damageFormula: _str(l.damageFormula),
    duration: _normalizeDuration(l.duration),
    description: _str(l.description)
  }));
  return { levels, hasScaling: levels.length > 0 };
}

function _normalizeEffectsConfig(sys) {
  const engine = sys?.engine?.effects;
  let recipes = engine?.recipes;
  if (!Array.isArray(recipes)) recipes = [];
  recipes = recipes.filter(r => r && typeof r === "object").map(r => ({
    key: _str(r.key),
    mode: _str(r.mode) || "add",
    value: _str(r.value),
    target: _str(r.target) || "target",
    label: _str(r.label)
  }));

  return {
    recipes,
    stackingPolicy: _str(engine?.stackingPolicy) || "replace",
    ownershipPolicy: _str(engine?.ownershipPolicy) || "target"
  };
}

function _normalizePersistenceConfig(sys) {
  const engine = sys?.engine?.persistence;
  return {
    dispelStrength: _str(engine?.dispelStrength) || "level",
    dispelFixedValue: _num(engine?.dispelFixedValue, 0)
  };
}

function _normalizeSummon(sys) {
  const engine = sys?.engine?.summon;
  return {
    isSummon: _bool(sys?.isSummonSpell),
    actorUuid: _str(engine?.actorUuid),
    quantity: Math.max(1, _num(engine?.quantity, 1))
  };
}

function _normalizeConjure(sys) {
  const engine = sys?.engine?.conjure;
  const rawMode = _str(engine?.mode).toLowerCase();
  const validModes = ["none", "item", "creature", "sunder"];
  const mode = validModes.includes(rawMode) ? rawMode : "none";
  return {
    mode,
    itemUuid: _str(engine?.itemUuid),
    itemLabel: _str(engine?.itemLabel),
    actorUuid: _str(engine?.actorUuid),
    actorLabel: _str(engine?.actorLabel),
    bindingCharacteristic: _str(engine?.bindingCharacteristic) || "wp",
    bindingModifier: _num(engine?.bindingModifier, 0),
    summonItems: engine?.summonItems ?? null,
    summonActors: engine?.summonActors ?? null
  };
}

function _normalizeDisintegrate(sys) {
  const engine = sys?.engine?.disintegrate;
  const validTargets = ["armor", "weapon"];
  const rawTarget = _str(engine?.target).toLowerCase();
  return {
    enabled: _bool(engine?.enabled),
    target: validTargets.includes(rawTarget) ? rawTarget : "armor"
  };
}

function _normalizeDrain(sys) {
  const engine = sys?.engine?.drain;
  const validTypes = ["none", "magicka", "health"];
  const rawType = _str(engine?.type).toLowerCase();
  return {
    enabled: _bool(engine?.enabled),
    type: validTypes.includes(rawType) ? rawType : "none",
    transferToCaster: _bool(engine?.transferToCaster)
  };
}

function _normalizeDefenseModel(sys) {
  const raw = _str(sys?.engine?.defenseModel).toLowerCase();
  const valid = ["opposed", "characteristic"];
  return valid.includes(raw) ? raw : "opposed";
}

function _normalizeCharacteristicDefense(sys) {
  const cd = sys?.engine?.characteristicDefense;
  const validChars = ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"];
  const rawChar = _str(cd?.defenderCharacteristic).toLowerCase();
  const validModModes = ["spellStrength", "formula"];
  const rawModMode = _str(cd?.modifierMode);
  const validSuccess = ["negate", "halve", "endEffect"];
  const rawSuccess = _str(cd?.onSuccess).toLowerCase();
  const validFailure = ["consequences", "damage"];
  const rawFailure = _str(cd?.onFailure).toLowerCase();
  return {
    defenderCharacteristic: validChars.includes(rawChar) ? rawChar : "end",
    modifierMode: validModModes.includes(rawModMode) ? rawModMode : "spellStrength",
    modifierFormula: _str(cd?.modifierFormula),
    onSuccess: validSuccess.includes(rawSuccess) ? rawSuccess : "negate",
    onFailure: validFailure.includes(rawFailure) ? rawFailure : "consequences"
  };
}

function _normalizeConsequences(sys) {
  const c = sys?.engine?.consequences;
  return {
    staminaDelta: _num(c?.staminaDelta, 0),
    healthDelta: _num(c?.healthDelta, 0),
    magickaDelta: _num(c?.magickaDelta, 0),
    applyCondition: _str(c?.applyCondition),
    description: _str(c?.description)
  };
}

function _normalizeCloak(sys) {
  const c = sys?.engine?.cloak;
  return {
    enabled: _bool(c?.enabled),
    range: Math.max(0, _num(c?.range, 1)),
    excludeSelf: c?.excludeSelf === false ? false : true,
    requireAttackTest: _bool(c?.requireAttackTest),
    useSpellDamage: c?.useSpellDamage === false ? false : true
  };
}
