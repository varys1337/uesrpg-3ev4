/**
 * src/core/actors/prepare/ensure-system-data.js
 *
 * Ensures required system data structures exist with safe defaults.
 * This only initializes missing objects/fields; it does not perform computations.
 * 
 * IMPORTANT:
 *  - Side-effect free (no persistent document updates)
 *  - Schema changes must occur in migrations, not here
 */

/**
 * Ensure required system data objects exist with safe defaults.
 * @param {SimpleActor} actor
 */
export function ensureSystemData(actor) {
  // Defensive hardening: some legacy actors can end up with an invalid "system" payload
  // (e.g. an empty string). If we don't tolerate that, Foundry can crash during
  // initializeDocuments, before our GM-only migrations can run.
  //
  // NOTE: This only affects runtime derived-data scaffolding. Persisted schema repair
  // happens in migrations.
  let system = actor.system;
  if (!system || typeof system !== "object" || Array.isArray(system)) {
    system = {};
    // Best-effort: prefer to restore the Actor.system object reference if possible.
    try {
      actor.system = system;
    } catch (_e) {
      // Ignore; we will continue using the local "system" reference for this prepare pass.
    }
  }

  // Characteristics
  if (!system.characteristics || typeof system.characteristics !== "object" || Array.isArray(system.characteristics)) {
    system.characteristics = {};
  }
  const chars = ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"];
  for (const c of chars) {
    system.characteristics[c] ??= { base: 0, total: 0, bonus: 0 };
    // Backfill missing sub-fields (NPC template lacks 'bonus')
    system.characteristics[c].base ??= 0;
    system.characteristics[c].total ??= 0;
    system.characteristics[c].bonus ??= 0;
  }

  // Core resources
  system.hp ??= { value: 0, max: 0, base: 0, bonus: 0 };
  system.stamina ??= { value: 0, max: 0, bonus: 0 };
  system.magicka ??= { value: 0, max: 0, bonus: 0 };
  system.luck_points ??= { value: 0, max: 0, bonus: 0 };
  system.luck_points.bonus ??= 0;
  system.action_points ??= { value: 0, max: 0 };

  // Social data canonical store for actor-native languages/factions
  if (!system.social || typeof system.social !== "object" || Array.isArray(system.social)) {
    system.social = {};
  }
  if (!system.social.languages || typeof system.social.languages !== "object" || Array.isArray(system.social.languages)) {
    system.social.languages = {};
  }
  if (!Array.isArray(system.social.languages.entries)) {
    system.social.languages.entries = [];
  }
  if (!Array.isArray(system.social.factions)) {
    system.social.factions = [];
  }

  // Modifier lanes (Active Effects)
  if (!system.modifiers || typeof system.modifiers !== "object" || Array.isArray(system.modifiers)) {
    system.modifiers = {};
  }
  system.modifiers.characteristics ??= {};
  system.modifiers.skills ??= {};
  system.modifiers.hp ??= { base: 0, bonus: 0, max: 0, value: 0 };
  system.modifiers.magicka ??= { base: 0, bonus: 0, max: 0, value: 0 };
  system.modifiers.stamina ??= { base: 0, bonus: 0, max: 0, value: 0 };
  system.modifiers.luck_points ??= { base: 0, bonus: 0, max: 0, value: 0 };

  // Initiative / Speed / Action Points / Lucky Numbers modifier lanes (Active Effects)
  system.modifiers.initiative ??= { base: 0, bonus: 0, value: 0, flat: 0, mult: { agi: 1, int: 1, prc: 1 } };
  system.modifiers.speed ??= {};
  system.modifiers.speed.value ??= 0;
  system.modifiers.speed.base ??= 0;
  system.modifiers.speed.bonus ??= 0;
  system.modifiers.speed.flySpeed ??= 0;
  system.modifiers.speed.swimSpeed ??= 0;
  system.modifiers.action_points ??= { max: 0, value: 0 };
  system.modifiers.lucky_numbers ??= { max: 0, value: 0 };
  system.modifiers.unlucky_numbers ??= { max: 0, value: 0 };

  // Movement / stealth / magic defense modifier lanes (Active Effects)
  system.modifiers.movement ??= {};
  system.modifiers.movement.fallDamage ??= 0;
  system.modifiers.stealth ??= {};
  system.modifiers.stealth.visual ??= 0;
  system.modifiers.stealth.auditory ??= 0;
  system.modifiers.magic ??= {};
  system.modifiers.magic.spellReflect ??= 0;
  system.modifiers.magic.spellAbsorption ??= 0;
  system.modifiers.tests ??= {};
  system.modifiers.tests.all ??= 0;
  system.modifiers.tests.fear ??= 0;
  system.modifiers.tests.social ??= 0;
  system.modifiers.tests.observe ??= 0;

  // Traits: movement / condition boolean flags
  // Guard against non-object values (NPC template has duplicate "traits" key, last-wins = "")
  if (!system.traits || typeof system.traits !== "object" || Array.isArray(system.traits)) {
    system.traits = {};
  }
  system.traits.movement ??= {};
  system.traits.movement.waterBreathing ??= false;
  system.traits.movement.waterWalking ??= false;
  system.traits.condition ??= {};
  system.traits.condition.silenced ??= false;
  system.traits.condition.invisible ??= false;
  system.traits.condition.blinded ??= false;
  system.traits.condition.paralyzed ??= false;
  system.traits.condition.frenzied ??= false;
  system.traits.condition.calmed ??= false;
  system.traits.condition.panicked ??= false;
  system.traits.condition.horrified ??= false;

  // Derived stats containers
  system.initiative ??= { base: 0, value: 0, bonus: 0 };
  system.wound_threshold ??= { base: 0, value: 0, bonus: 0 };
  system.speed ??= { base: 0, value: 0, bonus: 0, swimSpeed: 0, flySpeed: 0 };
  system.speed.swimSpeed ??= 0;
  system.speed.flySpeed ??= 0;
  system.carry_rating ??= { current: 0, max: 0, penalty: 0, bonus: 0, label: "Minimal" };

  // Armor mobility penalties (derived) - neutral defaults
  system.mobility ??= {
    armorWeightClass: "none",
    agilityTestPenalty: 0,
    agilityPenaltyExemptSkills: ["combatstyle", "combat_style", "combat style"],
    speedPenalty: 0,
    sources: []
  };

  // Combat state containers
  system.fatigue ??= { level: 0, penalty: 0, bonus: 0 };
  system.woundPenalty ??= 0;
  system.wounded ??= false;

  // Luck numbers (PCs may use lucky/unlucky numbers; NPCs use fixed critical bands)
  system.lucky_numbers ??= {
    ln1: 0, ln2: 0, ln3: 0, ln4: 0, ln5: 0, ln6: 0, ln7: 0, ln8: 0, ln9: 0, ln10: 0
  };
  system.unlucky_numbers ??= { ul1: 0, ul2: 0, ul3: 0, ul4: 0, ul5: 0, ul6: 0 };

  // Resistances
  // Ensure the container is an object even if a legacy actor has corrupted data.
  if (!system.resistance || typeof system.resistance !== "object" || Array.isArray(system.resistance)) {
    system.resistance = {};
  }
  // Keep defaults idempotent; do not overwrite existing values.
  system.resistance.diseaseR ??= 0;
  system.resistance.fireR ??= 0;
  system.resistance.frostR ??= 0;
  system.resistance.shockR ??= 0;
  system.resistance.poisonR ??= 0;
  system.resistance.magicR ??= 0;
  system.resistance.natToughness ??= 0;
  system.resistance.silverR ??= 0;
  system.resistance.sunlightR ??= 0;
  // New: Physical Resistance (separate from Natural Toughness)
  system.resistance.physicalR ??= 0;

  // (#4) Weaknesses (inverse resistances — damage amplification)
  // Populated by trait/talent/power weakness definitions and Rule Elements.
  if (!system.weakness || typeof system.weakness !== "object" || Array.isArray(system.weakness)) {
    system.weakness = {};
  }
  system.weakness.diseaseR ??= 0;
  system.weakness.fireR ??= 0;
  system.weakness.frostR ??= 0;
  system.weakness.shockR ??= 0;
  system.weakness.poisonR ??= 0;
  system.weakness.magicR ??= 0;
  system.weakness.natToughness ??= 0;
  system.weakness.silverR ??= 0;
  system.weakness.sunlightR ??= 0;
  system.weakness.physicalR ??= 0;

  // Professions / Skills containers
  system.professions ??= {};
  system.professionsWound ??= {};
  system.skills ??= {};
  
  // Combat tracking
  system.combat_tracking ??= {
    attacks_this_round: 0,
    attacks_this_turn: 0,
    last_reset_round: 0,
    last_reset_turn: 0
  };
}
