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

  // ── Warfare Unit: skip humanoid defaults, apply warfare-specific ones, then return ──
  if (actor.type === "Warfare Unit") {
    _ensureWarfareUnitSystemData(system);
    return;
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

// ── Warfare Unit system data defaults (additive only) ─────────────────────
function _ensureWarfareUnitSystemData(system) {
  system.commander ??= { uuid: "", id: "", name: "", img: "", bonusOverride: 0 };
  system.commander.bonusOverride ??= 0;
  system.commanderAttachment ??= {
    leaderActorUuid: "",
    warfareTokenUuid: "",
    leaderTokenUuid: "",
    sceneId: "",
  };
  system.commanderAttachment.leaderActorUuid ??= "";
  system.commanderAttachment.warfareTokenUuid ??= "";
  system.commanderAttachment.leaderTokenUuid ??= "";
  system.commanderAttachment.sceneId ??= "";
  if (!system.classification || typeof system.classification !== "object") {
    system.classification = {};
  }
  system.classification.unitType ??= "";
  system.classification.ancestry ??= "";
  system.classification.mount ??= "none";
  system.classification.tier ??= "light";

  if (!system.stats || typeof system.stats !== "object") system.stats = {};
  system.stats.bulk ??= { value: 1, max: 0, lossTotal: 0 };
  system.stats.bulk.value ??= 1;
  system.stats.bulk.max ??= 0;
  system.stats.bulk.lossTotal ??= 0;
  system.stats.discipline ??= { value: 0, base: 0, bonus: 0 };
  system.stats.discipline.value ??= 0;
  system.stats.discipline.base ??= 0;
  system.stats.discipline.bonus ??= 0;
  system.stats.condition ??= { value: 0, max: 0 };
  system.stats.condition.value ??= 0;
  system.stats.condition.max ??= 0;
  system.stats.magicka ??= { value: 0, max: 0 };
  system.stats.magicka.value ??= 0;
  system.stats.magicka.max ??= 0;
  system.stats.speed ??= { value: 0, base: 0, bonus: 0 };
  system.stats.speed.value ??= 0;
  system.stats.speed.base ??= 0;
  system.stats.speed.bonus ??= 0;

  if (!system.gear || typeof system.gear !== "object") system.gear = {};
  system.gear.sets ??= 0;
  system.gear.dmg ??= "";
  system.gear.ar ??= 0;
  system.gear.mar ??= 0;
  system.gear.speedPenalty ??= 0;
  system.gear.cost ??= 0;

  if (!system.racial || typeof system.racial !== "object") system.racial = {};
  system.racial.speedMod ??= 0;
  system.racial.magickaMod ??= 0;
  system.racial.offenseMod ??= 0;
  system.racial.offenseType ??= "";
  system.racial.conditionMod ??= 0;
  system.racial.disciplineMod ??= 0;
  system.racial.special ??= "";

  if (!system.combat || typeof system.combat !== "object") system.combat = {};
  system.combat.hidden ??= false;
  system.combat.deployed ??= false;
  system.combat.leaderless ??= false;

  if (!Array.isArray(system.traits)) system.traits = [];
  if (!Array.isArray(system.deployableEquipment)) system.deployableEquipment = [];
  if (!Array.isArray(system.spells)) system.spells = [];

  if (!system.upkeep || typeof system.upkeep !== "object") system.upkeep = {};
  system.upkeep.weeklyGold ??= 0;
  system.upkeep.enslaved ??= false;

  if (!system.rules || typeof system.rules !== "object") system.rules = {};
  system.rules.source ??= "UESRPG Mass Warfare 3e";
  system.rules.version ??= "0.2";

  if (typeof system.description !== "string") system.description = "";
  if (typeof system.notes !== "string") system.notes = "";

  // ── Neutral canonized lanes (Phase 2 additions — additive) ─────────────
  // profile
  if (!system.profile || typeof system.profile !== "object") system.profile = {};
  system.profile.id ??= "uesrpg-0_2";

  // identity
  if (!system.identity || typeof system.identity !== "object") system.identity = {};
  system.identity.category ??= "";
  system.identity.ancestry ??= "";
  system.identity.rank ??= "";

  if (!system.doctrine || typeof system.doctrine !== "object") system.doctrine = {};
  system.doctrine.tradition ??= "";

  // composition
  if (!system.composition || typeof system.composition !== "object") system.composition = {};
  system.composition.racialPresetKey ??= "";
  if (!system.composition.racialMods || typeof system.composition.racialMods !== "object") {
    system.composition.racialMods = {};
  }
  system.composition.racialMods.speedMod      ??= 0;
  system.composition.racialMods.magickaMod    ??= 0;
  system.composition.racialMods.offenseMod    ??= 0;
  system.composition.racialMods.offenseType   ??= "";
  system.composition.racialMods.conditionMod  ??= 0;
  system.composition.racialMods.disciplineMod ??= 0;
  system.composition.racialMods.special       ??= "";

  // mounts
  if (!system.mounts || typeof system.mounts !== "object") system.mounts = {};
  system.mounts.primary ??= "none";

  // economy
  if (!system.economy || typeof system.economy !== "object") system.economy = {};
  system.economy.cadence  ??= "weekly";
  system.economy.mode     ??= "gold";
  system.economy.amount   ??= 0;
  system.economy.enslaved ??= false;
  system.economy.unpaidWeeks ??= 0;
  system.economy.specialModifier ??= 0;

  // magic
  if (!system.magic || typeof system.magic !== "object") system.magic = {};
  system.magic.mode ??= "implements";
  if (!Array.isArray(system.magic.entries)) system.magic.entries = [];

  // equipment (owned)
  if (!system.equipment || typeof system.equipment !== "object") system.equipment = {};
  if (!Array.isArray(system.equipment.owned)) system.equipment.owned = [];

  // variant
  if (!system.variant || typeof system.variant !== "object") system.variant = {};
  if (!Array.isArray(system.variant.tags)) system.variant.tags = [];
  if (!system.variant.overrides || typeof system.variant.overrides !== "object") {
    system.variant.overrides = {};
  }

  // status
  if (!system.status || typeof system.status !== "object") system.status = {};
  system.status.leaderless ??= false;
  if (!system.status.battle || typeof system.status.battle !== "object") {
    system.status.battle = {};
  }
  system.status.battle.hidden      ??= false;
  system.status.battle.ambushReady ??= false;
  system.status.battle.revealed    ??= true;
  system.status.battle.routed      ??= false;
  system.status.battle.broken      ??= false;
  system.status.battle.suppressed  ??= false;
  system.status.battle.defeated    ??= false;
  system.status.battle.frenzied    ??= false;
  system.status.battle.flyer       ??= false;

  if (!system.modifiers || typeof system.modifiers !== "object") system.modifiers = {};
  if (!system.modifiers.discipline || typeof system.modifiers.discipline !== "object") {
    system.modifiers.discipline = {};
  }
  system.modifiers.discipline.manual ??= 0;
  if (!system.modifiers.discipline.campaign || typeof system.modifiers.discipline.campaign !== "object") {
    system.modifiers.discipline.campaign = {};
  }
  system.modifiers.discipline.campaign.inspiringSpeech ??= false;
  system.modifiers.discipline.campaign.forcedMarch ??= false;
  system.modifiers.discipline.campaign.poorClimate ??= false;
  system.modifiers.discipline.campaign.longCampaign ??= false;
  system.modifiers.discipline.campaign.defendingAlliedSettlement ??= false;
  if (!system.modifiers.discipline.battle || typeof system.modifiers.discipline.battle !== "object") {
    system.modifiers.discipline.battle = {};
  }
  system.modifiers.discipline.battle.rearCharged ??= false;
  system.modifiers.discipline.battle.adjacentFriendlyBroken ??= false;
  system.modifiers.discipline.battle.commanderLost ??= false;
  system.modifiers.discipline.battle.rallyBonus ??= false;
  system.modifiers.discipline.battle.enemyBrokenBonus ??= false;

  // gear.tier (new neutral field alongside classification.tier)
  if (!system.gear || typeof system.gear !== "object") system.gear = {};
  system.gear.tier ??= system.classification?.tier ?? "light";
  system.gear.apparel ??= system.gear.tier ?? system.classification?.tier ?? "light";

  system.stats.resolve ??= { value: 0, max: 0, lossTotal: 0 };
  system.stats.resolve.value ??= 0;
  system.stats.resolve.max ??= 0;
  system.stats.resolve.lossTotal ??= 0;

  system.stats.condition.maxOverride ??= 0;
  system.stats.condition.useMaxOverride ??= false;
  system.rules.version ??= "2.0";
}
