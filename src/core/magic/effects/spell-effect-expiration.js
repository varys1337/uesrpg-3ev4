/**
 * @module magic/effects/spell-effect-expiration
 *
 * src/core/magic/spell-effect-expiration.js
 *
 * GM-side expiration & combat-binding refresh for spell-created Active Effects.
 *
 * Why this exists:
 *  - Foundry tracks durations, but removing expired AEs in real-time becomes inconsistent
 *    when external calendar modules advance time (Calendaria, Simple Timekeeping, etc.).
 *  - We use the MagicTimekeeping helper as a single integration point for world-time change
 *    events and providers.
 *
 * Contract:
 *  - Only affects system-generated spell AEs (flags[uesrpg-3ev4].spellEffect && owner === "system").
 *  - Non-Upkeep: expired effects are deleted.
 *  - Upkeep: on expiry the effect is disabled, and is eligible for upkeep prompts; if not refreshed
 *    it will be deleted after a short grace window.
 */

import { MagicTimekeeping } from "../timekeeping-helper.js";
import { requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { safeGetEffect, safeGetEffectByUuidSync, isMissingDocError as _isMissingDocError } from "../../../utils/ae-helpers.js";
import { _num } from "../_primitives.js";

const _FLAG_NS = "uesrpg-3ev4";
const _deleteInFlight = new Map();

function _fromUuidSync(uuid) {
  return safeGetEffectByUuidSync(uuid);
}

function _getCasterCombatTurnIndex(combat, effect) {
  if (!combat || !effect) return null;
  const flags = effect.flags?.[_FLAG_NS] ?? {};
  const casterUuid = String(flags?.casterUuid ?? "");
  if (!casterUuid) return null;

  const doc = _fromUuidSync(casterUuid);
  const actor = doc?.documentName === "Actor" ? doc : doc?.actor;
  if (!actor) return null;

  const combatants = typeof combat.getCombatantsByActor === "function"
    ? combat.getCombatantsByActor(actor)
    : [];
  const combatant = Array.isArray(combatants) ? combatants[0] : null;
  if (!combatant) return null;

  const turns = Array.isArray(combat.turns) ? combat.turns : Array.from(combat.combatants ?? []);
  const idx = turns.findIndex(c => c?.id === combatant.id);
  if (idx < 0) return null;
  return idx;
}

function _deleteKey(actor, effect) {
  if (!actor?.uuid || !effect?.id) return "";
  return `${actor.uuid}::${effect.id}`;
}

function _isDeleteInFlight(actor, effect, nowTime) {
  const key = _deleteKey(actor, effect);
  if (!key) return false;
  const entry = _deleteInFlight.get(key);
  if (!entry) return false;
  const ttl = Math.max(1, _num(MagicTimekeeping.roundTimeSeconds(), 6));
  if ((_num(nowTime, 0) - entry.time) <= ttl) return true;
  _deleteInFlight.delete(key);
  return false;
}

function _markDeleteInFlight(actor, effect, nowTime) {
  const key = _deleteKey(actor, effect);
  if (!key) return;
  _deleteInFlight.set(key, { time: _num(nowTime, MagicTimekeeping.nowWorldTimeSeconds()) });
}

function _isSystemSpellEffect(effect) {
  if (!effect) return false;
  const f = effect.flags?.[_FLAG_NS];
  return Boolean(f?.spellEffect) && String(f?.owner ?? "") === "system";
}

function _getEndTime(effect) {
  const d = effect?.duration ?? {};
  const seconds = _num(d.seconds, 0);
  const startTime = _num(d.startTime, 0);
  if (!(seconds > 0) || !(startTime > 0)) return null;
  if (!Number.isFinite(seconds)) return null;
  return startTime + seconds;
}

function _isExpiredByWorldTime(effect, nowTime) {
  const end = _getEndTime(effect);
  if (end == null) return false;
  return nowTime >= end;
}

/**
 * Combat expiry semantics:
 * - For an effect with duration.rounds = N and (startRound, startTurn), it expires when combat reaches
 *   the same turn index on round (startRound + N).
 *
 * This matches the expected "beginning of the actor's turn" behavior for round-based spell durations.
 */
function _isExpiredByCombat(effect, combat, { inclusive = false, endTurnOverride = null } = {}) {
  if (!combat) return false;
  const d = effect?.duration ?? {};

  const rounds = _num(d.rounds, 0);
  if (!(rounds > 0) || !Number.isFinite(rounds)) return false;

  // startRound/startTurn can legitimately be 0 depending on when combat was initialized.
  const srRaw = d.startRound;
  const stRaw = d.startTurn;
  if (srRaw === null || srRaw === undefined) return false;
  if (stRaw === null || stRaw === undefined) return false;

  const startRound = _num(srRaw, 0);
  const startTurn = _num(stRaw, 0);

  const endRound = startRound + rounds;
  const endTurn = Number.isFinite(Number(endTurnOverride)) ? _num(endTurnOverride, startTurn) : startTurn;

  const curRound = _num(combat.round, 0);
  const curTurn = _num(combat.turn, 0);

  if (inclusive) {
    return (curRound > endRound) || (curRound === endRound && curTurn >= endTurn);
  }
  return (curRound > endRound) || (curRound === endRound && curTurn > endTurn);
}

async function _deleteEffectOnActor(actor, effect, nowTime) {
  if (!actor || !effect?.id) return false;
  
  // Double-check existence before attempting deletion to prevent race conditions
  const effectExists = actor.effects?.get?.(effect.id);
  if (!effectExists) return false;
  
  if (_isDeleteInFlight(actor, effect, nowTime)) return false;
  _markDeleteInFlight(actor, effect, nowTime);
  
  try {
    // Final existence check right before deletion (minimize race window)
    if (!actor.effects?.get?.(effect.id)) return false;
    
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
    return true;
  } catch (err) {
    if (_isMissingDocError(err)) return false;
    console.error("UESRPG | spell-effect-expiration | Failed to delete effect", { actor: actor?.uuid, effectId: effect?.id, err });
    return false;
  }
}

async function _updateEffect(effect, updates) {
  if (!effect || !updates) return false;
  if (!effect.id) return false;
  const parent = effect.parent;
  if (!parent) return false;
  // Use safe getter to avoid "does not exist" errors
  const currentEffect = safeGetEffect(parent, effect.id);
  if (!currentEffect) return false;
  try {
    await requestUpdateDocument(currentEffect, updates);
    return true;
  } catch (err) {
    if (_isMissingDocError(err)) return false;
    console.error("UESRPG | spell-effect-expiration | Failed to update effect", { effectId: effect?.id, updates, err });
    return false;
  }
}

async function _expireSpellEffects({ nowTime, source } = {}) {
  if (!game.user?.isGM) return;

  const worldTime = _num(nowTime, MagicTimekeeping.nowWorldTimeSeconds());
  const combat = game.combat ?? null;
  const rt = _num(MagicTimekeeping.roundTimeSeconds(), 6);

  for (const actor of (MagicTimekeeping.relevantActorsArray?.() ?? Array.from(MagicTimekeeping.collectRelevantActors?.() ?? []))) {
    const effects = actor?.effects ?? [];
    for (const effect of effects) {
      if (!_isSystemSpellEffect(effect)) continue;

      const flags = effect.flags?.[_FLAG_NS] ?? {};
      const hasUpkeep = Boolean(flags?.hasUpkeep);

      const d = effect?.duration ?? {};
      const rounds = _num(d.rounds, 0);
      const combatTracked = Boolean(combat?.id) && (rounds > 0);
      const casterTurnIndex = hasUpkeep ? _getCasterCombatTurnIndex(combat, effect) : null;
      const expired = combatTracked
        ? _isExpiredByCombat(effect, combat, { inclusive: hasUpkeep, endTurnOverride: casterTurnIndex })
        : _isExpiredByWorldTime(effect, worldTime);
      if (!expired) continue;

      if (!hasUpkeep) {
        await _deleteEffectOnActor(actor, effect, worldTime);
        continue;
      }

      // Upkeep: disable at expiry so modifiers stop applying, but allow the upkeep workflow
      // to refresh it. If upkeep is not paid within a grace window (1 round), delete the effect.
      const endTime = _getEndTime(effect);
      const expiredAt = _num(flags?.expiredAtWorldTime, 0);
      const expiredAtRound = _num(flags?.expiredAtCombatRound, -1);
      const upkeepGraceWindow = rt; // 1 round (typically 6 seconds)

      if (!effect.disabled) {
        await _updateEffect(effect, {
          disabled: true,
          [`flags.${_FLAG_NS}.expiredAtWorldTime`]: worldTime,
          [`flags.${_FLAG_NS}.expiredAtCombatRound`]: combat ? _num(combat.round, 0) : -1,
          [`flags.${_FLAG_NS}.upkeepAwaiting`]: true
        });
        continue;
      }

      // Effect is already disabled (awaiting upkeep). Check if grace window has passed.
      // In combat: use round count (more reliable than world time which may not advance between turns).
      // Out of combat: use world time.
      let graceExpired = false;
      if (combat && expiredAtRound >= 0) {
        const currentRound = _num(combat.round, 0);
        // Grace = 1 full round: if we're at least 1 round past the expiry round, grace is over
        graceExpired = (currentRound - expiredAtRound) >= 1;
      } else if (expiredAt > 0) {
        graceExpired = (worldTime - expiredAt) > upkeepGraceWindow;
      }

      if (graceExpired) {
        // Grace window expired - upkeep was not paid, delete the effect
        await _deleteEffectOnActor(actor, effect, worldTime);
        continue;
      }
    }
  }
}

async function _ensureCombatStartMarkers(effect, combat) {
  try {
    if (!effect || !combat) return;
    const d = effect.duration ?? {};
    const rounds = _num(d.rounds, 0);
    if (!(rounds > 0)) return;

    const sr = d.startRound;
    const st = d.startTurn;
    const hasMarkers = (sr !== null && sr !== undefined) && (st !== null && st !== undefined);
    if (hasMarkers) return;

    await _updateEffect(effect, {
      "duration.combat": combat.id,
      "duration.startRound": _num(combat.round, 0),
      "duration.startTurn": _num(combat.turn, 0)
    });
  } catch (_e) {
    /* no-op */
  }
}

async function _refreshCombatBinding() {
  if (!game.user?.isGM) return;
  const combat = game.combat;
  if (!combat?.id) return;

  for (const actor of (MagicTimekeeping.relevantActorsArray?.() ?? Array.from(MagicTimekeeping.collectRelevantActors?.() ?? []))) {
    for (const effect of (actor?.effects ?? [])) {
      if (!_isSystemSpellEffect(effect)) continue;
      const d = effect.duration ?? {};
      const flags = effect.flags?.[_FLAG_NS] ?? {};

      const rounds = _num(d.rounds, 0);
      if (!(rounds > 0)) continue;
      if (_isExpiredByCombat(effect, combat, { inclusive: Boolean(flags?.hasUpkeep) })) continue;

      if (String(d.combat ?? "") !== String(combat.id)) {
        await _updateEffect(effect, {
          "duration.combat": combat.id,
          "duration.startRound": _num(combat.round, 0),
          "duration.startTurn": _num(combat.turn, 0)
        });
      }
      await _ensureCombatStartMarkers(effect, combat);
    }
  }
}

/**
 * Initialize the spell effect expiration system.
 *
 * Registers hooks for world-time changes and combat progression to
 * automatically expire ActiveEffects whose durations have elapsed.
 * Must be called exactly once during system boot (GM only).
 */
export function initializeSpellEffectExpirationSystem() {
  // Guard: prevent double-registration if called more than once.
  if (initializeSpellEffectExpirationSystem._initialized) return;
  initializeSpellEffectExpirationSystem._initialized = true;

  // Use the timekeeping helper as the single integration point for time change.
  MagicTimekeeping.onTimeChange(async ({ worldTime, source } = {}) => {
    if (game.combat) return;
    await _expireSpellEffects({ nowTime: worldTime, source });
  });

  // Combat: combat turn/round progression does not reliably emit world-time changes.
  // We therefore expire spell effects on combat updates as well.
  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    if (!game.user?.isGM) return;
    if (payload?.source !== "combat") return;
    if (payload?.combat?.phase && payload.combat.phase !== "post") return;
    await _expireSpellEffects({ nowTime: _num(payload?.worldTime, MagicTimekeeping.nowWorldTimeSeconds()), source: "combat" });
  });

  Hooks.on("createCombat", async () => {
    await _refreshCombatBinding();
    if (!game.user?.isGM) return;
    await _expireSpellEffects({ nowTime: MagicTimekeeping.nowWorldTimeSeconds(), source: "combat" });
  });
}

/**
 * Check whether an ActiveEffect is expired based on world time.
 *
 * Exported for other time-bound systems (combat, conditions) to reuse
 * the same expiration semantics without duplicating logic.
 *
 * @param {ActiveEffect} effect - The effect to check
 * @param {number} nowTime - Current world time in seconds
 * @returns {boolean} `true` if the effect's world-time duration has elapsed
 */
export function isEffectExpiredByWorldTime(effect, nowTime) {
  return _isExpiredByWorldTime(effect, nowTime);
}

/**
 * Check whether an ActiveEffect is expired based on combat round/turn.
 *
 * @param {ActiveEffect} effect - The effect to check
 * @param {Combat} combat - The current combat encounter
 * @param {object} [options={}] - Additional options
 * @param {number} [options.round] - Override combat round
 * @param {number} [options.turn] - Override combat turn
 * @returns {boolean} `true` if the effect's combat duration has elapsed
 */
export function isEffectExpiredByCombat(effect, combat, options = {}) {
  return _isExpiredByCombat(effect, combat, options);
}
