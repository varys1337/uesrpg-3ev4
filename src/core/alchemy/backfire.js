/**
 * Alchemical Backfire Engine
 *
 * Implements the three backfire resolution tables per the Rules Compendium Appendix:
 *   - Creation Backfire Table   (1d4 + highest spell level → 2–12)
 *   - Potion Backfire Table     (1d10 on consumption of a backfired potion)
 *   - Minor Effects Table       (2d8 for "Could be Worse!" entry)
 *
 * Trigger conditions (RAW §1.6):
 *   - Critical failure                                       → always backfire
 *   - Failure with more than one effect                      → backfire
 *   - Failure where any effect SL > alchemyRank              → backfire
 *   - Nothing Ventured…: rolled doubles while test failed    → backfire
 *   - Nothing Ventured…: test automatically fails            → backfire
 *   (Note: Master Alchemist prevents backfires unless Nothing Ventured is used.)
 */

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
  // Critical failure → always a backfire (even Master Alchemist cannot prevent this).
  if (critical) return true;

  // Failure while using Nothing Ventured… → auto-backfire regardless of Master Alchemist.
  if (failed && nothingVentured) return true;

  // Doubles while Nothing Ventured… is active → backfire even on success.
  if (nothingVentured && doubles) return true;

  // Master Alchemist prevents all other backfire triggers.
  // (Cannot be used while Nothing Ventured… is active — RAW §1.5.)
  if (isMasterAlchemist && !nothingVentured) return false;

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
 *   outcome    One of: "lost" | "backfired" | "tools_damaged" | "fumes" | "explosion" | "catastrophe"
 */
export const CREATION_BACKFIRE_TABLE = Object.freeze([
  {
    min: 2,
    max: 3,
    key: "lost_potion",
    label: "Lost Potion",
    description: "The mixture dissolves into an inert sludge. No potion is created and all materials are wasted.",
    outcome: "lost",
  },
  {
    min: 4,
    max: 5,
    key: "backfired_potion",
    label: "Backfired Potion",
    description: "A potion is created, but the formula went awry. The vial appears normal but contains unpredictable reagents. Mark the potion as Backfired.",
    outcome: "backfired",
  },
  {
    min: 6,
    max: 7,
    key: "tools_damaged",
    label: "Tools Damaged",
    description: "The reaction damages your equipment. The alchemist must immediately make a Luck test; on a failure, one Alchemy Tool or the Alchemy Lab is Damaged(1).",
    outcome: "tools_damaged",
  },
  {
    min: 8,
    max: 9,
    key: "toxic_fumes",
    label: "Toxic Fumes",
    description: "Noxious fumes billow from the flask. The alchemist is exposed — roll 2d8 on the Minor Effects Table.",
    outcome: "fumes",
  },
  {
    min: 10,
    max: 11,
    key: "small_explosion",
    label: "Small Explosion",
    description: "The mixture detonates violently. The alchemist suffers 1d6 Fire damage (ignoring armor) and must roll 2d8 on the Minor Effects Table.",
    outcome: "explosion",
  },
  {
    min: 12,
    max: 12,
    key: "catastrophic_explosion",
    label: "Catastrophic Explosion",
    description: "A catastrophic detonation destroys the workspace. The alchemist suffers 2d8 Fire damage (ignoring armor), and the Alchemy Lab (if any) is destroyed. All materials are lost. Roll 2d8 on the Minor Effects Table.",
    outcome: "catastrophe",
  },
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
  {
    min: 1,
    max: 2,
    key: "no_effect",
    label: "No Effect",
    description: "The potion fizzles. No effect occurs but the potion is consumed.",
    outcome: "no_effect",
  },
  {
    min: 3,
    max: 4,
    key: "half_potency",
    label: "Weakened",
    description: "The potion works at half its intended potency. Each numeric value (healing, attribute bonus, etc.) is halved (round down).",
    outcome: "half_potency",
  },
  {
    min: 5,
    max: 6,
    key: "wrong_effect",
    label: "Wrong Effect",
    description: "A random minor effect manifests instead of the intended result. Roll 2d8 on the Minor Effects Table.",
    outcome: "minor_effects",
  },
  {
    min: 7,
    max: 8,
    key: "sickened",
    label: "Sickened",
    description: "The drinker is violently ill. Make an Endurance test; on a failure, the drinker gains the Poisoned condition (1d6 rounds) and suffers −10 to all tests for that duration.",
    outcome: "sickened",
  },
  {
    min: 9,
    max: 10,
    key: "dangerous",
    label: "Dangerous Reaction",
    description: "A violent reaction occurs. The drinker immediately suffers 1d8 physical damage (ignoring armor). Roll 2d8 on the Minor Effects Table.",
    outcome: "dangerous",
  },
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
  {
    min: 2,
    max: 3,
    key: "nothing",
    label: "Nothing",
    description: "A close call — nothing notable happens.",
    outcome: "none",
  },
  {
    min: 4,
    max: 5,
    key: "nauseous",
    label: "Nauseous",
    description: "The character feels ill. Make an Endurance test or spend the next round retching (unable to take actions).",
    outcome: "endurance_test",
  },
  {
    min: 6,
    max: 7,
    key: "confused",
    label: "Confused",
    description: "The character is disoriented. Suffer −10 to all tests for 1d4 rounds.",
    outcome: "penalty",
  },
  {
    min: 8,
    max: 9,
    key: "weakened",
    label: "Weakened",
    description: "A sudden drain saps stamina. Lose 1d6 Stamina Points immediately.",
    outcome: "sp_loss",
  },
  {
    min: 10,
    max: 11,
    key: "nauseated",
    label: "Nauseated",
    description: "Severe nausea. Suffer −20 to Endurance tests for 1 minute.",
    outcome: "penalty",
  },
  {
    min: 12,
    max: 13,
    key: "dizzy",
    label: "Dizzy",
    description: "Vertigo strikes. Suffer 1d6 physical damage (ignoring armor).",
    outcome: "damage",
  },
  {
    min: 14,
    max: 15,
    key: "burning_pain",
    label: "Burning Pain",
    description: "An internal burn. Suffer 1d8 Fire damage (ignoring armor).",
    outcome: "damage",
  },
  {
    min: 16,
    max: 16,
    key: "severe_reaction",
    label: "Severe Reaction",
    description: "A catastrophic internal reaction. Suffer 2d6 physical damage (ignoring armor).",
    outcome: "damage",
  },
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

  let minorEffect = null;
  if (entry?.outcome === "fumes" || entry?.outcome === "explosion" || entry?.outcome === "catastrophe") {
    minorEffect = await rollMinorEffects();
  }

  return { d4, d4Roll, highestSL, total, entry, minorEffect };
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
  if (entry?.outcome === "minor_effects" || entry?.outcome === "dangerous") {
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
  if (!backfireResult?.entry) return "Unknown backfire result.";
  const { d4, highestSL, total, entry, minorEffect } = backfireResult;
  let text = `<strong>Backfire (${d4} + SL${highestSL} = ${total}):</strong> ${entry.label} — ${entry.description}`;
  if (minorEffect?.entry) {
    text += `<br><em>Minor Effect (2d8 = ${minorEffect.roll}):</em> ${minorEffect.entry.label} — ${minorEffect.entry.description}`;
  }
  return text;
}
