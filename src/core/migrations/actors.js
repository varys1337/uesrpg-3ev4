/**
 * Actor migration / normalization (v13-safe).
 *
 * Scope:
 * - World Actors (game.actors)
 *
 * Notes:
 * - This is a lightweight normalization pass that is safe to run on every startup.
 * - It repairs a small class of legacy/corrupted actors that can have an invalid
 *   system payload (e.g. an empty string), which would otherwise crash data prep.
 */

import { SYSTEM_ID } from "../constants.js";
import { getMigrationState, setMigrationState, getSystemVersionString } from "./state.js";

const MODULE_ID = SYSTEM_ID;
const WARFARE_CONDITION_INIT_FLAG_PATH = `flags.${SYSTEM_ID}.warfareConditionInitialized`;

function _buildResistanceDefaults() {
  return {
    diseaseR: 0,
    fireR: 0,
    frostR: 0,
    shockR: 0,
    poisonR: 0,
    magicR: 0,
    natToughness: 0,
    silverR: 0,
    sunlightR: 0,
    physicalR: 0
  };
}

function _isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function _ensureResistanceDefaults(sys) {
  const update = {};
  const res = _isPlainObject(sys?.resistance) ? sys.resistance : null;

  if (!res) {
    update["system.resistance"] = _buildResistanceDefaults();
    return update;
  }

  // Additive defaults only; do not overwrite existing values.
  if (res.diseaseR === undefined) update["system.resistance.diseaseR"] = 0;
  if (res.fireR === undefined) update["system.resistance.fireR"] = 0;
  if (res.frostR === undefined) update["system.resistance.frostR"] = 0;
  if (res.shockR === undefined) update["system.resistance.shockR"] = 0;
  if (res.poisonR === undefined) update["system.resistance.poisonR"] = 0;
  if (res.magicR === undefined) update["system.resistance.magicR"] = 0;
  if (res.natToughness === undefined) update["system.resistance.natToughness"] = 0;
  if (res.silverR === undefined) update["system.resistance.silverR"] = 0;
  if (res.sunlightR === undefined) update["system.resistance.sunlightR"] = 0;
  if (res.physicalR === undefined) update["system.resistance.physicalR"] = 0;
  return update;
}

function _buildInvalidActorSystemPatch(actor) {
  return {
    _id: actor.id,
    system: {
      resistance: _buildResistanceDefaults()
    }
  };
}

function _buildActorMigrationPatch(actor) {
  const sys = actor.system;
  if (!_isPlainObject(sys)) return _buildInvalidActorSystemPatch(actor);

  const update = _ensureResistanceDefaults(sys);
  if (!Object.keys(update).length) return null;
  update._id = actor.id;
  return update;
}

export async function migrateActorsIfNeeded() {
  if (!game.user.isGM) return;

  const currentVersion = getSystemVersionString();
  const state = getMigrationState();
  if (state?.actors === currentVersion) return;

  try {
    const updates = [];

    for (const actor of game.actors.contents) {
      const update = _buildActorMigrationPatch(actor);
      if (update) updates.push(update);
    }

    if (updates.length) {
      console.log(`${MODULE_ID} | Migrating ${updates.length} actor(s)`);
      await Actor.updateDocuments(updates, { diff: false });
    }

    // Record migration version after a successful pass (even if no updates were needed).
    state.actors = currentVersion;
    await setMigrationState(state);
  } catch (err) {
    console.error(`${MODULE_ID} | Actor migration failed`, err);
    ui.notifications?.error?.("UESRPG actor migration failed; check console for details.");
  }
}

/**
 * Ensure Warfare Unit actors have all required sub-objects.
 * Additive and idempotent — only backfills missing keys.
 */
function _ensureWarfareUnitDefaults(sys) {
  const update = {};
  if (sys == null || typeof sys !== "object") return update;

  if (!_isPlainObject(sys.profile)) update["system.profile"] = { id: "uesrpg-0_2" };
  else if (sys.profile.id === undefined) update["system.profile.id"] = "uesrpg-0_2";

  if (!_isPlainObject(sys.identity)) update["system.identity"] = { category: "", ancestry: "", rank: "" };
  else {
    if (sys.identity.category === undefined) update["system.identity.category"] = "";
    if (sys.identity.ancestry === undefined) update["system.identity.ancestry"] = "";
    if (sys.identity.rank === undefined) update["system.identity.rank"] = "";
  }

  if (!_isPlainObject(sys.doctrine)) update["system.doctrine"] = { tradition: "" };
  else if (sys.doctrine.tradition === undefined) update["system.doctrine.tradition"] = "";

  if (!_isPlainObject(sys.composition)) {
    update["system.composition"] = {
      racialPresetKey: "",
      racialMods: {
        speedMod: 0,
        magickaMod: 0,
        offenseMod: 0,
        offenseType: "",
        conditionMod: 0,
        disciplineMod: 0,
        special: "",
      },
    };
  } else {
    if (sys.composition.racialPresetKey === undefined) update["system.composition.racialPresetKey"] = "";
    if (!_isPlainObject(sys.composition.racialMods)) {
      update["system.composition.racialMods"] = {
        speedMod: 0,
        magickaMod: 0,
        offenseMod: 0,
        offenseType: "",
        conditionMod: 0,
        disciplineMod: 0,
        special: "",
      };
    } else {
      if (sys.composition.racialMods.speedMod === undefined) update["system.composition.racialMods.speedMod"] = 0;
      if (sys.composition.racialMods.magickaMod === undefined) update["system.composition.racialMods.magickaMod"] = 0;
      if (sys.composition.racialMods.offenseMod === undefined) update["system.composition.racialMods.offenseMod"] = 0;
      if (sys.composition.racialMods.offenseType === undefined) update["system.composition.racialMods.offenseType"] = "";
      if (sys.composition.racialMods.conditionMod === undefined) update["system.composition.racialMods.conditionMod"] = 0;
      if (sys.composition.racialMods.disciplineMod === undefined) update["system.composition.racialMods.disciplineMod"] = 0;
      if (sys.composition.racialMods.special === undefined) update["system.composition.racialMods.special"] = "";
    }
  }

  if (!_isPlainObject(sys.mounts)) update["system.mounts"] = { primary: "none" };
  else if (sys.mounts.primary === undefined) update["system.mounts.primary"] = "none";

  if (!_isPlainObject(sys.economy)) {
    update["system.economy"] = { cadence: "weekly", mode: "gold", amount: 0, enslaved: false, unpaidWeeks: 0, specialModifier: 0 };
  } else {
    if (sys.economy.cadence === undefined) update["system.economy.cadence"] = "weekly";
    if (sys.economy.mode === undefined) update["system.economy.mode"] = "gold";
    if (sys.economy.amount === undefined) update["system.economy.amount"] = 0;
    if (sys.economy.enslaved === undefined) update["system.economy.enslaved"] = false;
    if (sys.economy.unpaidWeeks === undefined) update["system.economy.unpaidWeeks"] = 0;
    if (sys.economy.specialModifier === undefined) update["system.economy.specialModifier"] = 0;
  }

  if (!_isPlainObject(sys.magic)) update["system.magic"] = { mode: "implements", entries: [] };
  else {
    if (sys.magic.mode === undefined) update["system.magic.mode"] = "implements";
    if (!Array.isArray(sys.magic.entries)) update["system.magic.entries"] = [];
  }

  if (!_isPlainObject(sys.equipment)) update["system.equipment"] = { owned: [] };
  else if (!Array.isArray(sys.equipment.owned)) update["system.equipment.owned"] = [];

  if (!_isPlainObject(sys.variant)) update["system.variant"] = { tags: [], overrides: {} };
  else {
    if (!Array.isArray(sys.variant.tags)) update["system.variant.tags"] = [];
    if (!_isPlainObject(sys.variant.overrides)) update["system.variant.overrides"] = {};
  }

  if (!_isPlainObject(sys.status)) {
    update["system.status"] = {
      leaderless: false,
      battle: {
        hidden: false,
        ambushReady: false,
        revealed: true,
        routed: false,
        broken: false,
        suppressed: false,
        defeated: false,
        frenzied: false,
        flyer: false,
      },
    };
  } else {
    if (sys.status.leaderless === undefined) update["system.status.leaderless"] = false;
    if (!_isPlainObject(sys.status.battle)) {
      update["system.status.battle"] = {
        hidden: false,
        ambushReady: false,
        revealed: true,
        routed: false,
        broken: false,
        suppressed: false,
        defeated: false,
        frenzied: false,
        flyer: false,
      };
    } else {
      if (sys.status.battle.hidden === undefined) update["system.status.battle.hidden"] = false;
      if (sys.status.battle.ambushReady === undefined) update["system.status.battle.ambushReady"] = false;
      if (sys.status.battle.revealed === undefined) update["system.status.battle.revealed"] = true;
      if (sys.status.battle.routed === undefined) update["system.status.battle.routed"] = false;
      if (sys.status.battle.broken === undefined) update["system.status.battle.broken"] = false;
      if (sys.status.battle.suppressed === undefined) update["system.status.battle.suppressed"] = false;
      if (sys.status.battle.defeated === undefined) update["system.status.battle.defeated"] = false;
      if (sys.status.battle.frenzied === undefined) update["system.status.battle.frenzied"] = false;
      if (sys.status.battle.flyer === undefined) update["system.status.battle.flyer"] = false;
    }
  }

  if (!_isPlainObject(sys.modifiers)) update["system.modifiers"] = {};
  if (!_isPlainObject(sys.modifiers?.discipline)) {
    update["system.modifiers.discipline"] = {
      manual: 0,
      campaign: {
        inspiringSpeech: false,
        forcedMarch: false,
        poorClimate: false,
        longCampaign: false,
        defendingAlliedSettlement: false,
      },
      battle: {
        rearCharged: false,
        adjacentFriendlyBroken: false,
        commanderLost: false,
        rallyBonus: false,
        enemyBrokenBonus: false,
      },
    };
  } else {
    if (sys.modifiers.discipline.manual === undefined) update["system.modifiers.discipline.manual"] = 0;
    if (!_isPlainObject(sys.modifiers.discipline.campaign)) {
      update["system.modifiers.discipline.campaign"] = {
        inspiringSpeech: false,
        forcedMarch: false,
        poorClimate: false,
        longCampaign: false,
        defendingAlliedSettlement: false,
      };
    } else {
      if (sys.modifiers.discipline.campaign.inspiringSpeech === undefined) update["system.modifiers.discipline.campaign.inspiringSpeech"] = false;
      if (sys.modifiers.discipline.campaign.forcedMarch === undefined) update["system.modifiers.discipline.campaign.forcedMarch"] = false;
      if (sys.modifiers.discipline.campaign.poorClimate === undefined) update["system.modifiers.discipline.campaign.poorClimate"] = false;
      if (sys.modifiers.discipline.campaign.longCampaign === undefined) update["system.modifiers.discipline.campaign.longCampaign"] = false;
      if (sys.modifiers.discipline.campaign.defendingAlliedSettlement === undefined) update["system.modifiers.discipline.campaign.defendingAlliedSettlement"] = false;
    }
    if (!_isPlainObject(sys.modifiers.discipline.battle)) {
      update["system.modifiers.discipline.battle"] = {
        rearCharged: false,
        adjacentFriendlyBroken: false,
        commanderLost: false,
        rallyBonus: false,
        enemyBrokenBonus: false,
      };
    } else {
      if (sys.modifiers.discipline.battle.rearCharged === undefined) update["system.modifiers.discipline.battle.rearCharged"] = false;
      if (sys.modifiers.discipline.battle.adjacentFriendlyBroken === undefined) update["system.modifiers.discipline.battle.adjacentFriendlyBroken"] = false;
      if (sys.modifiers.discipline.battle.commanderLost === undefined) update["system.modifiers.discipline.battle.commanderLost"] = false;
      if (sys.modifiers.discipline.battle.rallyBonus === undefined) update["system.modifiers.discipline.battle.rallyBonus"] = false;
      if (sys.modifiers.discipline.battle.enemyBrokenBonus === undefined) update["system.modifiers.discipline.battle.enemyBrokenBonus"] = false;
    }
  }

  if (!_isPlainObject(sys.commander)) update["system.commander"] = { uuid: "", id: "", name: "", img: "", bonusOverride: 0 };
  else {
    if (sys.commander.uuid === undefined) update["system.commander.uuid"] = "";
    if (sys.commander.id === undefined) update["system.commander.id"] = "";
    if (sys.commander.name === undefined) update["system.commander.name"] = "";
    if (sys.commander.img === undefined) update["system.commander.img"] = "";
    if (sys.commander.bonusOverride === undefined) update["system.commander.bonusOverride"] = 0;
  }
  if (!_isPlainObject(sys.commanderAttachment)) {
    update["system.commanderAttachment"] = { leaderActorUuid: "", warfareTokenUuid: "", leaderTokenUuid: "", sceneId: "" };
  } else {
    if (sys.commanderAttachment.leaderActorUuid === undefined) update["system.commanderAttachment.leaderActorUuid"] = "";
    if (sys.commanderAttachment.warfareTokenUuid === undefined) update["system.commanderAttachment.warfareTokenUuid"] = "";
    if (sys.commanderAttachment.leaderTokenUuid === undefined) update["system.commanderAttachment.leaderTokenUuid"] = "";
    if (sys.commanderAttachment.sceneId === undefined) update["system.commanderAttachment.sceneId"] = "";
  }
  if (!_isPlainObject(sys.classification)) update["system.classification"] = { unitType: "", ancestry: "", mount: "none", tier: "light" };
  else {
    if (sys.classification.unitType === undefined) update["system.classification.unitType"] = "";
    if (sys.classification.ancestry === undefined) update["system.classification.ancestry"] = "";
    if (sys.classification.mount === undefined) update["system.classification.mount"] = "none";
    if (sys.classification.tier === undefined) update["system.classification.tier"] = "light";
  }
  if (!_isPlainObject(sys.stats)) update["system.stats"] = {
    bulk: { value: 1, max: 0 },
    resolve: { value: 0, max: 0, lossTotal: 0 },
    discipline: { value: 0, base: 0, bonus: 0 },
    condition: { value: 0, max: 0, maxOverride: 0, useMaxOverride: false },
    magicka: { value: 0, max: 0 },
    speed: { value: 0, base: 0, bonus: 0 },
  };
  else {
    if (!_isPlainObject(sys.stats.bulk)) update["system.stats.bulk"] = { value: 1, max: 0, lossTotal: 0 };
    else {
      if (sys.stats.bulk.value === undefined) update["system.stats.bulk.value"] = 1;
      if (sys.stats.bulk.max === undefined) update["system.stats.bulk.max"] = 0;
      if (sys.stats.bulk.lossTotal === undefined) {
        const bulkMax = Number(sys.stats.bulk.max ?? sys.stats.bulk.value ?? 1) || 1;
        const bulkValue = Number(sys.stats.bulk.value ?? bulkMax) || bulkMax;
        update["system.stats.bulk.lossTotal"] = Math.max(0, bulkMax - bulkValue);
      }
    }

    if (!_isPlainObject(sys.stats.resolve)) update["system.stats.resolve"] = { value: 0, max: 0, lossTotal: 0 };
    else {
      if (sys.stats.resolve.value === undefined) update["system.stats.resolve.value"] = 0;
      if (sys.stats.resolve.max === undefined) update["system.stats.resolve.max"] = 0;
      if (sys.stats.resolve.lossTotal === undefined) update["system.stats.resolve.lossTotal"] = 0;
    }

    if (!_isPlainObject(sys.stats.discipline)) update["system.stats.discipline"] = { value: 0, base: 0, bonus: 0 };
    else {
      if (sys.stats.discipline.value === undefined) update["system.stats.discipline.value"] = 0;
      if (sys.stats.discipline.base === undefined) update["system.stats.discipline.base"] = 0;
      if (sys.stats.discipline.bonus === undefined) update["system.stats.discipline.bonus"] = 0;
    }

    if (!_isPlainObject(sys.stats.condition)) update["system.stats.condition"] = { value: 0, max: 0, maxOverride: 0, useMaxOverride: false };
    else {
      if (sys.stats.condition.value === undefined) update["system.stats.condition.value"] = 0;
      if (sys.stats.condition.max === undefined) update["system.stats.condition.max"] = 0;
      if (sys.stats.condition.maxOverride === undefined) update["system.stats.condition.maxOverride"] = 0;
      if (sys.stats.condition.useMaxOverride === undefined) update["system.stats.condition.useMaxOverride"] = false;
    }

    if (!_isPlainObject(sys.stats.magicka)) update["system.stats.magicka"] = { value: 0, max: 0 };
    else {
      if (sys.stats.magicka.value === undefined) update["system.stats.magicka.value"] = 0;
      if (sys.stats.magicka.max === undefined) update["system.stats.magicka.max"] = 0;
    }

    if (!_isPlainObject(sys.stats.speed)) update["system.stats.speed"] = { value: 0, base: 0, bonus: 0 };
    else {
      if (sys.stats.speed.value === undefined) update["system.stats.speed.value"] = 0;
      if (sys.stats.speed.base === undefined) update["system.stats.speed.base"] = 0;
      if (sys.stats.speed.bonus === undefined) update["system.stats.speed.bonus"] = 0;
    }
  }
  if (!_isPlainObject(sys.gear)) update["system.gear"] = { tier: "light", apparel: "light", sets: 0, dmg: "", ar: 0, mar: 0, speedPenalty: 0, cost: 0 };
  else {
    if (sys.gear.tier === undefined) update["system.gear.tier"] = "light";
    if (sys.gear.apparel === undefined) update["system.gear.apparel"] = String(sys.gear.tier ?? "light");
    if (sys.gear.sets === undefined) update["system.gear.sets"] = 0;
    if (sys.gear.dmg === undefined) update["system.gear.dmg"] = "";
    if (sys.gear.ar === undefined) update["system.gear.ar"] = 0;
    if (sys.gear.mar === undefined) update["system.gear.mar"] = 0;
    if (sys.gear.speedPenalty === undefined) update["system.gear.speedPenalty"] = 0;
    if (sys.gear.cost === undefined) update["system.gear.cost"] = 0;
  }
  if (!_isPlainObject(sys.racial)) update["system.racial"] = { speedMod: 0, magickaMod: 0, offenseMod: 0, offenseType: "", conditionMod: 0, disciplineMod: 0, special: "" };
  else {
    if (sys.racial.speedMod === undefined) update["system.racial.speedMod"] = 0;
    if (sys.racial.magickaMod === undefined) update["system.racial.magickaMod"] = 0;
    if (sys.racial.offenseMod === undefined) update["system.racial.offenseMod"] = 0;
    if (sys.racial.offenseType === undefined) update["system.racial.offenseType"] = "";
    if (sys.racial.conditionMod === undefined) update["system.racial.conditionMod"] = 0;
    if (sys.racial.disciplineMod === undefined) update["system.racial.disciplineMod"] = 0;
    if (sys.racial.special === undefined) update["system.racial.special"] = "";
  }
  if (!_isPlainObject(sys.combat)) update["system.combat"] = { hidden: false, deployed: false, leaderless: false };
  else {
    if (sys.combat.hidden === undefined) update["system.combat.hidden"] = false;
    if (sys.combat.deployed === undefined) update["system.combat.deployed"] = false;
    if (sys.combat.leaderless === undefined) update["system.combat.leaderless"] = false;
  }
  if (!_isPlainObject(sys.upkeep)) update["system.upkeep"] = { weeklyGold: 0, enslaved: false };
  else {
    if (sys.upkeep.weeklyGold === undefined) update["system.upkeep.weeklyGold"] = 0;
    if (sys.upkeep.enslaved === undefined) update["system.upkeep.enslaved"] = false;
  }
  if (!_isPlainObject(sys.rules)) update["system.rules"] = { source: "UESRPG Mass Warfare 3e", version: "2.0" };
  else {
    if (sys.rules.source === undefined) update["system.rules.source"] = "UESRPG Mass Warfare 3e";
    if (sys.rules.version === undefined) update["system.rules.version"] = "2.0";
  }
  if (!Array.isArray(sys.traits)) update["system.traits"] = [];
  if (!Array.isArray(sys.deployableEquipment)) update["system.deployableEquipment"] = [];
  if (!Array.isArray(sys.spells)) update["system.spells"] = [];

  return update;
}

// ---------------------------------------------------------------------------
// Always-safe normalization (not version-gated)
// ---------------------------------------------------------------------------

export async function normalizeActors() {
  if (!game.user.isGM) return;
  try {
    const updates = [];

    for (const actor of game.actors.contents) {
      const sys = actor.system;

      // Repair invalid system payload.
      if (!_isPlainObject(sys)) {
        updates.push(_buildInvalidActorSystemPatch(actor));
        continue;
      }

      // Standard resistance defaults (PC/NPC/Group).
      const update = _ensureResistanceDefaults(sys);

      // Warfare Unit structural defaults.
      if (actor.type === "Warfare Unit") {
        const wfUpdate = _ensureWarfareUnitDefaults(sys);
        Object.assign(update, wfUpdate);
        if (actor.getFlag?.(SYSTEM_ID, "warfareConditionInitialized") === undefined) {
          update[WARFARE_CONDITION_INIT_FLAG_PATH] = true;
        }
      }

      if (Object.keys(update).length) {
        update._id = actor.id;
        updates.push(update);
      }
    }

    if (updates.length) {
      console.log(`${MODULE_ID} | Normalizing ${updates.length} actor(s)`);
      await Actor.updateDocuments(updates, { diff: false });
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Actor normalization failed`, err);
    ui.notifications?.error?.("UESRPG actor normalization failed; check console for details.");
  }
}

// ---------------------------------------------------------------------------
// Version-gated migration: Warfare Unit neutral lane back-fill
// ---------------------------------------------------------------------------

const _WF_NEUTRAL_LANE_MIGRATION_KEY = "warfareUnitNeutralLanesV1";

/**
 * Copies legacy Warfare Unit fields into canonical neutral lanes.
 * Safe to re-run (additive, only writes missing lanes via undefined check).
 * Old lanes are preserved — they are NOT removed.
 *
 * Mapping:
 *   classification.unitType   → identity.category
 *   classification.ancestry   → identity.ancestry
 *   classification.mount      → mounts.primary
 *   classification.tier       → gear.tier
 *   racial.*                  → composition.racialMods.*
 *   upkeep.weeklyGold         → economy.amount  (mode=gold, cadence=weekly)
 *   upkeep.enslaved           → economy.enslaved
 *   spells[]                  → magic.entries[]  (if magic.entries is empty)
 *   deployableEquipment[]     → equipment.owned[]  (if owned is empty)
 *   combat.leaderless         → status.leaderless
 *   combat.hidden             → status.battle.hidden
 */
function _buildWarfareNeutralLanePatch(sys) {
  const update = {};
  if (!_isPlainObject(sys)) return update;

  const safeCategoryMap = {
    warriors: "warriors",
    warrior: "warriors",
    auxiliaries: "auxiliaries",
    auxiliary: "auxiliaries",
  };

  // profile.id — set to default if absent
  if (!sys.profile?.id) update["system.profile.id"] = "uesrpg-0_2";

  // identity
  if (!sys.identity?.category && sys.classification?.unitType !== undefined) {
    const mapped = safeCategoryMap[String(sys.classification.unitType ?? "").trim().toLowerCase()];
    if (mapped) update["system.identity.category"] = mapped;
  }
  if (!sys.identity?.ancestry && sys.classification?.ancestry !== undefined) {
    update["system.identity.ancestry"] = String(sys.classification.ancestry ?? "");
  }

  // mounts
  if (!sys.mounts?.primary && sys.classification?.mount !== undefined) {
    update["system.mounts.primary"] = String(sys.classification.mount ?? "none");
  }

  // gear.tier
  if (!sys.gear?.tier && sys.classification?.tier !== undefined) {
    update["system.gear.tier"] = String(sys.classification.tier ?? "light");
  }
  if (!sys.gear?.apparel && (sys.gear?.tier !== undefined || sys.classification?.tier !== undefined)) {
    update["system.gear.apparel"] = String(sys.gear?.tier ?? sys.classification?.tier ?? "light");
  }

  // composition.racialPresetKey — derive from legacy ancestry if absent
  if (!sys.composition?.racialPresetKey && sys.classification?.ancestry) {
    update["system.composition.racialPresetKey"] = String(sys.classification.ancestry).toLowerCase();
  }

  // composition.racialMods (only if block is absent or all-zero defaults)
  const srcRacial = _isPlainObject(sys.racial) ? sys.racial : null;
  const dstRacialMods = _isPlainObject(sys.composition?.racialMods) ? sys.composition.racialMods : null;
  if (srcRacial && !dstRacialMods) {
    update["system.composition.racialMods"] = {
      speedMod:    srcRacial.speedMod    ?? 0,
      magickaMod:  srcRacial.magickaMod  ?? 0,
      offenseMod:  srcRacial.offenseMod  ?? 0,
      offenseType: srcRacial.offenseType ?? "",
      conditionMod:  srcRacial.conditionMod  ?? 0,
      disciplineMod: srcRacial.disciplineMod ?? 0,
      special:     srcRacial.special ?? "",
    };
  }

  // economy
  if (!_isPlainObject(sys.economy) || sys.economy.amount === undefined) {
    const srcUpkeep = _isPlainObject(sys.upkeep) ? sys.upkeep : {};
    update["system.economy.cadence"]  = "weekly";
    update["system.economy.mode"]     = "gold";
    update["system.economy.amount"]   = Number(srcUpkeep.weeklyGold ?? 0);
    update["system.economy.enslaved"] = Boolean(srcUpkeep.enslaved ?? false);
  }

  if (!sys.stats?.resolve && _isPlainObject(sys.stats?.condition)) {
    update["system.stats.resolve"] = {
      value: Number(sys.stats.condition.value ?? 0) || 0,
      max: Number(sys.stats.condition.max ?? 0) || 0,
      lossTotal: Math.max(0, (Number(sys.stats.condition.max ?? 0) || 0) - (Number(sys.stats.condition.value ?? 0) || 0)),
    };
  }

  // magic.entries — copy from legacy spells[] if entries is empty
  if (!Array.isArray(sys.magic?.entries) || sys.magic.entries.length === 0) {
    const srcSpells = Array.isArray(sys.spells) ? sys.spells : [];
    if (srcSpells.length > 0) {
      update["system.magic.entries"] = srcSpells.map((s) => ({
        name:   String(s.name   ?? ""),
        effect: String(s.effect ?? ""),
      }));
    }
  }

  // equipment.owned — copy from legacy deployableEquipment[] if owned is empty
  if (!Array.isArray(sys.equipment?.owned) || sys.equipment.owned.length === 0) {
    const srcEquip = Array.isArray(sys.deployableEquipment) ? sys.deployableEquipment : [];
    if (srcEquip.length > 0) {
      update["system.equipment.owned"] = srcEquip.map((e) => ({
        name:        String(e.name   ?? ""),
        description: String(e.effect ?? ""),
      }));
    }
  }

  // status.leaderless
  if (sys.status?.leaderless === undefined && sys.combat?.leaderless !== undefined) {
    update["system.status.leaderless"] = Boolean(sys.combat.leaderless);
  }

  // status.battle.hidden
  if (sys.status?.battle?.hidden === undefined && sys.combat?.hidden !== undefined) {
    update["system.status.battle.hidden"] = Boolean(sys.combat.hidden);
  }

  return update;
}

/**
 * Run neutral lane back-fill migration for all Warfare Unit actors.
 * Version-gated via migrationState key; idempotent.
 */
export async function migrateWarfareUnitNeutralLanesIfNeeded() {
  if (!game.user?.isGM) return;

  const currentVersion = getSystemVersionString();
  const state = getMigrationState();
  if (state?.[_WF_NEUTRAL_LANE_MIGRATION_KEY]) return;

  try {
    const updates = [];

    for (const actor of game.actors.contents) {
      if (actor.type !== "Warfare Unit") continue;
      const sys = actor.system;
      const patch = _buildWarfareNeutralLanePatch(sys);
      if (Object.keys(patch).length) {
        patch._id = actor.id;
        updates.push(patch);
      }
    }

    if (updates.length) {
      console.log(`${MODULE_ID} | Warfare Unit neutral lane migration: updating ${updates.length} actor(s)`);
      await Actor.updateDocuments(updates, { diff: false });
    }

    // Stamp migration as done regardless of update count (0 actors = no migration needed).
    state[_WF_NEUTRAL_LANE_MIGRATION_KEY] = { appliedAt: Date.now(), updatedCount: updates.length, systemVersion: currentVersion };
    await setMigrationState(state);
    console.log(`${MODULE_ID} | Warfare Unit neutral lane migration complete (${updates.length} actor(s) updated)`);
  } catch (err) {
    console.error(`${MODULE_ID} | Warfare Unit neutral lane migration failed`, err);
    ui.notifications?.error?.("UESRPG Warfare Unit neutral lane migration failed; check console for details.");
  }
}
