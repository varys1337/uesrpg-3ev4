/**
 * @module magic/effects/spell-effects
 *
 * src/core/magic/effects/spell-effects.js
 *
 * Spell effect application with RAW stacking rules and duration tracking.
 * Chapter 6 p.128 lines 234-241: Effects don't stack with themselves,
 * and opposing effects override each other.
 */

import { MagicTimekeeping } from "../timekeeping-helper.js";
import { isDebugEnabled, createDebugLogger } from "../_primitives.js";
import { spellRequiresOriginAE, createOriginAE, registerTargetAEs, findOriginAE } from "./origin-effect.js";
import { emitEffectApplied } from "../spell-runtime.js";
import { validateAEChanges } from "../../active-effects/modifier-registry.js";
import { buildOverTimeChange } from "../ticks/overtime-engine.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateDocument, requestUpdateEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { getFlagValueWithFallback } from "../../system/flags.js";
import { buildSpellExpirationAnchor } from "../../../utils/document-resolution.js";
import { buildEffectChange, getEffectChanges } from "../../../utils/compat.js";
import { buildGenericAEData } from "../../active-effects/modifier-evaluator.js";
import { buildSpellEffectMetadataFlags } from "./spell-effect-metadata.js";
import { resolveNumericSpellStrength } from "../opposed/cast-context.js";
import { getSpellCost, getSpellScalingEntry } from "../magicka-utils.js";

const _anchorDebug = createDebugLogger("aeLifecycleDebug", "[UESRPG][SpellEffects]");

/* ── OverTime entry resolution (private) ────────────────────────────────── */

/**
 * Return an array of OverTime config objects for a spell.
 * Prefers the new `overTimeEntries` array; falls back to wrapping
 * the legacy single `overTime` object so callers always iterate.
 * @param {object} spell - The spell Item document (or plain data object).
 * @returns {object[]} Array of OverTime config objects (may be empty).
 */
function _getOverTimeEntries(spell) {
  const entries = spell?.system?.overTimeEntries;
  if (Array.isArray(entries) && entries.length > 0) return entries;
  // Legacy fallback: wrap single overTime object
  const ot = spell?.system?.overTime;
  if (ot && typeof ot === "object" && Object.keys(ot).length > 0) return [ot];
  return [];
}

/* ── Spell-defense identification helpers (private) ─────────────────────── */

function _normName(s) {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Check if a spell is Spell Absorption.
 * Uses both the new `isSpellDefense` flag and legacy name-based detection.
 * Flag-based detection takes absolute precedence to prevent name collisions.
 */
function _isSpellAbsorptionSpell(spell) {
  // If the new flag system is being used, trust it exclusively
  if (spell?.system?.isSpellDefense === true) {
    return spell?.system?.spellDefenseType === "absorption";
  }
  // Legacy name-based fallback for existing spells (only when flags not used)
  const name = _normName(spell?.name);
  return name === "spell absorption" || name === "spell absorption (mysticism)";
}

/**
 * Check if a spell is Spell Reflect.
 * Uses both the new `isSpellDefense` flag and legacy name-based detection.
 * Flag-based detection takes absolute precedence to prevent name collisions.
 */
function _isReflectSpell(spell) {
  // If the new flag system is being used, trust it exclusively
  if (spell?.system?.isSpellDefense === true) {
    return spell?.system?.spellDefenseType === "reflect";
  }
  // Legacy name-based fallback for existing spells (only when flags not used)
  return _normName(spell?.name) === "reflect";
}

function _getSpellStrength(spell, options = {}) {
  const castLevel = Number(
    options?.castContext?.castLevel
    ?? options?.spellOptions?.castLevel
    ?? options?.scalingChoices?.level
    ?? getSpellScalingEntry(spell, null)?.level
    ?? 1
  ) || 1;

  let n = Number(
    options?.castContext?.spellStrengthValue
    ?? resolveNumericSpellStrength(spell, castLevel)
    ?? 0
  );

  if (!Number.isFinite(n) || n <= 0) n = 0;
  return Math.max(0, Math.min(10, Math.floor(n) || 0));
}

function _normalizeSpellEffectApplicationOptions(payload = {}) {
  return {
    actualCost: Number(payload.actualCost ?? 0),
    originalCastWorldTime: Number(payload.originalCastWorldTime ?? payload.originalCastTime ?? 0),
    spellOptions: payload.spellOptions ?? null,
    scalingChoices: payload.scalingChoices ?? null,
    castContext: payload.castContext ?? null,
    castSource: payload.castSource ?? null,
    itemCastContext: payload.itemCastContext ?? null,
    magickaSpend: payload.magickaSpend ?? null,
    casterTokenUuid: payload.casterTokenUuid ?? null,
  };
}

export async function applyResolvedSpellEffects({ casterActor, targetActor, spell, payload = {} } = {}) {
  if (!casterActor || !targetActor || !spell) return;
  await applySpellEffectsToTarget(casterActor, targetActor, spell, _normalizeSpellEffectApplicationOptions(payload));
}

/**
 * Apply spell Active Effects to target(s) with duration tracking
 * @param {Actor} casterActor - The caster of the spell
 * @param {Actor} targetActor - The target receiving the effect
 * @param {Item} spell - The spell being cast
 * @param {object} options - Additional options (actualCost, etc.)
 * @returns {Promise<void>}
 */
export async function applySpellEffectsToTarget(casterActor, targetActor, spell, options = {}) {
  const spellUuid = spell.uuid;
  const durData = spell.system?.duration ?? {};
  const durValue = Number(durData.value ?? 0);
  const durUnit = durData.unit ?? "rounds";
  const hasUpkeep = Boolean(spell.system?.hasUpkeep);
  const noListedDuration = (durUnit === "instant") || (durValue <= 0);

  // Compute the nominal duration from item data.
  let duration = computeSpellDuration(spell, options);

  // RAW (Upkeep cadence): if a spell has Upkeep but no listed duration, treat it as 1 round.
  // IMPORTANT: this must *not* be tracked as "instant" or it will never prompt/expire correctly.
  if (hasUpkeep && noListedDuration) {
    const rt = MagicTimekeeping.roundTimeSeconds();
    duration = { rounds: 1, seconds: rt, unit: "rounds" };
  }

  // RAW: Spell Absorption and Reflect always last exactly 1 round, regardless
  // of what duration the item data says.  Override AFTER the upkeep default so
  // these two spells can never exceed 1 round.
  if (_isSpellAbsorptionSpell(spell) || _isReflectSpell(spell)) {
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
  const originalCastWorldTime = Number(options.originalCastWorldTime ?? options.originalCastTime ?? nowTime);
  const nowRound = MagicTimekeeping.combatRound();
  const nowTurn = MagicTimekeeping.combatTurn();
  const expirationAnchor = buildSpellExpirationAnchor({
    casterActor,
    casterTokenUuid: options.casterTokenUuid ?? null,
    combat: game?.combat ?? null
  });
  _anchorDebug("Created spell expiration anchor", {
    spell: spell?.name ?? null,
    caster: casterActor?.name ?? null,
    target: targetActor?.name ?? null,
    round: game?.combat?.round ?? null,
    turn: game?.combat?.turn ?? null,
    anchor: expirationAnchor
  });

  const baseMetadataOptions = {
    spell,
    casterActor,
    actualCost: options.actualCost,
    originalCastWorldTime,
    spellOptions: options.spellOptions ?? null,
    scalingChoices: options.scalingChoices ?? null,
    castContext: options.castContext ?? null,
    castSource: options.castSource ?? null,
    itemCastContext: options.itemCastContext ?? null,
    magickaSpend: options.magickaSpend ?? null,
    casterTokenUuid: options.casterTokenUuid ?? null
  };

  const _buildCanonicalDuration = () => {
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
  const _buildLiveEffectDuration = (canonicalDuration) => {
    const live = foundry.utils.deepClone(canonicalDuration ?? {});
    if (!hasUpkeep) return live;
    live.seconds = 0;
    live.rounds = 0;
    live.turns = 0;
    return live;
  };

  
  // Remove existing effects from same spell (no stacking per RAW).
  // Skip Origin AEs — they are lifecycle trackers on the caster and are managed
  // separately via origin-effect.js teardown.  Deleting them here would cascade
  // and destroy linked entities (conjured items, summons, target AEs).
  const existing = targetActor.effects.filter(e => {
    if (e.origin !== spellUuid) return false;
    if (getFlagValueWithFallback(e, "isOriginAE")) return false;
    return true;
  });
  if (existing.length) {
    const ids = existing.map(e => e.id);
    await requestDeleteEmbeddedDocuments(targetActor, "ActiveEffect", ids, {
      deleteOptions: { uesrpgExpirationSweep: true }
    });
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
    
    // Validate changes against the modifier registry (dev-mode warnings)
    const clonedChanges = foundry.utils.deepClone(getEffectChanges(ef));
    if (isDebugEnabled("spellCastingDebug")) {
      validateAEChanges(clonedChanges, { context: `spell "${spell.name}" effect "${ef.name}"` });
    }

      const canonicalEffectDuration = _buildCanonicalDuration();
      const effectDuration = _buildLiveEffectDuration(canonicalEffectDuration);
      const resolvedCost = Number(options.actualCost ?? getSpellCost(spell, options?.castContext?.castLevel ?? options?.spellOptions?.castLevel ?? options?.scalingChoices?.level ?? null) ?? spell.system?.cost ?? 0) || 0;
      const spellEffectFlags = buildSpellEffectMetadataFlags({
        ...baseMetadataOptions,
        actualCost: resolvedCost,
        durationData: canonicalEffectDuration,
        targetUuids: [targetActor.uuid]
      });

      const effectData = buildGenericAEData({
        source: "spell",
        stack: {
          policy: "replace",
          group: effectGroup,
          max: null,
          strengthKey: null,
        },
        name: ef.name || spell.name,
        img: ef.img || spell.img,
        origin: spellUuid,
        disabled: false,
        duration: effectDuration,
        flags: {
          [FLAG_SCOPE]: {
            ...spellEffectFlags,
            spellEffect: true,
            expirationAnchor,
            noListedDuration,
            hasUpkeep: Boolean(spell.system?.hasUpkeep),
            upkeepCost: resolvedCost,
            owner: "system",
            source: "spell"
          }
        },
        changes: clonedChanges
      });

    // Inject OverTime changes entries (midi-qol / DAE style) if the spell has OverTime configuration.
    // Supports both the new overTimeEntries array and legacy single overTime object.
    // Only inject into the FIRST enabled embedded AE to prevent multi-fire per tick when a spell
    // has multiple embedded effects (each AE would independently tick its OverTime payload).
    if (toCreate.length === 0 && spell.system?.hasOverTime) {
      const otEntries = _getOverTimeEntries(spell);
      for (const ot of otEntries) {
        const otChange = buildOverTimeChange({
          trigger: ot.trigger,
          cadenceEvery: ot.cadenceEvery,
          cadenceUnit: ot.cadenceUnit,
          payloadType: ot.payloadType,
          formula: ot.formula,
          damageType: ot.damageType,
          saveKey: ot.saveKey,
          saveTN: ot.saveTN,
          saveSuccess: ot.saveSuccess,
          saveFailure: ot.saveFailure,
          maxTicks: ot.maxTicks,
          label: ot.label || spell.name,
          chatLog: ot.chatLog
        });
        effectData.changes.push(otChange);
      }
    }
    
    toCreate.push(effectData);
  }

  // Duration tracker: create one tracking effect if none were provided by the item.
// - For Upkeep spells with no embedded effects, this tracker is the Upkeep handle.
// - For non-Upkeep spells that still have a duration but no embedded effects, this tracker exists solely to enforce expiry.
  if (!toCreate.length) {
    const hasUpkeep = Boolean(spell.system?.hasUpkeep);
    const hasOverTime = Boolean(spell.system?.hasOverTime);
    const hasFiniteDuration =
      (Number.isFinite(duration?.seconds) && duration.seconds > 0) ||
      (Number.isFinite(duration?.rounds) && duration.rounds > 0);

    if (hasUpkeep || hasFiniteDuration || hasOverTime) {
      const effectGroup = hasUpkeep
        ? `spell.effect.${spell.id || spellUuid}.upkeep`
        : `spell.effect.${spell.id || spellUuid}.duration`;

      const canonicalTrackerDuration = _buildCanonicalDuration();
      const trackerDuration = _buildLiveEffectDuration(canonicalTrackerDuration);
      const trackerFlags = {
        ...buildSpellEffectMetadataFlags({
          ...baseMetadataOptions,
          actualCost: Number(options.actualCost ?? getSpellCost(spell, options?.castContext?.castLevel ?? options?.spellOptions?.castLevel ?? options?.scalingChoices?.level ?? null) ?? spell.system?.cost ?? 0) || 0,
          durationData: canonicalTrackerDuration,
          targetUuids: [targetActor.uuid]
        }),
        spellEffect: true,
        expirationAnchor,
        noListedDuration,
        hasUpkeep,
        upkeepCost: hasUpkeep ? (Number(options.actualCost ?? getSpellCost(spell, options?.castContext?.castLevel ?? options?.spellOptions?.castLevel ?? options?.scalingChoices?.level ?? null) ?? spell.system?.cost ?? 0) || 0) : 0,
        owner: "system",
        source: "spell"
      };

      // Build tracker AE changes array with OverTime entries (midi-qol / DAE style)
      const trackerChanges = [];
      if (hasOverTime) {
        const otEntries = _getOverTimeEntries(spell);
        for (const ot of otEntries) {
          trackerChanges.push(buildOverTimeChange({
            trigger: ot.trigger,
            cadenceEvery: ot.cadenceEvery,
            cadenceUnit: ot.cadenceUnit,
            payloadType: ot.payloadType,
            formula: ot.formula,
            damageType: ot.damageType,
            saveKey: ot.saveKey,
            saveTN: ot.saveTN,
            saveSuccess: ot.saveSuccess,
            saveFailure: ot.saveFailure,
            maxTicks: ot.maxTicks,
            label: ot.label || spell.name,
            chatLog: ot.chatLog
          }));
        }
      }

      // ── Spell Absorption / Reflect: ensure tracker AE grants the
      //    mechanical effect even when the spell has no embedded AEs. ──
      const ss = _getSpellStrength(spell, options);

      if (_isSpellAbsorptionSpell(spell)) {
        const absKey = "system.modifiers.magic.spellAbsorption";
        if (!trackerChanges.some(c => c.key === absKey)) {
          trackerChanges.push(buildEffectChange({
            key: absKey,
            type: "override",
            value: String(ss),
            priority: 20
          }));
        }
        trackerFlags.spellDefense = { type: "absorption", ss };
        // Legacy flag path consumed by _applySpellAbsorption
        trackerFlags.spellAbsorption = ss;
      }

      if (_isReflectSpell(spell)) {
        const refKey = "system.modifiers.magic.spellReflect";
        if (!trackerChanges.some(c => c.key === refKey)) {
          trackerChanges.push(buildEffectChange({
            key: refKey,
            type: "override",
            value: String(ss),
            priority: 20
          }));
        }
        trackerFlags.spellDefense = { type: "reflect", ss };
      }

      toCreate.push(buildGenericAEData({
        source: "spell",
        stack: {
          policy: "refresh",
          group: effectGroup,
          max: null,
          strengthKey: null,
        },
        name: spell.name,
        img: spell.img,
        origin: spellUuid,
        disabled: false,
        duration: trackerDuration,
        flags: { [FLAG_SCOPE]: trackerFlags },
        changes: trackerChanges
      }));
    }
  }

  // Initialize createdEffects to prevent undefined reference errors
  let createdEffects = [];

  if (toCreate.length) {
    // Add back-link to Origin AE if one exists for this spell on the caster
    const originAE = findOriginAE(casterActor, spellUuid);
    if (originAE) {
      for (const data of toCreate) {
        data.flags = data.flags ?? {};
        data.flags[FLAG_SCOPE] = data.flags[FLAG_SCOPE] ?? {};
        data.flags[FLAG_SCOPE].originAEUuid = originAE.uuid;
        data.flags[FLAG_SCOPE].originAEId = originAE.id;
      }
    }

    createdEffects = await requestCreateEmbeddedDocuments(targetActor, "ActiveEffect", toCreate);

    // Register target AEs with the Origin AE for deterministic teardown
    if (originAE && Array.isArray(createdEffects) && createdEffects.length) {
      try {
        await registerTargetAEs(originAE, createdEffects, targetActor);
      } catch (_e) {
        // best-effort — Origin AE linking is non-blocking
      }
    }

    // Emit effectApplied hook
    try {
      emitEffectApplied({
        caster: casterActor,
        target: targetActor,
        spell,
        effects: Array.isArray(createdEffects) ? createdEffects : [],
        originEffect: originAE
      });
    } catch (_e) { /* no-op */ }
  }

  // ── Buffer / Barrier application ──────────────────────────────────────
  // If the spell has a buffer config, set the target's buffer pool to the computed value.
  // "SS" in the formula is replaced with the spell's damageFormula value (evaluated).
  if (spell.system?.hasBuffer && spell.system?.buffer?.type && spell.system.buffer.type !== "none") {
    const bufferType = spell.system.buffer.type; // "physical", "magical", "elemental"
    const bufferFormula = String(spell.system.buffer.formula || spell.system.damageFormula || "0").trim();

    if (bufferFormula && bufferType) {
      try {
        const spellStrength = _getSpellStrength(spell, options);
        const resolvedFormula = bufferFormula.replace(/\bSS\b/gi, String(spellStrength || 0));
        const roll = new Roll(resolvedFormula);
        await roll.evaluate();
        const bufferValue = Math.max(0, Math.floor(roll.total));

        if (bufferValue > 0) {
          const bufferPath = `system.buffers.${bufferType}`;
          const currentBuffer = Number(targetActor.system?.buffers?.[bufferType] ?? 0);
          // Buffer does not stack — set to the higher of current or new value
          const newValue = Math.max(currentBuffer, bufferValue);
          await requestUpdateDocument(targetActor, { [bufferPath]: newValue });

          // Store the original buffer value in a flag on the first created effect
          // so that upkeep can restore it later.
          if (Array.isArray(createdEffects) && createdEffects.length) {
            const firstEffect = createdEffects[0];
            if (firstEffect) {
              try {
                const live = targetActor.effects.get(firstEffect.id ?? firstEffect._id);
                if (live) {
                  await requestUpdateEmbeddedDocuments(targetActor, "ActiveEffect", [{
                    _id: live.id,
                    [`flags.${FLAG_SCOPE}.bufferApplied`]: true,
                    [`flags.${FLAG_SCOPE}.bufferType`]: bufferType,
                    [`flags.${FLAG_SCOPE}.bufferOriginalValue`]: bufferValue,
                  }]);
                }
              } catch (flagErr) {
                console.warn("UESRPG | spell-effects | Failed to store buffer flags on effect", flagErr);
              }
            }
          }

          if (isDebugEnabled("spellCastingDebug")) {
            console.log(`UESRPG | spell-effects | Buffer applied: ${bufferType} = ${newValue} (from ${bufferFormula} → ${bufferValue}) on ${targetActor.name}`);
          }
        }
      } catch (err) {
        console.error("UESRPG | spell-effects | Failed to apply buffer", err);
      }
    }
  }
}

/**
 * Compute spell duration from spell data
 * @param {Item} spell - The spell
 * @returns {object} - Object with rounds and seconds
 */
function computeSpellDuration(spell, options = {}) {
  const scaling = getSpellScalingEntry(
    spell,
    options?.castContext?.castLevel
    ?? options?.spellOptions?.castLevel
    ?? options?.scalingChoices?.level
    ?? null
  );
  const dur = scaling?.duration ?? spell.system?.duration ?? {};
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
  const { requestDeleteEmbeddedDocuments } = await import("../../../utils/authority-proxy.js");

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
    getFlagValueWithFallback(e, "spellEffect") && getFlagValueWithFallback(e, "spellName") === opposing
  );
  
  if (toRemove.length) {
    await requestDeleteEmbeddedDocuments(targetActor, "ActiveEffect", toRemove.map(e => e.id), {
      deleteOptions: { uesrpgExpirationSweep: true }
    });
    ui.notifications.info(`${opposing} was overridden by ${spell.name}.`);
  }
}
