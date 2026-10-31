/**
 * Alchemical Backfire Engine
 *
 * Implements the three backfire resolution tables per the Rules Compendium Appendix:
 *   - Creation Backfire Table   (1d4 + highest spell level → 2–12)
 *   - Potion Backfire Table     (1d10 on consumption of a backfired potion)
 *   - Minor Effects Table       (2d8 for "Could be Worse!" entry)
 *
 * Trigger conditions (RAW §1.6):
 *   - Critical failure                                       → normal backfire trigger
 *   - Failure with more than one effect                      → backfire
 *   - Failure where any effect SL > alchemyRank              → backfire
 *   - Nothing Ventured…: rolled doubles while test failed    → backfire
 *   - Nothing Ventured…: test automatically fails            → backfire
 *   (Master Alchemist prevents normal backfires, including critical-failure
 *   backfires. Nothing Ventured is the explicit exception.)
 */

import { t, tf } from "../../utils/i18n.js";

// ── Trigger evaluation ────────────────────────────────────────────────────────

/**
 * Determine whether a brew attempt should produce a backfire.
 *
 * @param {object} opts
 * @param {boolean} opts.critical          True if the roll was a critical failure.
 * @param {boolean} opts.failed            True if the roll was a regular failure.
 * @param {boolean} opts.multiEffect       True if the brew has more than one effect.
 * @param {boolean} opts.exceedsRank       True if any effect SL > alchemyRank.
 * @param {boolean} opts.nothingVentured   True if Nothing Ventured… option is active.
 * @param {boolean} opts.doubles           True if the dice showed doubles.
 * @param {boolean} opts.isMasterAlchemist True if the actor has Master Alchemist talent.
 * @returns {boolean}
 */
export function shouldCreationBackfire({
  critical = false,
  failed = false,
  multiEffect = false,
  exceedsRank = false,
  nothingVentured = false,
  doubles = false,
  isMasterAlchemist = false,
}) {
  // Failure while using Nothing Ventured… → auto-backfire regardless of Master Alchemist.
  if (failed && nothingVentured) return true;

  // Doubles while Nothing Ventured… is active → backfire even on success.
  if (nothingVentured && doubles) return true;

  // Master Alchemist prevents every normal alchemical backfire. Nothing
  // Ventured is the explicit RAW exception and is handled above.
  if (isMasterAlchemist && !nothingVentured) return false;

  if (critical) return true;

  // Standard failure triggers.
  if (failed && multiEffect) return true;
  if (failed && exceedsRank) return true;

  return false;
}

// ── Creation Backfire Table ───────────────────────────────────────────────────

/**
 * Creation Backfire Table entries.
 * Roll = 1d4 + highest spell level in the brew.
 * Valid roll range: 2–12 (SL 1–8, d4 1–4).
 *
 * Format:
 *   min, max   Inclusive range of total roll values that match this entry.
 *   key        Machine-readable outcome key.
 *   label      Short display label.
 *   description Full text to present in the chat card.
 *   outcome    A coarse disposition; additional consequences require GM resolution.
 */
export const CREATION_BACKFIRE_TABLE = Object.freeze([
  { min: 1, max: 2, key: "normal_potion", label: "Nothing", description: "The potion is usable normally despite the fizzing.", outcome: "normal" },
  { min: 3, max: 3, key: "thick_backfired", label: "Nothing", description: "The potion is thick, brown and smelly, and counts as backfired.", outcome: "backfired" },
  { min: 4, max: 4, key: "foam", label: "Poof", description: "The potion foams up and is lost.", outcome: "lost" },
  { min: 5, max: 5, key: "ruined_tools", label: "Whoops", description: "The potion is lost. Make a Luck test; on failure the toolset is destroyed.", outcome: "lost" },
  { min: 6, max: 6, key: "chunky_backfired", label: "Yuck", description: "The potion is smelly and chunky and counts as backfired.", outcome: "backfired" },
  { min: 7, max: 7, key: "fumes", label: "Fizz", description: "The potion is lost. Everyone in the area tests Willpower or begins vomiting.", outcome: "lost" },
  { min: 8, max: 8, key: "poison", label: "Poison", description: "Poisonous fumes deal 1d8 poison damage ignoring armor to those who breathe them; drinking the potion deals 3d8 poison damage ignoring armor.", outcome: "manual" },
  { min: 9, max: 9, key: "acid", label: "It Burns", description: "The potion and tools are lost. Test Agility or take 1d6 damage to a random hit location.", outcome: "lost" },
  { min: 10, max: 10, key: "black_backfired", label: "Wh-What", description: "The black, bubbling and steaming potion counts as backfired.", outcome: "backfired" },
  { min: 11, max: 12, key: "explosion", label: "Boom", description: "The explosion deals 2d8 fire damage to anyone within 5 meters; the potion and tools are lost.", outcome: "lost" },
]);

/**
 * Look up an entry in the Creation Backfire Table.
 * @param {number} total  Sum of 1d4 + highest spell level (clamped to 2–12).
 * @returns {object|null}
 */
export function lookupCreationBackfire(total) {
  const clamped = Math.max(2, Math.min(12, Math.round(total)));
  return CREATION_BACKFIRE_TABLE.find(e => clamped >= e.min && clamped <= e.max) ?? null;
}

// ── Potion Backfire Table ─────────────────────────────────────────────────────

/**
 * Potion Backfire Table entries.
 * Roll = 1d10 on consumption of a backfired potion.
 *
 * Format: same as creation table except outcome applies to the drinker.
 */
export const POTION_BACKFIRE_TABLE = Object.freeze([
  { min: 1, max: 3, key: "minor_effect", label: "Could be Worse", description: "Roll 2d8 on the minor effects table and apply that result along with the normal effects.", outcome: "minor_effects" },
  { min: 4, max: 4, key: "nothing", label: "Nothing", description: "The table says nothing happens; the GM resolves how this interacts with the potion's normal effect.", outcome: "manual" },
  { min: 5, max: 5, key: "vomiting", label: "Yuck", description: "Apply normal effects. Test Willpower at -20 or vomit and become helpless for one round.", outcome: "manual" },
  { min: 6, max: 6, key: "poison", label: "Poison", description: "In addition to normal effects, take 2d10 poison damage to the body ignoring armor.", outcome: "manual" },
  { min: 7, max: 7, key: "blindness", label: "I can't See", description: "In addition to normal effects, gain Blinded for 1d5 hours.", outcome: "manual" },
  { min: 8, max: 8, key: "burning", label: "It Burns", description: "In addition to normal effects, gain Burning (1) on the body.", outcome: "manual" },
  { min: 9, max: 9, key: "paralysis", label: "Paralysis", description: "Also become paralyzed for 1d5 rounds.", outcome: "manual" },
  { min: 10, max: 10, key: "lethal_poison", label: "Lethal Poison", description: "In addition to normal effects, take 3d8 poison damage to the body ignoring armor.", outcome: "manual" },
]);

/**
 * Look up an entry in the Potion Backfire Table.
 * @param {number} roll  Result of 1d10.
 * @returns {object|null}
 */
export function lookupPotionBackfire(roll) {
  const clamped = Math.max(1, Math.min(10, Math.round(roll)));
  return POTION_BACKFIRE_TABLE.find(e => clamped >= e.min && clamped <= e.max) ?? null;
}

// ── Minor Effects Table ───────────────────────────────────────────────────────

/**
 * Minor Effects Table entries.
 * Roll = 2d8 for the "Could be Worse!" / supplemental effect entries.
 * Range: 2–16.
 */
export const MINOR_EFFECTS_TABLE = Object.freeze([
  { min: 2, max: 2, key: "blue_eyes", label: "Blue eyes", description: "The character's eyes turn blue for 1d5 hours.", outcome: "manual" },
  { min: 3, max: 3, key: "mint_breath", label: "Mint breath", description: "The character's breath is minty for 1d5 hours.", outcome: "manual" },
  { min: 4, max: 4, key: "scar", label: "Strange scar", description: "The character gains a strange scar at random.", outcome: "manual" },
  { min: 5, max: 5, key: "self_invisible", label: "Self-invisible", description: "The character is invisible to themself.", outcome: "manual" },
  { min: 6, max: 6, key: "green_hair", label: "Green hair", description: "The character's hair turns green for 1d5 hours.", outcome: "manual" },
  { min: 7, max: 7, key: "transparent_skin", label: "Transparent skin", description: "The character's skin turns transparent for 1d5 minutes.", outcome: "manual" },
  { min: 8, max: 8, key: "bad_breath", label: "Bad breath", description: "The character's breath stinks for 1d5 hours.", outcome: "manual" },
  { min: 9, max: 9, key: "smoke", label: "Smell smoke", description: "The character smells smoke for 1d5 hours.", outcome: "manual" },
  { min: 10, max: 10, key: "sweating", label: "Sweating", description: "The character sweats profusely for 1d5 minutes.", outcome: "manual" },
  { min: 11, max: 11, key: "thirst", label: "Thirst", description: "The character becomes extremely thirsty.", outcome: "manual" },
  { min: 12, max: 12, key: "itch", label: "Itching", description: "The character itches all over for 1d5 minutes.", outcome: "manual" },
  { min: 13, max: 13, key: "aftertaste", label: "Aftertaste", description: "The character experiences a strange aftertaste.", outcome: "manual" },
  { min: 14, max: 14, key: "deep_voice", label: "Deep voice", description: "The character's voice deepens for 1d5 hours.", outcome: "manual" },
  { min: 15, max: 15, key: "pleasant_scent", label: "Pleasant scent", description: "The character smells great for 1d5 minutes.", outcome: "manual" },
  { min: 16, max: 16, key: "hair_growth", label: "Hair growth", description: "The character's hair grows rapidly for the next week.", outcome: "manual" },
]);

/**
 * Look up an entry in the Minor Effects Table.
 * @param {number} roll  Sum of 2d8 (range 2–16).
 * @returns {object|null}
 */
export function lookupMinorEffect(roll) {
  const clamped = Math.max(2, Math.min(16, Math.round(roll)));
  return MINOR_EFFECTS_TABLE.find(e => clamped >= e.min && clamped <= e.max) ?? null;
}

// ── Backfire resolution ───────────────────────────────────────────────────────

/**
 * Roll and resolve the Creation Backfire Table.
 * Returns { roll, total, entry, minorEffect? } for logging / chat rendering.
 *
 * @param {number} highestSL  Highest spell level in the brew.
 * @returns {Promise<object>}
 */
export async function rollCreationBackfire(highestSL) {
  const d4Roll = new Roll("1d4");
  await d4Roll.evaluate();
  const d4 = d4Roll.total;
  const total = d4 + Math.max(1, Number(highestSL) || 1);
  const entry = lookupCreationBackfire(total);

  return { d4, d4Roll, highestSL, total, entry, minorEffect: null };
}

/**
 * Roll and resolve the Potion Backfire Table (on potion consumption).
 * @returns {Promise<object>}
 */
export async function rollPotionBackfire() {
  const roll = new Roll("1d10");
  await roll.evaluate();
  const entry = lookupPotionBackfire(roll.total);

  let minorEffect = null;
  if (entry?.outcome === "minor_effects") {
    minorEffect = await rollMinorEffects();
  }

  return { roll: roll.total, rollObject: roll, entry, minorEffect };
}

/**
 * Roll and resolve the Minor Effects Table (2d8).
 * @returns {Promise<object>}
 */
export async function rollMinorEffects() {
  const roll = new Roll("2d8");
  await roll.evaluate();
  const entry = lookupMinorEffect(roll.total);
  return { roll: roll.total, rollObject: roll, entry };
}

/**
 * Build a human-readable summary string for a creation backfire result.
 * Used in chat cards.
 * @param {object} backfireResult  Result from rollCreationBackfire().
 * @returns {string}
 */
export function formatCreationBackfire(backfireResult) {
  if (!backfireResult?.entry) return t("UESRPG.Alchemy.UnknownBackfireResult");
  const { d4, highestSL, total, entry, minorEffect } = backfireResult;
  let text = `<strong>${tf("UESRPG.Alchemy.CreationBackfireFormat", { d4, highestSL, total, label: entry.label, description: entry.description })}</strong>`;
  if (minorEffect?.entry) {
    text += `<br><em>${tf("UESRPG.Alchemy.MinorEffectFormat", { roll: minorEffect.roll, label: minorEffect.entry.label, description: minorEffect.entry.description })}</em>`;
  }
  return text;
}
