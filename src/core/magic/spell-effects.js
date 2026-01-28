/**
 * src/core/magic/spell-effects.js
 *
 * Spell effect application with RAW stacking rules and duration tracking.
 * Chapter 6 p.128 lines 234-241: Effects don't stack with themselves,
 * and opposing effects override each other.
 */

import { MagicTimekeeping } from "./timekeeping-helper.js";

/**
 * Apply spell Active Effects to target(s) with duration tracking
 * @param {Actor} casterActor - The caster of the spell
 * @param {Actor} targetActor - The target receiving the effect
 * @param {Item} spell - The spell being cast
 * @param {object} options - Additional options (actualCost, etc.)
 * @returns {Promise<void>}
 */
export async function applySpellEffectsToTarget(casterActor, targetActor, spell, options = {}) {
  // Permission-safe embedded document operations.
  // We prefer direct operations when permitted; otherwise we proxy through an active GM/owner.
  const { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments } = await import("../../utils/authority-proxy.js");

  const spellUuid = spell.uuid;
  const durData = spell.system?.duration ?? {};
  const durValue = Number(durData.value ?? 0);
  const durUnit = durData.unit ?? "rounds";
  const hasUpkeep = Boolean(spell.system?.hasUpkeep);
  const noListedDuration = (durUnit === "instant") || (durValue <= 0);

  // Compute the nominal duration from item data.
  let duration = computeSpellDuration(spell);

  // RAW (Upkeep cadence): if a spell has Upkeep but no listed duration, treat it as 1 round.
  // IMPORTANT: this must *not* be tracked as "instant" or it will never prompt/expire correctly.
  if (hasUpkeep && noListedDuration) {
    const rt = MagicTimekeeping.roundTimeSeconds();
    duration = { rounds: 1, seconds: rt, unit: "rounds" };
  }

  // Determine tracking mode for the resulting target effects.
  // - "rounds" track via combat when combat is active, otherwise via seconds (world-time).
  // - longer durations track via seconds (world-time).
  // - "instant" means no duration tracking (used for instantaneous spell results; typically no AEs).
  const isCombat = MagicTimekeeping.isCombatActive();
  const effectiveUnit = (hasUpkeep && noListedDuration) ? "rounds" : durUnit;
  const trackingMode = (() => {
    if (effectiveUnit === "instant") return "none";
    if (effectiveUnit === "permanent") return "permanent";
    if (effectiveUnit === "rounds") return isCombat ? "combat" : "time";
    return "time";
  })();
  const nowTime = MagicTimekeeping.nowWorldTimeSeconds();
  const nowRound = MagicTimekeeping.combatRound();
  const nowTurn = MagicTimekeeping.combatTurn();

  // Build an ActiveEffect duration object with correct start markers.
  // IMPORTANT: Foundry only updates combat-based durations when combat advances.
  // If we're not in combat, we must use seconds-based durations.
  const _buildEffectDuration = () => {
    if (trackingMode === "none") return { startTime: nowTime, seconds: 0, rounds: 0, turns: 0, combat: null };
    if (trackingMode === "permanent") return { startTime: nowTime, seconds: Infinity, rounds: Infinity, turns: 0, combat: null };
    if (trackingMode === "combat") {
      return {
        combat: game?.combat?.id ?? null,
        startTime: nowTime,
        startRound: nowRound,
        startTurn: nowTurn,
        rounds: Number.isFinite(duration.rounds) ? duration.rounds : 0,
        seconds: Number.isFinite(duration.seconds) ? duration.seconds : 0,
        turns: 0
      };
    }
    // trackingMode === "time"
    return {
      combat: null,
      startTime: nowTime,
      seconds: Number.isFinite(duration.seconds) ? duration.seconds : 0,
      rounds: 0,
      turns: 0
    };
  };

  
  // Remove existing effects from same spell (no stacking per RAW)
  const existing = targetActor.effects.filter(e => e.origin === spellUuid);
  if (existing.length) {
    const ids = existing.map(e => e.id);
    if (targetActor.isOwner) await targetActor.deleteEmbeddedDocuments("ActiveEffect", ids);
    else await requestDeleteEmbeddedDocuments(targetActor, "ActiveEffect", ids);
  }
  
  // Remove opposing effects (Frenzy vs Calm, etc.)
  await removeOpposingSpellEffects(targetActor, spell);
  
  // Clone spell's Active Effects to target.
  // If the spell has Upkeep but no embedded AEs, we still create a lightweight "tracker" AE so that
  // duration/upkeep prompts have a concrete effect to operate on.
  const spellEffects = Array.from(spell.effects ?? []);
  const toCreate = [];
  
  for (const ef of spellEffects) {
    if (ef.disabled) continue;
    
    const effectKey = ef.name || ef.id || String(toCreate.length);
    const effectGroup = `spell.effect.${spell.id || spellUuid}.${effectKey}`;
    
    const effectData = {
      name: ef.name || spell.name,
      img: ef.img || spell.img,
      origin: spellUuid,
      disabled: false,
      duration: _buildEffectDuration(),
      changes: foundry.utils.duplicate(ef.changes ?? []),
      flags: {
        "uesrpg-3ev4": {
          spellEffect: true,
          spellUuid,
          spellName: spell.name,
          spellSchool: spell.system.school,
          spellLevel: spell.system.level,
          casterUuid: casterActor.uuid,
          originalCastWorldTime: nowTime,
          noListedDuration,
          hasUpkeep: Boolean(spell.system?.hasUpkeep),
          upkeepCost: options.actualCost || spell.system.cost,
          owner: "system",
          effectGroup: effectGroup,
          stackRule: "override",
          source: "spell"
        }
      }
    };
    
    toCreate.push(effectData);
  }

  // Duration tracker: create one tracking effect if none were provided by the item.
// - For Upkeep spells with no embedded effects, this tracker is the Upkeep handle.
// - For non-Upkeep spells that still have a duration but no embedded effects, this tracker exists solely to enforce expiry.
  if (!toCreate.length) {
    const hasUpkeep = Boolean(spell.system?.hasUpkeep);
    const hasFiniteDuration =
      (Number.isFinite(duration?.seconds) && duration.seconds > 0) ||
      (Number.isFinite(duration?.rounds) && duration.rounds > 0);

    if (hasUpkeep || hasFiniteDuration) {
      const effectGroup = hasUpkeep
        ? `spell.effect.${spell.id || spellUuid}.upkeep`
        : `spell.effect.${spell.id || spellUuid}.duration`;

      toCreate.push({
        name: spell.name,
        img: spell.img,
        origin: spellUuid,
        disabled: false,
        duration: _buildEffectDuration(),
        changes: [],
        flags: {
          "uesrpg-3ev4": {
            spellEffect: true,
            spellUuid,
            spellName: spell.name,
            spellSchool: spell.system.school,
            spellLevel: spell.system.level,
            casterUuid: casterActor.uuid,
            originalCastWorldTime: nowTime,
            noListedDuration,
            hasUpkeep,
            upkeepCost: hasUpkeep ? (options.actualCost || spell.system.cost) : 0,
            owner: "system",
            effectGroup: effectGroup,
            stackRule: "refresh",
            source: "spell"
          }
        }
      });
    }
  }

  
  if (toCreate.length) {
    if (targetActor.isOwner) await targetActor.createEmbeddedDocuments("ActiveEffect", toCreate);
    else await requestCreateEmbeddedDocuments(targetActor, "ActiveEffect", toCreate);
  }
}

/**
 * Compute spell duration from spell data
 * @param {Item} spell - The spell
 * @returns {object} - Object with rounds and seconds
 */
function computeSpellDuration(spell) {
  const dur = spell.system.duration || {};
  const value = Number(dur.value ?? 0);
  const unitRaw = String(dur.unit || "rounds").toLowerCase();
  const unit = (unitRaw === "round") ? "rounds"
    : (unitRaw === "minute") ? "minutes"
    : (unitRaw === "hour") ? "hours"
    : (unitRaw === "day") ? "days"
    : unitRaw;
  
  let rounds = 0;
  let seconds = 0;
  
  switch (unit) {
    case "instant":
      return { rounds: 0, seconds: 0 };
    case "rounds":
      rounds = value;
      seconds = value * MagicTimekeeping.roundTimeSeconds();
      break;
    case "minutes":
      rounds = value * 10; // 1 minute = 10 rounds
      seconds = value * 60;
      break;
    case "hours":
      rounds = value * 600;
      seconds = value * 3600;
      break;
    case "days":
      rounds = value * 14400;
      seconds = value * 86400;
      break;
    case "permanent":
      return { rounds: Infinity, seconds: Infinity };
  }
  
  return { rounds, seconds };
}

/**
 * Remove opposing spell effects (Frenzy vs Calm, etc.)
 * @param {Actor} targetActor - The target actor
 * @param {Item} spell - The spell being cast
 * @returns {Promise<void>}
 */
async function removeOpposingSpellEffects(targetActor, spell) {
  const opposingPairs = {
    "Frenzy": "Calm",
    "Calm": "Frenzy",
    "Fortify": "Weakness",
    "Weakness": "Fortify",
    "Light": "Darkness",
    "Darkness": "Light",
    "Courage": "Fear",
    "Fear": "Courage"
    // Expand as needed
  };
  
  const opposing = opposingPairs[spell.name];
  if (!opposing) return;
  
  const toRemove = targetActor.effects.filter(e => 
    e.flags["uesrpg-3ev4"]?.spellEffect && e.flags["uesrpg-3ev4"]?.spellName === opposing
  );
  
  if (toRemove.length) {
    await targetActor.deleteEmbeddedDocuments("ActiveEffect", toRemove.map(e => e.id));
    ui.notifications.info(`${opposing} was overridden by ${spell.name}.`);
  }
}

/**
 * Apply a spell effect to a target actor (legacy function, kept for compatibility)
 * Respects RAW stacking rules:
 *  - Effects don't stack with themselves
 *  - Opposing effects (e.g., Frenzy vs Calm) override each other
 *
 * @param {Actor} target - The target actor
 * @param {Item} spell - The spell being applied
 * @param {object} options - Additional options (duration, isCritical, etc.)
 * @returns {Promise<void>}
 */
export async function applySpellEffect(target, spell, options = {}) {
  // Extract spell effect data from the spell
  const changes = extractSpellChanges(spell);
  
  // If no changes to apply, exit early
  if (!changes || changes.length === 0) {
    console.log(`UESRPG | No effect changes found for spell: ${spell.name}`);
    return;
  }
  
  const effectGroup = `spell.effect.${spell.id || spell.uuid}.main`;
  const effectData = {
    name: spell.name,
    icon: spell.img,
    origin: spell.uuid,
    disabled: false,
    duration: computeSpellDurationLegacy(spell, options),
    changes,
    flags: {
      "uesrpg-3ev4": {
        spellEffect: true,
        spellUuid: spell.uuid,
        spellSchool: spell.system?.school ?? "",
        canStack: false, // RAW: effects don't stack with themselves
        owner: "system",
        effectGroup: effectGroup,
        stackRule: "override",
        source: "spell"
      }
    }
  };
  
  // Remove opposing effects first (e.g., Frenzy vs Calm)
  await removeOpposingEffects(target, spell);
  
  // Remove duplicate effects from same spell (no stacking)
  const existing = target.effects.find(e => 
    e.flags["uesrpg-3ev4"]?.spellUuid === spell.uuid
  );
  
  if (existing) {
    await existing.delete();
  }
  
  // Create new effect
  await target.createEmbeddedDocuments("ActiveEffect", [effectData]);
  
  ui.notifications.info(`${spell.name} applied to ${target.name}`);
}

/**
 * Remove opposing spell effects (legacy function)
 * E.g., Frenzy removes Calm, and vice versa
 *
 * @param {Actor} target - The target actor
 * @param {Item} spell - The spell being cast
 * @returns {Promise<void>}
 */
async function removeOpposingEffects(target, spell) {
  // Define opposing spell pairs
  const opposingPairs = {
    "frenzy": "calm",
    "calm": "frenzy",
    "light": "darkness",
    "darkness": "light",
    "courage": "fear",
    "fear": "courage"
    // Add more opposing pairs as needed
  };
  
  const spellNameNormalized = String(spell.name ?? "").toLowerCase().trim();
  const opposingName = opposingPairs[spellNameNormalized];
  
  if (!opposingName) return;
  
  // Find and remove opposing effects
  const toRemove = target.effects.filter(e => {
    const effectIsSpell = e.flags?.["uesrpg-3ev4"]?.spellEffect === true;
    const effectName = String(e.name ?? "").toLowerCase().trim();
    return effectIsSpell && effectName === opposingName;
  });
  
  if (toRemove.length > 0) {
    await target.deleteEmbeddedDocuments("ActiveEffect", toRemove.map(e => e.id));
    ui.notifications.info(`${spell.name} overrode ${toRemove.length} opposing effect(s)`);
  }
}

/**
 * Compute spell duration (legacy function)
 * For now, returns a simple duration structure
 * TODO: Parse spell.system.attributes for duration keywords
 *
 * @param {Item} spell - The spell
 * @param {object} options - Additional options
 * @returns {object} - Duration object for ActiveEffect
 */
function computeSpellDurationLegacy(spell, options = {}) {
  // Default: no duration (indefinite until dispelled)
  const duration = {
    rounds: undefined,
    seconds: undefined,
    turns: undefined
  };
  
  // Parse attributes for duration hints
  const attributes = String(spell.system?.attributes ?? "").toLowerCase();
  
  // Check for "instant" keyword - effect lasts 0 rounds
  if (attributes.includes("instant")) {
    duration.rounds = 0;
  }
  
  // Check for round-based duration (e.g., "3 rounds")
  const roundMatch = attributes.match(/(\d+)\s*round/i);
  if (roundMatch) {
    duration.rounds = Number(roundMatch[1]);
  }
  
  // Check for turn-based duration (e.g., "5 turns")
  const turnMatch = attributes.match(/(\d+)\s*turn/i);
  if (turnMatch) {
    duration.turns = Number(turnMatch[1]);
  }
  
  // Check for minute-based duration (e.g., "10 minutes")
  const minuteMatch = attributes.match(/(\d+)\s*minute/i);
  if (minuteMatch) {
    duration.seconds = Number(minuteMatch[1]) * 60;
  }
  
  return duration;
}

/**
 * Extract Active Effect changes from a spell
 * This is a placeholder - actual implementation depends on how spell effects are stored
 *
 * @param {Item} spell - The spell
 * @returns {Array} - Array of change objects for ActiveEffect
 */
function extractSpellChanges(spell) {
  // For now, return empty array
  // Future implementation should parse spell.system.attributes or spell effects
  // to generate appropriate Active Effect changes
  
  // Example structure:
  // return [
  //   { key: "system.characteristics.str.total", mode: 2, value: "+10" },
  //   { key: "system.movement.base", mode: 2, value: "+2" }
  // ];
  
  return [];
}


/**
 * Best-effort out-of-combat spell effect expiration reconciliation.
 * Some external timekeeping modules advance time without triggering Foundry's internal expiry ticks for embedded effects.
 * We aggressively clean up expired spell effects based on duration.startTime + duration.seconds when not in combat.
 *
 * GM-only: ensures a single authoritative writer.
 *
 * @param {number} [nowTime]
 */
export async function purgeExpiredSpellEffects(nowTime = MagicTimekeeping.nowWorldTimeSeconds()) {
  if (game.combat) return;
  if (!game.user?.isGM) return;

  const t = Number(nowTime);
  if (!Number.isFinite(t) || t <= 0) return;

  const { requestDeleteEmbeddedDocuments } = await import("../../utils/authority-proxy.js");

  for (const actor of (MagicTimekeeping.relevantActorsArray?.() ?? Array.from(game.actors ?? []))) {
    const ids = [];
    for (const ef of (actor.effects ?? [])) {
      if (!ef?.duration) continue;
      const flags = ef.flags?.["uesrpg-3ev4"];
      if (!flags?.spellEffect) continue;
      if (flags?.hasUpkeep) continue;

      const seconds = Number(ef.duration.seconds ?? 0);
      const startTime = Number(ef.duration.startTime ?? 0);

      if (!Number.isFinite(seconds) || seconds === Infinity) continue;
      if (!(seconds > 0) || !(startTime > 0)) continue;

      const expiresAt = startTime + seconds;
      if (Number.isFinite(expiresAt) && expiresAt <= t) ids.push(ef.id);
    }

    if (ids.length) {
      try {
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", ids);
      } catch (err) {
        console.error("UESRPG | spell-effects | purgeExpiredSpellEffects failed", { actor: actor?.name, ids }, err);
      }
    }
  }
}
