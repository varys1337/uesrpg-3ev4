/**
 * @module traits/spellcasting-talents
 * @description Spellcasting talent modifier stage for UESRPG 3ev4.
 *
 * Provides a single, deterministic modifier layer that is called during spell profile
 * resolution and casting execution. All spellcasting talents from Chapter 4 are
 * implemented here using the existing talent-api.js queries and magic-modifiers.js
 * utilities.
 *
 * **Design Goals**:
 * - Single modifier stage: called once per spell profile resolution
 * - Deterministic and idempotent: same inputs → same outputs
 * - No schema changes: uses actor flags for activated talent state
 * - No persistent mutations during resolution: only reads and returns modifiers
 * - Reuses existing helpers (talents-api.js, magic-modifiers.js)
 *
 * **Talent Categories**:
 * 1. Passive – Always active when talent is present and predicate matches
 * 2. Activated – Requires manual priming via talent item activation; consumed on qualifying cast
 * 3. Milestone-dependent – Requires future subsystems; stubs with GM warning
 *
 * Target: Foundry VTT v13.351
 */

import { hasTalent, getTalentItem, getNamedItemRank } from "./talents-api.js";
import {
  computeSpellRestraintReduction,
  computeElementalDamageBonus,
  isSpellConventional,
  isSpellUnconventional,
  isElementalDamageType,
  getActorWillpowerBonus
} from "../magic/magic-modifiers.js";
import { _num, _lower } from "./_primitives.js";
import { _bool, _strTrim } from "../../utils/coerce.js";
import { getActorCapabilityFlag } from "../active-effects/modifier-evaluator.js";
export {
  getSpellcastingTalentState,
  setSpellcastingPrimedState,
  clearSpellcastingPrimedState
} from "./spellcasting-talent-state.js";
export {
  isActivatableSpellcastingTalent,
  activateSpellcastingTalent,
  handlePostCastTalentConsumption,
  registerSpellcastingTalentHooks
} from "./spellcasting-talent-activation.js";

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** Milestone subsystems that some talents require. */
const MILESTONE_SUBSYSTEMS = {
  spells: "Spells Milestone (Conjure Weapon / Bound Items)",
  items: "Items Milestone (Equipment / Bound Items)",
  summons: "Summons Milestone (Summoned Creature Management)"
};

/**
 * Talents that require milestone subsystems not yet implemented.
 * Maps talent slug → { milestone: string, description: string }.
 */
const MILESTONE_TALENTS = {
  bladecaller:              { milestone: "spells",  description: "Requires Conjure Weapon spell framework" },
  weaponecho:               { milestone: "spells",  description: "Requires Conjure Weapon spell framework" },
  spellsword:               { milestone: "items",   description: "Requires equipment interaction framework" },
  unfetteredconjuration:    { milestone: "spells",  description: "Requires summoning spell framework" },
  taskmaster:               { milestone: "spells",  description: "Requires Mindlock / summoning framework" },
  masterofthehordes:        { milestone: "spells",  description: "Requires Mindlock / summoning framework" },
  voidchanneler:            { milestone: "spells",  description: "Requires summoned creature management" },
  themendingtidesoblivion:  { milestone: "spells",  description: "Requires summoned creature management" }
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Get the spell's school key in lowercase.
 * @param {Item|object} spell
 * @returns {string}
 */
function _spellSchool(spell) {
  return _lower(spell?.system?.school ?? spell?.metadata?.school);
}

/**
 * Get the spell's damage type in lowercase.
 * @param {Item|object} spellOrProfile
 * @returns {string}
 */
function _damageType(spellOrProfile) {
  // Profile uses .damage.type, raw spell uses .system.damageType
  return _lower(
    spellOrProfile?.damage?.type ??
    spellOrProfile?.system?.damageType ??
    ""
  );
}

/**
 * Check whether a spell is a healing spell (from profile or raw item).
 * @param {object} profile
 * @returns {boolean}
 */
function _isHealing(profile) {
  return _bool(profile?.damage?.isHealing) || _lower(profile?.damage?.type) === "healing";
}

/**
 * Check whether a resolved profile has the Reinforce attribute.
 * @param {object} profile
 * @returns {boolean}
 */
function _hasReinforce(profile) {
  return _bool(profile?.classification?.hasReinforce);
}

/**
 * Check whether a resolved profile has the Upkeep attribute.
 * @param {object} profile
 * @returns {boolean}
 */
function _hasUpkeep(profile) {
  return _bool(profile?.classification?.hasUpkeep);
}

/**
 * Check whether a spell has the Overload attribute.
 * @param {object} profile
 * @returns {boolean}
 */
function _hasOverload(profile) {
  return _bool(profile?.classification?.hasOverload);
}

// ──────────────────────────────────────────────────────────────────────────────
// Milestone Talent Warning
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Check if a talent requires an unimplemented milestone subsystem.
 * If so, warn the GM and return true.
 *
 * @param {string} slug
 * @param {Actor} actor
 * @returns {boolean} true if talent is milestone-dependent and subsystem is missing
 */
function _checkMilestoneDependency(slug, actor) {
  const info = MILESTONE_TALENTS[slug];
  if (!info) return false;

  // Post a GM-only warning
  if (game.user?.isGM) {
    console.warn(
      `UESRPG | Spellcasting talent "${slug}" on ${actor?.name}: ${info.description}. ` +
      `${MILESTONE_SUBSYSTEMS[info.milestone] ?? "Required subsystem"} is not yet implemented. ` +
      `Talent has no automated effect.`
    );
    ChatMessage.create({
      content: `<p><strong>⚠ Talent Stub:</strong> <em>${slug}</em> on <strong>${actor?.name ?? "Unknown"}</strong> ` +
        `requires the <em>${MILESTONE_SUBSYSTEMS[info.milestone] ?? info.milestone}</em> which is not yet implemented. ` +
        `This talent currently has no automated effect.</p>`,
      whisper: ChatMessage.getWhisperRecipients("GM"),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    }).catch(() => {});
  }

  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Individual Talent Modifiers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Modifier result object returned by individual talent handlers.
 * @typedef {object} TalentModifier
 * @property {string} slug - Talent slug
 * @property {string} label - Human-readable label for breakdown
 * @property {object} [cost] - { delta: number } modification to cost
 * @property {object} [damage] - { bonusFlat: number, rollTwice: boolean } modification to damage
 * @property {object} [restraint] - { wpBonusDelta: number } modification to restraint WB
 * @property {object} [reinforce] - { bonusDelta: number } modification to reinforce effect
 * @property {object} [conjuration] - { bonusDoS: number, useSkillRank: boolean, apPenaltyReduction: number }
 * @property {object} [overload] - { allowWithRestrain: boolean }
 * @property {object} [upkeep] - { apInsteadOfMp: boolean }
 * @property {boolean} [consumePrimed] - Whether to consume the primed state after cast
 */

/**
 * Apply Cryomancer talent: +1 frost damage.
 */
function _applyCryomancer(actor, profile) {
  if (!hasTalent(actor, "cryomancer")) return null;
  const dt = _damageType(profile);
  if (dt !== "frost") return null;
  return {
    slug: "cryomancer",
    label: "Cryomancer: +1 frost damage",
    damage: { bonusFlat: 1 }
  };
}

/**
 * Apply Pyromancer talent: +1 fire damage.
 */
function _applyPyromancer(actor, profile) {
  if (!hasTalent(actor, "pyromancer")) return null;
  const dt = _damageType(profile);
  if (dt !== "fire") return null;
  return {
    slug: "pyromancer",
    label: "Pyromancer: +1 fire damage",
    damage: { bonusFlat: 1 }
  };
}

/**
 * Apply Electromancer talent: +1 shock damage.
 */
function _applyElectromancer(actor, profile) {
  if (!hasTalent(actor, "electromancer")) return null;
  const dt = _damageType(profile);
  if (dt !== "shock") return null;
  return {
    slug: "electromancer",
    label: "Electromancer: +1 shock damage",
    damage: { bonusFlat: 1 }
  };
}

/**
 * Apply Creative talent: +1 WB for restraint on unconventional spells.
 */
function _applyCreative(actor, profile, spell) {
  if (!hasTalent(actor, "creative")) return null;
  if (!isSpellUnconventional(spell)) return null;
  return {
    slug: "creative",
    label: "Creative: +1 WB (unconventional restraint)",
    restraint: { wpBonusDelta: 1 }
  };
}

/**
 * Apply Methodical talent: +1 WB for restraint on conventional spells.
 */
function _applyMethodical(actor, profile, spell) {
  if (!hasTalent(actor, "methodical")) return null;
  if (!isSpellConventional(spell)) return null;
  return {
    slug: "methodical",
    label: "Methodical: +1 WB (conventional restraint)",
    restraint: { wpBonusDelta: 1 }
  };
}

/**
 * Apply Magicka Cycling talent: +2 WB for restraint purposes.
 */
function _applyMagickaCycling(actor, profile, spell, castContext) {
  if (!hasTalent(actor, "magickacycling")) return null;
  // Only applies when the caster has opted in (dialog checkbox or flag)
  // Note: Magicka Cycling is passive per RAW — always improves WB for restraint
  return {
    slug: "magickacycling",
    label: "Magicka Cycling: +2 WB (restraint)",
    restraint: { wpBonusDelta: 2 }
  };
}

/**
 * Apply Master of Magicka talent: can overload a spell even when restraining.
 * RAW: "The character can overload a spell with the overload attribute even if they restrain that spell."
 */
function _applyMasterOfMagicka(actor, profile) {
  if (!hasTalent(actor, "masterofmagicka")) return null;
  if (!_hasOverload(profile)) return null;
  return {
    slug: "masterofmagicka",
    label: "Master of Magicka: Overload allowed while restraining",
    overload: { allowWithRestrain: true }
  };
}

/**
 * Apply Overcharge talent: double cost (after restraint) to roll damage twice and keep highest.
 * RAW: "The character can double the cost they pay for a spell (after spell restraint)
 * in order to roll damage twice and use the highest when calculating that spell's damage."
 *
 * This is an activated option exposed in the casting dialog. We report the modifier
 * but actual roll-twice logic is handled by spell-helpers.js/damage-application.js.
 */
function _applyOvercharge(actor, profile, spell, castContext) {
  if (!hasTalent(actor, "overcharge")) return null;
  // Only applies when explicitly opted in via casting dialog
  const useOvercharge = _bool(castContext?.spellOptions?.useOvercharge);
  if (!useOvercharge) return null;
  // Spell must deal damage
  const formula = _strTrim(profile?.damage?.formula);
  if (!formula || formula === "0") return null;
  return {
    slug: "overcharge",
    label: "Overcharge: roll damage 2×, keep highest (cost doubled)",
    damage: { rollTwice: true },
    cost: { multiplier: 2, afterRestraint: true }
  };
}

/**
 * Apply Mage Guard talent: +1 to Reinforce effect when NOT restraining.
 * RAW: "The character can add a +1 bonus to the effect of a spell they cast with
 * the Reinforce attribute. They must not restrain the spell during casting to gain this benefit."
 */
function _applyMageGuard(actor, profile, spell, castContext) {
  if (!hasTalent(actor, "mageguard")) return null;
  if (!_hasReinforce(profile)) return null;
  // Must NOT be restraining
  const isRestrained = _bool(castContext?.spellOptions?.isRestrained ?? castContext?.isRestrained);
  if (isRestrained) return null;
  return {
    slug: "mageguard",
    label: "Mage Guard: +1 Reinforce effect",
    reinforce: { bonusDelta: 1 }
  };
}

/**
 * Apply Arcane Defender talent: increases Mage Guard bonus from +1 to WB/2 (round up).
 * RAW: "The character increases the bonus gained from the Mage Guard Talent from 1 to WB/2 (round up)."
 * Requires Mage Guard. Same precondition: must NOT be restraining.
 */
function _applyArcaneDefender(actor, profile, spell, castContext) {
  if (!hasTalent(actor, "arcanedefender")) return null;
  if (!hasTalent(actor, "mageguard")) return null;
  if (!_hasReinforce(profile)) return null;
  const isRestrained = _bool(castContext?.spellOptions?.isRestrained ?? castContext?.isRestrained);
  if (isRestrained) return null;
  const wb = getActorWillpowerBonus(actor);
  const totalBonus = Math.ceil(wb / 2);
  // Arcane Defender replaces the +1 from Mage Guard entirely
  // We report the net additional bonus beyond the +1 from Mage Guard
  const additionalBonus = Math.max(0, totalBonus - 1);
  return {
    slug: "arcanedefender",
    label: `Arcane Defender: Reinforce bonus increased to WB/2 (${totalBonus} total, +${additionalBonus} beyond Mage Guard)`,
    reinforce: { bonusDelta: additionalBonus }
  };
}

/**
 * Apply Strong Willed talent: +1 DoS on all successful Conjuration tests.
 * RAW: "The character gains a bonus Degree of Success on all successful Conjuration tests."
 */
function _applyStrongWilled(actor, profile, spell) {
  if (!hasTalent(actor, "strongwilled")) return null;
  if (_spellSchool(spell) !== "conjuration") return null;
  return {
    slug: "strongwilled",
    label: "Strong Willed: +1 DoS on Conjuration tests",
    conjuration: { bonusDoS: 1 }
  };
}

/**
 * Apply Seasoned Conjurer talent: can take Conjuration skill rank instead of rolled DoS.
 * RAW: "When the character succeeds on a Conjuration test, they can choose to take
 * the number of degrees of success that they rolled or take a number equal to their
 * Conjuration skill rank instead."
 */
function _applySeasonedConjurer(actor, profile, spell) {
  if (!hasTalent(actor, "seasonedconjurer")) return null;
  if (_spellSchool(spell) !== "conjuration") return null;
  const conjRank = getNamedItemRank(actor, "Conjuration", { types: ["magicSkill"] });
  return {
    slug: "seasonedconjurer",
    label: `Seasoned Conjurer: may use Conjuration rank (${conjRank}) as DoS`,
    conjuration: { useSkillRank: true, skillRankValue: conjRank }
  };
}

/**
 * Apply Living Armory talent: pay 1 AP instead of Magicka for upkeep of
 * self-targeting Conjure Armour/Weapon effects.
 * RAW: "The character can choose to reduce their AP by 1 point instead of paying the
 * Magicka cost of Upkeeping all active Conjure Armour and Conjure Weapon effects
 * that affect only the caster."
 */
function _applyLivingArmory(actor, profile, spell) {
  if (!getActorCapabilityFlag(actor, "flags.uesrpg-3ev4.magic.upkeepViaAP") && !hasTalent(actor, "livingarmory")) return null;
  if (!_hasUpkeep(profile)) return null;
  // Only applies to Conjure Weapon / Conjure Armour spells
  const name = _lower(spell?.name ?? profile?.name ?? "");
  const isConjureEquipment = name.includes("conjure weapon") || name.includes("conjure armour") ||
    name.includes("conjure armor") || name.includes("bound weapon") || name.includes("bound armour") ||
    name.includes("bound armor");
  if (!isConjureEquipment) return null;
  return {
    slug: "livingarmory",
    label: "Living Armory: may pay 1 AP instead of MP for upkeep",
    upkeep: { apInsteadOfMp: true }
  };
}

/**
 * Apply Control talent: can test Willpower to negate a magical backfire.
 * This is not a profile modifier — it's handled reactively during backfire resolution.
 * We report it as a flag for the backfire handler to check.
 */
function _applyControl(actor) {
  if (!hasTalent(actor, "control")) return null;
  return {
    slug: "control",
    label: "Control: may test Willpower to negate backfire",
    backfire: { canNegate: true }
  };
}

/**
 * Apply Bend Reality talent: use Alteration in place of Athletics/Acrobatics for 2 MP.
 * This is a skill-substitution talent, not a spell profile modifier.
 * It is handled by the skill test system, not the casting pipeline.
 * We report it for documentation / UI purposes but do not modify the profile.
 */
function _applyBendReality(_actor, _profile) {
  // Handled by skill test substitution system, not spell casting.
  // No modifier returned.
  return null;
}

/**
 * Apply Healer talent (activated): treat a wound via Restoration test + 10 MP + 1 hour.
 * RAW: "The character can make a Restoration test and spend 10 magicka to perform
 * an hour long ritual in order to treat a wound."
 * This is a standalone ritual action, not a spell profile modifier.
 * Activation is handled via the talent activation system.
 */
function _applyHealer(actor, profile, spell, castContext) {
  // Healer is a standalone ritual action. When primed, it does not modify
  // a spell's profile. Instead, it creates a separate "treat wound" workflow.
  // We include it here to mark the primed state is understood but return null.
  return null;
}

/**
 * Apply Flow of Magicka (activated): reaction to negate a spell by testing Mysticism at -20.
 * RAW: "As a reaction to a spell cast, the character may make a -20 Mysticism skill test.
 * If their degrees of success exceed the spell level of the spell being cast, then the
 * effect of the spell is negated."
 * This is a reaction, not a self-cast modifier. Handled by the opposed defense system.
 */
function _applyFlowOfMagicka(_actor, _profile) {
  // Reaction-based counter-spell. Not a profile modifier.
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Milestone Talent Stubs
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Stub for Bladecaller: use WB instead of SB for damage with Conjure Weapon.
 */
function _applyBladecaller(actor) {
  if (!hasTalent(actor, "bladecaller")) return null;
  if (_checkMilestoneDependency("bladecaller", actor)) return null;
  return null;
}

/**
 * Stub for Weapon Echo: reduce Conjure Weapon duration and allow floating attacks.
 */
function _applyWeaponEcho(actor) {
  if (!hasTalent(actor, "weaponecho")) return null;
  if (_checkMilestoneDependency("weaponecho", actor)) return null;
  return null;
}

/**
 * Stub for Spell Sword: only one free hand needed to cast.
 */
function _applySpellSword(actor) {
  if (!hasTalent(actor, "spellsword")) return null;
  if (_checkMilestoneDependency("spellsword", actor)) return null;
  return null;
}

/**
 * Stub for Unfettered Conjuration: summoned creatures don't suffer AP penalty from restraint.
 */
function _applyUnfetteredConjuration(actor) {
  if (!hasTalent(actor, "unfetteredconjuration")) return null;
  if (_checkMilestoneDependency("unfetteredconjuration", actor)) return null;
  return null;
}

/**
 * Stub for Taskmaster: reduce AP required by each Mindlock by 1 (min 1).
 */
function _applyTaskmaster(actor) {
  if (!hasTalent(actor, "taskmaster")) return null;
  if (_checkMilestoneDependency("taskmaster", actor)) return null;
  return null;
}

/**
 * Stub for Master of the Hordes: reduce Mindlock AP by 1 (min 0), up to WB creatures.
 */
function _applyMasterOfTheHordes(actor) {
  if (!hasTalent(actor, "masterofthehordes")) return null;
  if (_checkMilestoneDependency("masterofthehordes", actor)) return null;
  return null;
}

/**
 * Stub for Void Channeler: spend SP to boost summoned Daedra's Natural Toughness.
 */
function _applyVoidChanneler(actor) {
  if (!hasTalent(actor, "voidchanneler")) return null;
  if (_checkMilestoneDependency("voidchanneler", actor)) return null;
  return null;
}

/**
 * Stub for The Mending Tides of Oblivion: summoned daedra gain Regeneration (WB).
 */
function _applyTheMendingTidesOfOblivion(actor) {
  if (!hasTalent(actor, "themendingtidesoblivion")) return null;
  if (_checkMilestoneDependency("themendingtidesoblivion", actor)) return null;
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Unified Modifier Stage
// ──────────────────────────────────────────────────────────────────────────────

/**
 * All passive talent applicators.
 * Each function signature: (actor, profile, spell, castContext) => TalentModifier | null
 * @type {Array<Function>}
 */
const PASSIVE_TALENT_APPLICATORS = [
  _applyCryomancer,
  _applyPyromancer,
  _applyElectromancer,
  _applyCreative,
  _applyMethodical,
  _applyMagickaCycling,
  _applyMasterOfMagicka,
  _applyOvercharge,
  _applyMageGuard,
  _applyArcaneDefender,
  _applyStrongWilled,
  _applySeasonedConjurer,
  _applyLivingArmory,
  _applyControl,
  // Non-modifiers (handled elsewhere):
  _applyBendReality,
  _applyHealer,
  _applyFlowOfMagicka,
  // Milestone stubs:
  _applyBladecaller,
  _applyWeaponEcho,
  _applySpellSword,
  _applyUnfetteredConjuration,
  _applyTaskmaster,
  _applyMasterOfTheHordes,
  _applyVoidChanneler,
  _applyTheMendingTidesOfOblivion
];

/**
 * Apply all spellcasting talent modifiers to a spell profile.
 *
 * This is the single entry point for the spellcasting talent modifier stage.
 * It is called during spell profile resolution and produces an array of
 * modifiers that should be applied to the resolved profile.
 *
 * @param {object} params
 * @param {Actor} params.actor - The caster
 * @param {Item} params.spellItem - The raw spell item
 * @param {object} params.profile - The resolved spell profile (from resolveSpellProfile)
 * @param {object} [params.castContext] - Casting context (spellOptions, targets, etc.)
 * @returns {{ modifiers: TalentModifier[], summary: object }}
 */
export function applySpellcastingTalentModifiers({ actor, spellItem, profile, castContext } = {}) {
  if (!actor || !profile) {
    return { modifiers: [], summary: _buildSummary([]) };
  }

  const spell = spellItem ?? profile;
  const modifiers = [];

  // Run all passive talent applicators
  for (const applicator of PASSIVE_TALENT_APPLICATORS) {
    try {
      const mod = applicator(actor, profile, spell, castContext);
      if (mod) modifiers.push(mod);
    } catch (err) {
      console.error(`UESRPG | spellcasting-talents | Error in ${applicator.name}:`, err);
    }
  }

  // Build a summary for consumers
  const summary = _buildSummary(modifiers);

  return { modifiers, summary };
}

/**
 * Build a summary object from collected modifiers for easy consumption.
 *
 * @param {TalentModifier[]} modifiers
 * @returns {object}
 */
function _buildSummary(modifiers) {
  const summary = {
    damageBonus: 0,
    rollDamageTwice: false,
    restraintWpBonusDelta: 0,
    reinforceBonusDelta: 0,
    conjurationBonusDoS: 0,
    conjurationUseSkillRank: false,
    conjurationSkillRankValue: 0,
    allowOverloadWithRestrain: false,
    upkeepApInsteadOfMp: false,
    backfireCanNegate: false,
    costMultiplier: 1,
    costMultiplierAfterRestraint: false,
    labels: [],
    slugs: new Set()
  };

  for (const mod of modifiers) {
    if (!mod) continue;
    summary.slugs.add(mod.slug);
    if (mod.label) summary.labels.push(mod.label);

    if (mod.damage?.bonusFlat) summary.damageBonus += _num(mod.damage.bonusFlat);
    if (mod.damage?.rollTwice) summary.rollDamageTwice = true;

    if (mod.restraint?.wpBonusDelta) summary.restraintWpBonusDelta += _num(mod.restraint.wpBonusDelta);

    if (mod.reinforce?.bonusDelta) summary.reinforceBonusDelta += _num(mod.reinforce.bonusDelta);

    if (mod.conjuration?.bonusDoS) summary.conjurationBonusDoS += _num(mod.conjuration.bonusDoS);
    if (mod.conjuration?.useSkillRank) {
      summary.conjurationUseSkillRank = true;
      summary.conjurationSkillRankValue = Math.max(
        summary.conjurationSkillRankValue, _num(mod.conjuration.skillRankValue)
      );
    }

    if (mod.overload?.allowWithRestrain) summary.allowOverloadWithRestrain = true;

    if (mod.upkeep?.apInsteadOfMp) summary.upkeepApInsteadOfMp = true;

    if (mod.backfire?.canNegate) summary.backfireCanNegate = true;

    if (mod.cost?.multiplier) {
      summary.costMultiplier = Math.max(summary.costMultiplier, _num(mod.cost.multiplier, 1));
      if (mod.cost.afterRestraint) summary.costMultiplierAfterRestraint = true;
    }
  }

  return summary;
}

/**
 * Apply the computed talent modifiers to a mutable spell profile object.
 * This mutates the profile in-place and returns it.
 *
 * Should be called exactly once per profile resolution.
 *
 * @param {object} profile - The resolved spell profile (will be mutated)
 * @param {object} summary - Summary from applySpellcastingTalentModifiers
 * @returns {object} The mutated profile
 */
export function applyTalentSummaryToProfile(profile, summary) {
  if (!profile || !summary) return profile;

  // Stamp talent modifiers onto the profile for downstream consumers
  profile.talentModifiers = {
    damageBonus: summary.damageBonus,
    rollDamageTwice: summary.rollDamageTwice,
    restraintWpBonusDelta: summary.restraintWpBonusDelta,
    reinforceBonusDelta: summary.reinforceBonusDelta,
    conjurationBonusDoS: summary.conjurationBonusDoS,
    conjurationUseSkillRank: summary.conjurationUseSkillRank,
    conjurationSkillRankValue: summary.conjurationSkillRankValue,
    allowOverloadWithRestrain: summary.allowOverloadWithRestrain,
    upkeepApInsteadOfMp: summary.upkeepApInsteadOfMp,
    backfireCanNegate: summary.backfireCanNegate,
    costMultiplier: summary.costMultiplier,
    costMultiplierAfterRestraint: summary.costMultiplierAfterRestraint,
    labels: summary.labels,
    applied: true
  };

  // Cost multipliers are applied only by resolveSpellCostSnapshot(). This stage
  // records talent intent for damage/UI consumers and must not mutate cost again.

  return profile;
}
