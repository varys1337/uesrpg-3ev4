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

import { CHARACTERISTIC_KEYS, MAGIC_SCHOOL_KEYS } from "../../domain/constants.js";
import { buildDefaultWorshipData, buildDefaultWorshipDomainState } from "../../religion/worship-store.js";

/**
 * Ensure required system data objects exist with safe defaults.
 * @param {SimpleActor} actor
 */
export function ensureSystemData(actor) {
  let system = actor.system;
  if (!system || typeof system !== "object" || Array.isArray(system)) {
    system = {};
    try {
      actor.system = system;
    } catch (_e) {
      // Ignore and continue with the local scaffold for this prepare pass.
    }
  }

  if (actor.type === "Warfare Unit") {
    _ensureWarfareUnitSystemData(system);
    return;
  }

  _ensureCharacteristics(system);
  _ensureCoreResources(system);
  _ensureSocialDefaults(system);
  _ensureModifierLanes(system);
  _ensureTraitDefaults(system);
  _ensureDerivedContainers(system);
  _ensureResistanceDefaults(system);
  _ensureSkillContainers(system);
  _ensureCombatTracking(system);
  _ensureWorshipDefaults(system);
}

function _ensureCharacteristics(system) {
  if (!system.characteristics || typeof system.characteristics !== "object" || Array.isArray(system.characteristics)) {
    system.characteristics = {};
  }
  for (const characteristicKey of CHARACTERISTIC_KEYS) {
    system.characteristics[characteristicKey] ??= { base: 0, total: 0, bonus: 0 };
    system.characteristics[characteristicKey].base ??= 0;
    system.characteristics[characteristicKey].total ??= 0;
    system.characteristics[characteristicKey].bonus ??= 0;
  }
}

function _ensureCoreResources(system) {
  system.hp ??= { value: 0, max: 0, base: 0, bonus: 0 };
  system.stamina ??= { value: 0, max: 0, bonus: 0 };
  system.magicka ??= { value: 0, max: 0, bonus: 0 };
  system.luck_points ??= { value: 0, max: 0, bonus: 0 };
  system.luck_points.bonus ??= 0;
  system.action_points ??= { value: 0, max: 0 };
}

function _ensureSocialDefaults(system) {
  if (!system.social || typeof system.social !== "object" || Array.isArray(system.social)) {
    system.social = {};
  }
  if (!system.social.languages || typeof system.social.languages !== "object" || Array.isArray(system.social.languages)) {
    system.social.languages = {};
  }
  if (!Array.isArray(system.social.languages.entries)) system.social.languages.entries = [];
  if (!Array.isArray(system.social.factions)) system.social.factions = [];
}

function _ensureModifierLanes(system) {
  if (!system.modifiers || typeof system.modifiers !== "object" || Array.isArray(system.modifiers)) {
    system.modifiers = {};
  }

  system.modifiers.characteristics ??= {};
  system.modifiers.skills ??= {};
  system.modifiers.hp ??= { base: 0, bonus: 0, max: 0, value: 0 };
  system.modifiers.magicka ??= { base: 0, bonus: 0, max: 0, value: 0 };
  system.modifiers.stamina ??= { base: 0, bonus: 0, max: 0, value: 0 };
  system.modifiers.luck_points ??= { base: 0, bonus: 0, max: 0, value: 0 };

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

  system.modifiers.movement ??= {};
  system.modifiers.movement.fallDamage ??= 0;
  system.modifiers.movement.climbSpeed ??= 0;
  system.modifiers.movement.dashMultiplier ??= 0;
  system.modifiers.movement.sprintMultiplier ??= 0;
  system.modifiers.movement.hiddenSpeedMultiplier ??= 0;

  system.modifiers.stealth ??= {};
  system.modifiers.stealth.visual ??= 0;
  system.modifiers.stealth.auditory ??= 0;

  system.modifiers.magic ??= {};
  system.modifiers.magic.cost ??= {};
  system.modifiers.magic.cost._all ??= 0;
  for (const school of MAGIC_SCHOOL_KEYS) system.modifiers.magic.cost[school] ??= 0;
  system.modifiers.magic.damage ??= {};
  system.modifiers.magic.damage.fire ??= 0;
  system.modifiers.magic.damage.frost ??= 0;
  system.modifiers.magic.damage.shock ??= 0;
  system.modifiers.magic.negateChance ??= 0;
  system.modifiers.magic.spellRestraintBonus ??= 0;
  system.modifiers.magic.spellReflect ??= 0;
  system.modifiers.magic.spellAbsorption ??= 0;

  system.modifiers.combat ??= {};
  system.modifiers.combat.attackLimit ??= {};
  system.modifiers.combat.attackLimit.total ??= 0;
  system.modifiers.combat.attackLimit.melee ??= 0;
  system.modifiers.combat.attackLimit.ranged ??= 0;
  system.modifiers.combat.opposed ??= {};
  system.modifiers.combat.opposed.attackTN ??= 0;
  system.modifiers.combat.evadeAoOCost ??= 0;

  system.modifiers.tests ??= {};
  system.modifiers.tests.all ??= 0;
  system.modifiers.tests.fear ??= 0;
  system.modifiers.tests.social ??= 0;
  system.modifiers.tests.observe ??= 0;
  system.modifiers.tests.panic ??= 0;
  system.modifiers.tests.horror ??= 0;

  system.modifiers.damage ??= {};
  system.modifiers.damage.fromSunlight ??= 0;
  system.modifiers.damage.fromSilver ??= 0;
  system.modifiers.damage.fromMagic ??= 0;

  system.modifiers.degrees ??= {};
  system.modifiers.degrees.success ??= {};
  system.modifiers.degrees.success.all ??= 0;
  system.modifiers.degrees.success.skills ??= {};
  system.modifiers.degrees.success.skills.all ??= 0;
  system.modifiers.degrees.success.combat ??= {};
  system.modifiers.degrees.success.combat.all ??= 0;
  system.modifiers.degrees.success.combat.attack ??= 0;
  system.modifiers.degrees.success.combat.defense ??= 0;
  system.modifiers.degrees.success.magic ??= {};
  system.modifiers.degrees.success.magic.all ??= 0;
  for (const school of MAGIC_SCHOOL_KEYS) system.modifiers.degrees.success.magic[school] ??= 0;
  system.modifiers.degrees.success.social ??= 0;
  system.modifiers.degrees.success.observe ??= 0;

  system.modifiers.degrees.success.minimum ??= {};
  system.modifiers.degrees.success.minimum.all ??= 0;
  system.modifiers.degrees.success.minimum.skills ??= {};
  system.modifiers.degrees.success.minimum.skills.all ??= 0;
  system.modifiers.degrees.success.minimum.combat ??= {};
  system.modifiers.degrees.success.minimum.combat.attack ??= 0;
  system.modifiers.degrees.success.minimum.combat.defense ??= 0;
  system.modifiers.degrees.success.minimum.magic ??= {};
  system.modifiers.degrees.success.minimum.magic.all ??= 0;
  for (const school of MAGIC_SCHOOL_KEYS) system.modifiers.degrees.success.minimum.magic[school] ??= 0;
  system.modifiers.degrees.success.minimum.social ??= 0;
  system.modifiers.degrees.success.minimum.observe ??= 0;

  system.modifiers.degrees.failure ??= {};
  system.modifiers.degrees.failure.skills ??= {};
  system.modifiers.degrees.failure.skills.all ??= 0;
  system.modifiers.degrees.failure.combat ??= {};
  system.modifiers.degrees.failure.combat.all ??= 0;
  system.modifiers.degrees.failure.combat.attack ??= 0;
  system.modifiers.degrees.failure.combat.defense ??= 0;
  system.modifiers.degrees.failure.magic ??= {};
  system.modifiers.degrees.failure.magic.all ??= 0;
  for (const school of MAGIC_SCHOOL_KEYS) system.modifiers.degrees.failure.magic[school] ??= 0;
  system.modifiers.degrees.failure.social ??= 0;
  system.modifiers.degrees.failure.observe ??= 0;
  system.modifiers.degrees.failure.backfire ??= 0;
}

function _ensureTraitDefaults(system) {
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
}

function _ensureDerivedContainers(system) {
  system.initiative ??= { base: 0, value: 0, bonus: 0 };
  system.wound_threshold ??= { base: 0, value: 0, bonus: 0 };
  system.speed ??= { base: 0, value: 0, bonus: 0, swimSpeed: 0, flySpeed: 0 };
  system.speed.swimSpeed ??= 0;
  system.speed.flySpeed ??= 0;
  system.carry_rating ??= { current: 0, max: 0, penalty: 0, bonus: 0, label: "Minimal" };
  system.mobility ??= {
    armorWeightClass: "none",
    agilityTestPenalty: 0,
    agilityPenaltyExemptSkills: ["combatstyle", "combat_style", "combat style"],
    speedPenalty: 0,
    sources: []
  };
  system.fatigue ??= { level: 0, penalty: 0, bonus: 0 };
  system.woundPenalty ??= 0;
  system.wounded ??= false;
  system.lucky_numbers ??= {
    ln1: 0, ln2: 0, ln3: 0, ln4: 0, ln5: 0, ln6: 0, ln7: 0, ln8: 0, ln9: 0, ln10: 0
  };
  system.unlucky_numbers ??= { ul1: 0, ul2: 0, ul3: 0, ul4: 0, ul5: 0, ul6: 0 };
}

function _ensureResistanceDefaults(system) {
  if (!system.resistance || typeof system.resistance !== "object" || Array.isArray(system.resistance)) {
    system.resistance = {};
  }
  system.resistance.diseaseR ??= 0;
  system.resistance.fireR ??= 0;
  system.resistance.frostR ??= 0;
  system.resistance.shockR ??= 0;
  system.resistance.poisonR ??= 0;
  system.resistance.magicR ??= 0;
  system.resistance.natToughness ??= 0;
  system.resistance.silverR ??= 0;
  system.resistance.sunlightR ??= 0;
  system.resistance.physicalR ??= 0;

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
}

function _ensureSkillContainers(system) {
  system.professions ??= {};
  system.professionsWound ??= {};
  system.skills ??= {};
}

function _ensureCombatTracking(system) {
  system.combat_tracking ??= {
    attacks_this_round: 0,
    attacks_this_turn: 0,
    last_reset_round: 0,
    last_reset_turn: 0
  };
}

function _ensureWorshipDefaults(system) {
  if (!system.worship || typeof system.worship !== "object" || Array.isArray(system.worship)) {
    system.worship = buildDefaultWorshipData();
    return;
  }

  system.worship.primaryDomainKey ??= "";
  if (!system.worship.domains || typeof system.worship.domains !== "object" || Array.isArray(system.worship.domains)) {
    system.worship.domains = {};
  }

  for (const [domainKey, state] of Object.entries(system.worship.domains)) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      system.worship.domains[domainKey] = buildDefaultWorshipDomainState();
      continue;
    }

    state.deityName ??= "";
    state.initiated ??= false;
    state.piety ??= {};
    state.piety.value ??= 0;
    state.piety.max ??= 0;
    state.piety.bonus ??= 0;

    state.penance ??= {};
    state.penance.blocked ??= false;
    state.penance.note ??= "";
    state.penance.appliedAt ??= 0;

    state.preparation ??= {};
    if (!Array.isArray(state.preparation.preparedInvocationIds)) state.preparation.preparedInvocationIds = [];
    state.preparation.lastPreparedAt ??= 0;

    state.intervention ??= {};
    state.intervention.lastLongRestUsage ??= 0;
    state.intervention.lastRequestAt ??= 0;
    state.intervention.lastResolvedAt ??= 0;
    state.intervention.lastOutcome ??= "";
    state.intervention.retributionNote ??= "";

    if (!Array.isArray(state.history)) state.history = [];

    state.observances ??= {};
    state.observances.fasting ??= {};
    state.observances.fasting.active ??= false;
    state.observances.fasting.streakDays ??= 0;
    state.observances.fasting.lastAccrualAt ??= 0;
    state.observances.fasting.lastSourceLabel ??= "";
  }
}

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

  if (!system.profile || typeof system.profile !== "object") system.profile = {};
  system.profile.id ??= "uesrpg-0_2";

  if (!system.identity || typeof system.identity !== "object") system.identity = {};
  system.identity.category ??= "";
  system.identity.ancestry ??= "";
  system.identity.rank ??= "";

  if (!system.doctrine || typeof system.doctrine !== "object") system.doctrine = {};
  system.doctrine.tradition ??= "";

  if (!system.composition || typeof system.composition !== "object") system.composition = {};
  system.composition.racialPresetKey ??= "";
  if (!system.composition.racialMods || typeof system.composition.racialMods !== "object") {
    system.composition.racialMods = {};
  }
  system.composition.racialMods.speedMod ??= 0;
  system.composition.racialMods.magickaMod ??= 0;
  system.composition.racialMods.offenseMod ??= 0;
  system.composition.racialMods.offenseType ??= "";
  system.composition.racialMods.conditionMod ??= 0;
  system.composition.racialMods.disciplineMod ??= 0;
  system.composition.racialMods.special ??= "";

  if (!system.mounts || typeof system.mounts !== "object") system.mounts = {};
  system.mounts.primary ??= "none";

  if (!system.economy || typeof system.economy !== "object") system.economy = {};
  system.economy.cadence ??= "weekly";
  system.economy.mode ??= "gold";
  system.economy.amount ??= 0;
  system.economy.enslaved ??= false;
  system.economy.unpaidWeeks ??= 0;
  system.economy.specialModifier ??= 0;

  if (!system.magic || typeof system.magic !== "object") system.magic = {};
  system.magic.mode ??= "implements";
  if (!Array.isArray(system.magic.entries)) system.magic.entries = [];

  if (!system.equipment || typeof system.equipment !== "object") system.equipment = {};
  if (!Array.isArray(system.equipment.owned)) system.equipment.owned = [];

  if (!system.variant || typeof system.variant !== "object") system.variant = {};
  if (!Array.isArray(system.variant.tags)) system.variant.tags = [];
  if (!system.variant.overrides || typeof system.variant.overrides !== "object") {
    system.variant.overrides = {};
  }

  if (!system.status || typeof system.status !== "object") system.status = {};
  system.status.leaderless ??= false;
  if (!system.status.battle || typeof system.status.battle !== "object") {
    system.status.battle = {};
  }
  system.status.battle.hidden ??= false;
  system.status.battle.ambushReady ??= false;
  system.status.battle.revealed ??= true;
  system.status.battle.routed ??= false;
  system.status.battle.broken ??= false;
  system.status.battle.suppressed ??= false;
  system.status.battle.defeated ??= false;
  system.status.battle.frenzied ??= false;
  system.status.battle.flyer ??= false;

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
