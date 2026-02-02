/**
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

import { MagicTimekeeping } from "./timekeeping-helper.js";
import { requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";

const _FLAG_NS = "uesrpg-3ev4";
const _deleteInFlight = new Map();

function _num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function _isMissingDocError(err) {
  const msg = String(err?.message ?? err ?? "");
  return msg.includes("does not exist") || msg.includes("No Document") || msg.includes("not found");
}

function _fromUuidSync(uuid) {
  const resolver = foundry?.utils?.fromUuidSync ?? globalThis.fromUuidSync;
  if (typeof resolver !== "function") return null;
  try {
    return resolver(uuid);
  } catch (_e) {
    return null;
  }
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
  if (!actor.effects?.get?.(effect.id)) return false;
  if (_isDeleteInFlight(actor, effect, nowTime)) return false;
  _markDeleteInFlight(actor, effect, nowTime);
  try {
    if (actor.isOwner || game.user?.isGM) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
      return true;
    }
    return await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
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
  if (parent?.effects?.get && !parent.effects.get(effect.id)) return false;
  try {
    if (game.user?.isGM || effect.isOwner) {
      await effect.update(updates);
      return true;
    }
    return await requestUpdateDocument(effect, updates);
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
      // to refresh it. Do not auto-delete; the upkeep prompt should resolve the outcome.
      const endTime = _getEndTime(effect);
      const expiredAt = _num(flags?.expiredAtWorldTime, 0);

      if (!effect.disabled) {
        await _updateEffect(effect, {
          disabled: true,
          [`flags.${_FLAG_NS}.expiredAtWorldTime`]: worldTime,
          [`flags.${_FLAG_NS}.upkeepAwaiting`]: true
        });
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

export function initializeSpellEffectExpirationSystem() {
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

// Exported helpers for other time-bound systems (combat, conditions) to reuse
// the same expiration semantics without duplicating logic.
export function isEffectExpiredByWorldTime(effect, nowTime) {
  return _isExpiredByWorldTime(effect, nowTime);
}

export function isEffectExpiredByCombat(effect, combat, options = {}) {
  return _isExpiredByCombat(effect, combat, options);
}
