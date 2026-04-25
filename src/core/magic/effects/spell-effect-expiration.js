/**
 * @module magic/effects/spell-effect-expiration
 *
 * src/core/magic/effects/spell-effect-expiration.js
 *
 * GM-side expiration & combat-binding refresh for spell-created Active Effects.
 */

import { MagicTimekeeping } from "../timekeeping-helper.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { safeGetEffect, isMissingDocError as _isMissingDocError } from "../../../utils/ae-helpers.js";
import { _num, createDebugLogger } from "../_primitives.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { registerCombatBoundaryConsumer, noteCombatBoundaryLegacyFallbackSkip } from "../../time/combat-boundary-orchestrator.js";
import { normalizeSpellExpirationAnchor, explainSpellAnchorResolution } from "../../../utils/document-resolution.js";
import { findOriginAEByGroupKey } from "./origin-effect.js";

const _FLAG_NS = FLAG_SCOPE;
const _deleteInFlight = new Map();
const _trackedSpellEffects = new Map(); // Map<actorId, Set<effectId>>
const _anchorDebug = createDebugLogger("aeLifecycleDebug", "[UESRPG][SpellExpiration]");

function _actorId(actor) {
  return String(actor?.id ?? "").trim();
}

function _trackActorEffect(actor, effect) {
  const actorId = _actorId(actor);
  const effectId = String(effect?.id ?? "").trim();
  if (!actorId || !effectId) return;
  let bucket = _trackedSpellEffects.get(actorId);
  if (!bucket) {
    bucket = new Set();
    _trackedSpellEffects.set(actorId, bucket);
  }
  bucket.add(effectId);
}

function _untrackActorEffect(actorId, effectId) {
  const aId = String(actorId ?? "").trim();
  const eId = String(effectId ?? "").trim();
  if (!aId || !eId) return;
  const bucket = _trackedSpellEffects.get(aId);
  if (!bucket) return;
  bucket.delete(eId);
  if (!bucket.size) _trackedSpellEffects.delete(aId);
}

function _dropActor(actorId) {
  const aId = String(actorId ?? "").trim();
  if (!aId) return;
  _trackedSpellEffects.delete(aId);
}

function _hasTrackedEffects(actorId) {
  const aId = String(actorId ?? "").trim();
  if (!aId) return false;
  return (_trackedSpellEffects.get(aId)?.size ?? 0) > 0;
}

function _isSystemSpellEffect(effect) {
  if (!effect) return false;
  const f = effect.flags?.[_FLAG_NS];
  return Boolean(f?.spellEffect) && String(f?.owner ?? "") === "system";
}

function _trackEffectIfRelevant(actor, effect) {
  if (!_isSystemSpellEffect(effect)) return;
  _trackActorEffect(actor, effect);
}

function _reconcileTrackedActor(actor) {
  const actorId = _actorId(actor);
  if (!actorId) return;

  const liveIds = new Set();
  for (const effect of (actor?.effects ?? [])) {
    if (!_isSystemSpellEffect(effect)) continue;
    const effectId = String(effect?.id ?? "").trim();
    if (!effectId) continue;
    liveIds.add(effectId);
    _trackActorEffect(actor, effect);
  }

  const bucket = _trackedSpellEffects.get(actorId);
  if (!bucket) return;
  for (const effectId of Array.from(bucket)) {
    if (!liveIds.has(effectId)) bucket.delete(effectId);
  }
  if (!bucket.size) _trackedSpellEffects.delete(actorId);
}

function _seedTrackedSpellEffects() {
  _trackedSpellEffects.clear();
  const actors = MagicTimekeeping.relevantActorsArray?.() ?? Array.from(MagicTimekeeping.collectRelevantActors?.() ?? []);
  for (const actor of actors) _reconcileTrackedActor(actor);
}

function _getTrackedActors() {
  const out = [];
  for (const [actorId] of _trackedSpellEffects) {
    const actor = game.actors?.get?.(actorId) ?? null;
    if (!actor) {
      _dropActor(actorId);
      continue;
    }
    out.push(actor);
  }
  return out;
}

function _getCasterCombatTurnIndex(combat, effect) {
  if (!combat || !effect) return null;
  const flags = effect.flags?.[_FLAG_NS] ?? {};
  const anchor = normalizeSpellExpirationAnchor(flags, { combat });
  const explanation = explainSpellAnchorResolution(combat, anchor);
  _anchorDebug("Resolved expiry anchor", {
    effect: effect?.name ?? null,
    targetActor: effect?.parent?.name ?? null,
    casterUuid: explanation?.actorUuid ?? anchor?.casterUuid ?? null,
    source: explanation?.source ?? "unresolved",
    reason: explanation?.reason ?? "",
    combatantId: explanation?.combatantId ?? null,
    round: combat?.round ?? null,
    turn: combat?.turn ?? null
  });
  return explanation?.turnIndex ?? null;
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

function _getEndTime(effect) {
  const d = effect?.duration ?? {};
  const flags = effect?.flags?.[_FLAG_NS] ?? {};
  const seconds = _num(flags?.durationSeconds, _num(d.seconds, 0));
  const startTime = _num(flags?.durationStartTime, _num(d.startTime, 0));
  if (!(seconds > 0) || !(startTime > 0)) return null;
  if (!Number.isFinite(seconds)) return null;
  return startTime + seconds;
}

function _isExpiredByWorldTime(effect, nowTime) {
  const end = _getEndTime(effect);
  if (end == null) return false;
  return nowTime >= end;
}

function _isExpiredByCombat(effect, combat, { inclusive = false, endTurnOverride = null } = {}) {
  if (!combat) return false;
  const d = effect?.duration ?? {};
  const flags = effect?.flags?.[_FLAG_NS] ?? {};

  const rounds = _num(flags?.durationRounds, _num(d.rounds, 0));
  if (!(rounds > 0) || !Number.isFinite(rounds)) return false;

  const srRaw = flags?.durationStartRound ?? d.startRound;
  const stRaw = flags?.durationStartTurn ?? d.startTurn;
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
  const effectExists = actor.effects?.get?.(effect.id);
  if (!effectExists) {
    _untrackActorEffect(actor?.id, effect?.id);
    return false;
  }

  if (_isDeleteInFlight(actor, effect, nowTime)) return false;
  _markDeleteInFlight(actor, effect, nowTime);

  try {
    if (!actor.effects?.get?.(effect.id)) {
      _untrackActorEffect(actor?.id, effect?.id);
      return false;
    }

    await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id], { uesrpgExpirationSweep: true });
    const deleted = !actor.effects?.get?.(effect.id);
    _untrackActorEffect(actor?.id, effect?.id);
    return deleted;
  } catch (err) {
    if (_isMissingDocError(err)) {
      _untrackActorEffect(actor?.id, effect?.id);
      return false;
    }
    console.error("UESRPG | spell-effect-expiration | Failed to delete effect", { actor: actor?.uuid, effectId: effect?.id, err });
    return false;
  }
}

async function _updateEffect(effect, updates) {
  if (!effect || !updates) return false;
  if (!effect.id) return false;
  const parent = effect.parent;
  if (!parent) return false;
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

async function _collectEffectsForGroup(groupKey) {
  const gk = String(groupKey ?? "").trim();
  if (!gk) return [];
  const matches = [];
  for (const actor of _getTrackedActors()) {
    _reconcileTrackedActor(actor);
    for (const effect of (actor?.effects ?? [])) {
      const flags = effect?.flags?.[_FLAG_NS] ?? {};
      if (!_isSystemSpellEffect(effect)) continue;
      if (String(flags?.upkeepGroupKey ?? "").trim() !== gk) continue;
      matches.push({ actor, effect, flags });
    }
  }
  matches.sort((a, b) => Number(Boolean(b.flags?.isOriginAE)) - Number(Boolean(a.flags?.isOriginAE)));
  return matches;
}

function _buildBoundaryState(effect, flags, { combat = null, worldTime = 0, casterTurnIndex = null } = {}) {
  const d = effect?.duration ?? {};
  const rounds = _num(flags?.durationRounds, _num(d.rounds, 0));
  if (combat?.id && rounds > 0) {
    const startRound = _num(flags?.durationStartRound, _num(d.startRound, 0));
    const startTurn = _num(flags?.durationStartTurn, _num(d.startTurn, 0));
    const endTurn = Number.isFinite(Number(casterTurnIndex)) ? _num(casterTurnIndex, startTurn) : startTurn;
    return {
      mode: "combat",
      endRound: startRound + rounds,
      endTurn,
      expiredAtWorldTime: _num(worldTime, 0),
      expiredAtCombatRound: _num(combat.round, 0)
    };
  }

  const seconds = _num(flags?.durationSeconds, _num(d.seconds, 0));
  const startTime = _num(flags?.durationStartTime, _num(d.startTime, 0));
  return {
    mode: "realtime",
    endTime: (seconds > 0 && startTime > 0) ? (startTime + seconds) : _num(worldTime, 0),
    expiredAtWorldTime: _num(worldTime, 0),
    expiredAtCombatRound: combat ? _num(combat.round, 0) : -1
  };
}

async function _markGroupAwaitingUpkeep(originEffect, originActor, boundaryState) {
  const originFlags = originEffect?.flags?.[_FLAG_NS] ?? {};
  const groupKey = String(originFlags?.upkeepGroupKey ?? "").trim();
  if (!originEffect?.id || !originActor?.id || !groupKey) return false;

  const matches = await _collectEffectsForGroup(groupKey);
  if (!matches.length) return false;

  const promptSignature = boundaryState.mode === "combat"
    ? `cb:${_num(boundaryState.endRound, 0)}:${_num(boundaryState.endTurn, 0)}`
    : `rt:${_num(boundaryState.endTime, 0)}`;
  const alreadyAwaiting = Boolean(originFlags?.upkeepAwaiting);
  const alreadySignature = String(originFlags?.upkeepPromptSignature ?? "");
  if (alreadyAwaiting && alreadySignature === promptSignature) return false;

  for (const match of matches) {
    const live = safeGetEffect(match.actor, match.effect?.id);
    if (!live) continue;
    const updates = {
      disabled: !Boolean(match.flags?.isOriginAE),
      [`flags.${_FLAG_NS}.upkeepAwaiting`]: true,
      [`flags.${_FLAG_NS}.expiredAtWorldTime`]: boundaryState.expiredAtWorldTime,
      [`flags.${_FLAG_NS}.expiredAtCombatRound`]: boundaryState.expiredAtCombatRound,
      [`flags.${_FLAG_NS}.upkeepBoundaryMode`]: boundaryState.mode,
      [`flags.${_FLAG_NS}.upkeepBoundaryEndTime`]: boundaryState.mode === "realtime" ? _num(boundaryState.endTime, 0) : null,
      [`flags.${_FLAG_NS}.upkeepBoundaryEndRound`]: boundaryState.mode === "combat" ? _num(boundaryState.endRound, 0) : null,
      [`flags.${_FLAG_NS}.upkeepBoundaryEndTurn`]: boundaryState.mode === "combat" ? _num(boundaryState.endTurn, 0) : null,
      [`flags.${_FLAG_NS}.upkeepPromptSignature`]: promptSignature
    };
    await _updateEffect(live, updates);
  }

  return true;
}

async function _promptAwaitingUpkeep(originEffect, boundaryState) {
  const groupKey = String(originEffect?.flags?.[_FLAG_NS]?.upkeepGroupKey ?? "").trim();
  if (!groupKey) return false;
  const { ensureUpkeepPromptForGroup } = await import("../upkeep-workflow.js");
  const promptContext = boundaryState.mode === "combat"
    ? {
        mode: "combat",
        endRound: _num(boundaryState.endRound, 0),
        endTurn: _num(boundaryState.endTurn, 0),
        atWorldTime: _num(boundaryState.expiredAtWorldTime, MagicTimekeeping.nowWorldTimeSeconds())
      }
    : {
        mode: "realtime",
        endTime: _num(boundaryState.endTime, 0),
        atWorldTime: _num(boundaryState.expiredAtWorldTime, MagicTimekeeping.nowWorldTimeSeconds())
      };
  return ensureUpkeepPromptForGroup(groupKey, promptContext);
}

async function _expireSpellEffects({ nowTime } = {}) {
  if (!game.user?.isGM) return;

  const worldTime = _num(nowTime, MagicTimekeeping.nowWorldTimeSeconds());
  const combat = game.combat ?? null;
  const rt = _num(MagicTimekeeping.roundTimeSeconds(), 6);

  for (const actor of _getTrackedActors()) {
    _reconcileTrackedActor(actor);
    const actorId = _actorId(actor);
    const effectIds = Array.from(_trackedSpellEffects.get(actorId) ?? []);

    for (const effectId of effectIds) {
      const effect = safeGetEffect(actor, effectId);
      if (!effect) {
        _untrackActorEffect(actorId, effectId);
        continue;
      }
      if (!_isSystemSpellEffect(effect)) {
        _untrackActorEffect(actorId, effectId);
        continue;
      }

      const flags = effect.flags?.[_FLAG_NS] ?? {};
      const hasUpkeep = Boolean(flags?.hasUpkeep);

      const d = effect?.duration ?? {};
      const rounds = _num(flags?.durationRounds, _num(d.rounds, 0));
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

      const expiredAt = _num(flags?.expiredAtWorldTime, 0);
      const expiredAtRound = _num(flags?.expiredAtCombatRound, -1);
      const upkeepGraceWindow = rt;
      const groupKey = String(flags?.upkeepGroupKey ?? "").trim();
      const originEffect = Boolean(flags?.isOriginAE) ? effect : findOriginAEByGroupKey(groupKey);
      const originActor = originEffect?.parent ?? null;
      const originFlags = originEffect?.flags?.[_FLAG_NS] ?? {};
      const awaiting = Boolean(originFlags?.upkeepAwaiting);

      if (awaiting) {
        let graceExpired = false;
        const authoritativeExpiredAt = _num(originFlags?.expiredAtWorldTime, expiredAt);
        const authoritativeExpiredAtRound = _num(originFlags?.expiredAtCombatRound, expiredAtRound);
        if (combat && authoritativeExpiredAtRound >= 0) {
          const currentRound = _num(combat.round, 0);
          graceExpired = (currentRound - authoritativeExpiredAtRound) >= 1;
        } else if (authoritativeExpiredAt > 0) {
          graceExpired = (worldTime - authoritativeExpiredAt) > upkeepGraceWindow;
        }

        if (!graceExpired) continue;

        if (originEffect?.id) {
          const { cancelOriginAEUpkeep } = await import("./origin-effect.js");
          await cancelOriginAEUpkeep(originEffect);
          continue;
        }
        await _deleteEffectOnActor(actor, effect, worldTime);
        continue;
      }

      if (originEffect?.id && originActor?.id) {
        const boundaryState = _buildBoundaryState(originEffect, originFlags, {
          combat,
          worldTime,
          casterTurnIndex
        });
        _anchorDebug("Marking upkeep spell instance as awaiting", {
          effect: effect?.name ?? null,
          origin: originEffect?.name ?? null,
          actor: actor?.name ?? null,
          originActor: originActor?.name ?? null,
          round: combat?.round ?? null,
          turn: combat?.turn ?? null,
          groupKey
        });
        const transitioned = await _markGroupAwaitingUpkeep(originEffect, originActor, boundaryState);
        if (transitioned) await _promptAwaitingUpkeep(originEffect, boundaryState);
        continue;
      }
    }

    if (!_hasTrackedEffects(actorId)) _dropActor(actorId);
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
    // no-op
  }
}

async function _refreshCombatBinding() {
  if (!game.user?.isGM) return;
  const combat = game.combat;
  if (!combat?.id) return;

  for (const actor of _getTrackedActors()) {
    _reconcileTrackedActor(actor);
    const actorId = _actorId(actor);
    const effectIds = Array.from(_trackedSpellEffects.get(actorId) ?? []);

    for (const effectId of effectIds) {
      const effect = safeGetEffect(actor, effectId);
      if (!effect) {
        _untrackActorEffect(actorId, effectId);
        continue;
      }
      if (!_isSystemSpellEffect(effect)) {
        _untrackActorEffect(actorId, effectId);
        continue;
      }

      const flags = effect.flags?.[_FLAG_NS] ?? {};
      const d = effect.duration ?? {};
      const rounds = _num(flags?.durationRounds, _num(d.rounds, 0));
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

    if (!_hasTrackedEffects(actorId)) _dropActor(actorId);
  }
}

function _registerTrackingHooks() {
  Hooks.on("createActiveEffect", (effect) => {
    if (!game.user?.isGM) return;
    const actor = effect?.parent;
    if (!actor || actor.documentName !== "Actor") return;
    _trackEffectIfRelevant(actor, effect);
  });

  Hooks.on("updateActiveEffect", (effect) => {
    if (!game.user?.isGM) return;
    const actor = effect?.parent;
    if (!actor || actor.documentName !== "Actor") return;

    if (_isSystemSpellEffect(effect)) _trackActorEffect(actor, effect);
    else _untrackActorEffect(actor?.id, effect?.id);
  });

  Hooks.on("deleteActiveEffect", (effect) => {
    if (!game.user?.isGM) return;
    const actor = effect?.parent;
    _untrackActorEffect(actor?.id, effect?.id);
  });
}

async function _handleCombatBoundaryExpiration(payload) {
  if (!game.user?.isGM) return;
  if (payload?.source !== "combat") return;
  if (payload?.combat?.phase && payload.combat.phase !== "post") return;
  await _expireSpellEffects({ nowTime: _num(payload?.worldTime, MagicTimekeeping.nowWorldTimeSeconds()) });
}

export function initializeSpellEffectExpirationSystem() {
  if (initializeSpellEffectExpirationSystem._initialized) return;
  initializeSpellEffectExpirationSystem._initialized = true;

  _seedTrackedSpellEffects();
  _registerTrackingHooks();

  MagicTimekeeping.onTimeChange(async ({ worldTime } = {}) => {
    if (game.combat) return;
    await _expireSpellEffects({ nowTime: worldTime });
  });

  registerCombatBoundaryConsumer({
    id: "spell-effect-expiration",
    order: 200,
    handle: _handleCombatBoundaryExpiration
  });

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    if (noteCombatBoundaryLegacyFallbackSkip("spell-effect-expiration", payload)) return;
    await _handleCombatBoundaryExpiration(payload);
  });

  Hooks.on("createCombat", async () => {
    await _refreshCombatBinding();
    if (!game.user?.isGM) return;
    await _expireSpellEffects({ nowTime: MagicTimekeeping.nowWorldTimeSeconds() });
  });
}

export function isEffectExpiredByWorldTime(effect, nowTime) {
  return _isExpiredByWorldTime(effect, nowTime);
}

export function isEffectExpiredByCombat(effect, combat, options = {}) {
  return _isExpiredByCombat(effect, combat, options);
}
