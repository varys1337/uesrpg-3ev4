/**
 * @module magic/effects/spell-effect-expiration
 *
 * v14 ActiveEffectRegistry bridge for spell-created ActiveEffects.
 *
 * Spell effects now use native duration.value/units/expiry data. This module
 * keeps only system-specific bookkeeping: tracking spell AEs, coordinating
 * upkeep prompts before registry expiry, and invoking the v14 registry at
 * combat/time boundaries.
 */

import { MagicTimekeeping } from "../timekeeping-helper.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { safeDeleteEmbeddedDocument, safeGetEffect } from "../../../utils/ae-helpers.js";
import { _num, createDebugLogger } from "../_primitives.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { registerCombatBoundaryConsumer, noteCombatBoundaryLegacyFallbackSkip } from "../../time/combat-boundary-orchestrator.js";
import { findOriginAEByGroupKey, cancelOriginAEUpkeep } from "./origin-effect.js";
import { isFiniteDuration } from "./spell-effect-duration.js";
import { resolveUuidSync } from "../../../utils/uuid-cache.js";

const _FLAG_NS = FLAG_SCOPE;
const _trackedSpellEffects = new Map();
const _anchorDebug = createDebugLogger("aeLifecycleDebug", "[UESRPG][SpellExpiration]");

function _actorId(actor) {
  return String(actor?.id ?? "").trim();
}

function _isSystemSpellEffect(effect) {
  const flags = effect?.flags?.[_FLAG_NS] ?? null;
  return Boolean(flags?.spellEffect) && String(flags?.owner ?? "") === "system";
}

function _isDeleteActionSpellEffect(effect) {
  if (!_isSystemSpellEffect(effect)) return false;
  const flags = effect?.flags?.[_FLAG_NS] ?? {};
  const action = String(flags?.ae?.expiryAction ?? "delete").trim().toLowerCase();
  return action === "delete";
}

function _isExpired(effect) {
  return effect?.duration?.expired === true;
}

function _trackActorEffect(actor, effect) {
  const actorId = _actorId(actor);
  const effectId = String(effect?.id ?? "").trim();
  if (!actorId || !effectId || !_isSystemSpellEffect(effect)) return;
  const bucket = _trackedSpellEffects.get(actorId) ?? new Set();
  bucket.add(effectId);
  _trackedSpellEffects.set(actorId, bucket);
}

function _untrackActorEffect(actorId, effectId) {
  const bucket = _trackedSpellEffects.get(String(actorId ?? ""));
  if (!bucket) return;
  bucket.delete(String(effectId ?? ""));
  if (!bucket.size) _trackedSpellEffects.delete(String(actorId ?? ""));
}

function _reconcileTrackedActor(actor) {
  const actorId = _actorId(actor);
  if (!actorId) return;
  const liveIds = new Set();
  for (const effect of (actor?.effects ?? [])) {
    if (!_isSystemSpellEffect(effect)) continue;
    liveIds.add(String(effect.id));
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
  for (const actorId of Array.from(_trackedSpellEffects.keys())) {
    const actor = game.actors?.get?.(actorId) ?? null;
    if (!actor) {
      _trackedSpellEffects.delete(actorId);
      continue;
    }
    out.push(actor);
  }
  return out;
}

function _contextForEvent(event, { combat = null, combatant = null, worldTime = null } = {}) {
  return {
    event,
    combat: combat ?? game?.combat ?? null,
    combatant: combatant ?? (combat ?? game?.combat)?.combatant ?? null,
    round: _num((combat ?? game?.combat)?.round, 0),
    turn: _num((combat ?? game?.combat)?.turn, 0),
    worldTime: _num(worldTime, MagicTimekeeping.nowWorldTimeSeconds())
  };
}

function _registryContextFrom(context = {}) {
  return {
    actors: new Set(_getTrackedActors()),
    combat: context?.combat ?? game?.combat ?? null
  };
}

function _effectReadyToExpire(effect, event, context) {
  if (!_isSystemSpellEffect(effect)) return false;
  if (!isFiniteDuration(effect.duration)) return false;
  const prepared = typeof effect.updateDuration === "function"
    ? effect.updateDuration(context)
    : effect.duration;
  const remaining = Number(prepared?.remaining ?? effect.duration?.remaining ?? 1);
  if (!(remaining <= 0)) return false;
  return typeof effect.isExpiryEvent === "function"
    ? effect.isExpiryEvent(event, context)
    : true;
}

async function _updateEffect(effect, updates) {
  if (!effect?.id || !updates || !Object.keys(updates).length) return false;
  const parent = effect.parent;
  if (!parent) return false;
  const live = safeGetEffect(parent, effect.id);
  if (!live) return false;
  try {
    await requestUpdateDocument(live, updates);
    return true;
  } catch (err) {
    console.warn("UESRPG | spell-effect-expiration | Failed to update effect before registry refresh", err);
    return false;
  }
}

async function _collectEffectsForGroup(groupKey) {
  const wanted = String(groupKey ?? "").trim();
  if (!wanted) return [];
  const matches = [];
  for (const actor of _getTrackedActors()) {
    _reconcileTrackedActor(actor);
    for (const effect of (actor.effects ?? [])) {
      const flags = effect?.flags?.[_FLAG_NS] ?? {};
      if (!_isSystemSpellEffect(effect)) continue;
      if (String(flags.upkeepGroupKey ?? "").trim() !== wanted) continue;
      matches.push({ actor, effect, flags });
    }
  }
  matches.sort((a, b) => Number(Boolean(b.flags?.isOriginAE)) - Number(Boolean(a.flags?.isOriginAE)));
  return matches;
}

function _resolveOriginEffectFor(effect, flags = null) {
  const f = flags ?? effect?.flags?.[_FLAG_NS] ?? {};
  if (f?.isOriginAE) return effect;

  const byUuid = String(f?.originAEUuid ?? "").trim();
  if (byUuid) {
    const resolved = resolveUuidSync(byUuid);
    if (resolved?.documentName === "ActiveEffect") return resolved;
  }

  const parent = effect?.parent ?? null;
  const byId = String(f?.originAEId ?? "").trim();
  if (parent?.effects && byId) {
    const resolved = safeGetEffect(parent, byId);
    if (resolved?.documentName === "ActiveEffect") return resolved;
  }

  const byGroup = findOriginAEByGroupKey(f?.upkeepGroupKey);
  return byGroup?.documentName === "ActiveEffect" ? byGroup : null;
}

function _graceExtensionFor(effect) {
  const duration = effect?.duration ?? {};
  const units = String(duration.units ?? "").trim();
  const current = _num(duration.value, 0);
  if (!(current > 0)) return null;

  const roundSeconds = Math.max(1, _num(MagicTimekeeping.roundTimeSeconds(), 6));
  const unitSeconds = {
    seconds: 1,
    minutes: 60,
    hours: 3600,
    days: 86400,
    months: 2592000,
    years: 31536000
  };
  const increment = units === "rounds" || units === "turns"
    ? 1
    : (roundSeconds / (unitSeconds[units] ?? roundSeconds));

  return {
    "duration.value": current + increment,
    "duration.units": units,
    "duration.expiry": duration.expiry ?? null
  };
}

function _awaitingGraceExpired(effect, context = {}) {
  const flags = effect?.flags?.[_FLAG_NS] ?? {};
  if (!flags?.upkeepAwaiting) return false;

  const mode = String(flags?.upkeepBoundaryMode ?? "").trim();
  if (mode === "combat") {
    const expiredRound = _num(flags?.expiredAtCombatRound, -1);
    const currentRound = _num(context?.combat?.round ?? game?.combat?.round, 0);
    return expiredRound >= 0 && (currentRound - expiredRound) >= 1;
  }

  const expiredAt = _num(flags?.expiredAtWorldTime, 0);
  const worldTime = _num(context?.worldTime, MagicTimekeeping.nowWorldTimeSeconds());
  return expiredAt > 0 && (worldTime - expiredAt) > Math.max(1, _num(MagicTimekeeping.roundTimeSeconds(), 6));
}

async function _deleteEffectDirect(effect, reason = "expired spell effect") {
  const parent = effect?.parent;
  if (!parent || !effect?.id) return false;
  return safeDeleteEmbeddedDocument(parent, "ActiveEffect", effect.id, {
    context: `UESRPG | spell-effect-expiration | ${reason}`,
    deleteOptions: { uesrpgExpirationSweep: true }
  });
}

async function _deleteOriginCascade(originEffect) {
  if (!originEffect?.id) return false;
  return cancelOriginAEUpkeep(originEffect);
}

export async function deleteSpellEffectWithLifecycle(effect, { reason = "spell effect lifecycle delete" } = {}) {
  if (!effect?.id) return false;
  const flags = effect?.flags?.[_FLAG_NS] ?? {};

  if (_isSystemSpellEffect(effect)) {
    const origin = _resolveOriginEffectFor(effect, flags);
    if (origin?.id) return _deleteOriginCascade(origin);
  }

  return _deleteEffectDirect(effect, reason);
}

function _promptContextFromNativeBoundary(event, context) {
  const units = String(context?.units ?? "");
  if (units === "rounds" || units === "turns" || String(event).toLowerCase().includes("round") || String(event).toLowerCase().includes("turn")) {
    return {
      mode: "combat",
      endRound: _num(context?.round, _num(game?.combat?.round, 0)),
      endTurn: _num(context?.turn, _num(game?.combat?.turn, 0)),
      atWorldTime: _num(context?.worldTime, MagicTimekeeping.nowWorldTimeSeconds())
    };
  }
  return {
    mode: "realtime",
    endTime: _num(context?.worldTime, MagicTimekeeping.nowWorldTimeSeconds()),
    atWorldTime: _num(context?.worldTime, MagicTimekeeping.nowWorldTimeSeconds())
  };
}

async function _markGroupAwaitingUpkeep(originEffect, event, context) {
  const originFlags = originEffect?.flags?.[_FLAG_NS] ?? {};
  const groupKey = String(originFlags?.upkeepGroupKey ?? "").trim();
  if (!groupKey) return false;

  const promptContext = _promptContextFromNativeBoundary(event, {
    ...context,
    units: originEffect?.duration?.units
  });
  const promptSignature = promptContext.mode === "combat"
    ? `cb:${promptContext.endRound}:${promptContext.endTurn}`
    : `rt:${promptContext.endTime}`;

  if (originFlags.upkeepAwaiting && String(originFlags.upkeepPromptSignature ?? "") === promptSignature) return false;

  const matches = await _collectEffectsForGroup(groupKey);
  if (!matches.length) return false;

  for (const match of matches) {
    const extension = _graceExtensionFor(match.effect) ?? {};
    const updates = {
      ...extension,
      disabled: !Boolean(match.flags?.isOriginAE),
      [`flags.${_FLAG_NS}.upkeepAwaiting`]: true,
      [`flags.${_FLAG_NS}.upkeepPendingNativeExtension`]: null,
      [`flags.${_FLAG_NS}.upkeepPendingGraceExtension`]: Boolean(Object.keys(extension).length),
      [`flags.${_FLAG_NS}.expiredAtWorldTime`]: promptContext.atWorldTime,
      [`flags.${_FLAG_NS}.expiredAtCombatRound`]: promptContext.mode === "combat" ? promptContext.endRound : -1,
      [`flags.${_FLAG_NS}.upkeepBoundaryMode`]: promptContext.mode,
      [`flags.${_FLAG_NS}.upkeepBoundaryEndTime`]: promptContext.mode === "realtime" ? promptContext.endTime : null,
      [`flags.${_FLAG_NS}.upkeepBoundaryEndRound`]: promptContext.mode === "combat" ? promptContext.endRound : null,
      [`flags.${_FLAG_NS}.upkeepBoundaryEndTurn`]: promptContext.mode === "combat" ? promptContext.endTurn : null,
      [`flags.${_FLAG_NS}.upkeepPromptSignature`]: promptSignature
    };
    await _updateEffect(match.effect, updates);
  }

  const { ensureUpkeepPromptForGroup } = await import("../upkeep-workflow.js");
  await ensureUpkeepPromptForGroup(groupKey, promptContext);
  _anchorDebug("Upkeep spell moved to awaiting state before v14 registry refresh", {
    groupKey,
    spellName: originFlags.spellName ?? originEffect.name,
    event,
    promptSignature
  });
  return true;
}

async function _processUpkeepPreExpiry(event, context) {
  if (!game.user?.isGM) return;
  for (const actor of _getTrackedActors()) {
    _reconcileTrackedActor(actor);
    for (const effect of (actor.effects ?? [])) {
      const flags = effect?.flags?.[_FLAG_NS] ?? {};
      if (!_isSystemSpellEffect(effect) || !flags?.hasUpkeep) continue;
      if (flags?.upkeepAwaiting) continue;
      if (!_effectReadyToExpire(effect, event, context)) continue;

      const origin = flags?.isOriginAE ? effect : findOriginAEByGroupKey(flags.upkeepGroupKey);
      if (!origin?.id) {
        await _deleteEffectDirect(effect, "orphan upkeep target expiry");
        continue;
      }
      await _markGroupAwaitingUpkeep(origin, event, context);
    }
  }
}

async function _processAwaitingUpkeepGrace(context) {
  if (!game.user?.isGM) return;
  const handledOrigins = new Set();
  for (const actor of _getTrackedActors()) {
    _reconcileTrackedActor(actor);
    for (const effect of (actor.effects ?? [])) {
      const flags = effect?.flags?.[_FLAG_NS] ?? {};
      if (!_isSystemSpellEffect(effect) || !flags?.hasUpkeep || !flags?.upkeepAwaiting) continue;
      if (!_awaitingGraceExpired(effect, context)) continue;

      const origin = _resolveOriginEffectFor(effect, flags);
      if (origin?.id) {
        const key = String(origin.uuid ?? origin.id);
        if (handledOrigins.has(key)) continue;
        handledOrigins.add(key);
        await _deleteOriginCascade(origin);
      } else {
        await _deleteEffectDirect(effect, "unresolved upkeep grace expiry");
      }
    }
  }
}

async function _refreshRegistry(event, context) {
  const registry = CONFIG?.ActiveEffect?.documentClass?.registry ?? foundry?.documents?.ActiveEffect?.registry ?? null;
  if (typeof registry?.refresh !== "function") return;
  await registry.refresh(event, _registryContextFrom(context));
}

async function _handleNativeBoundary(event, context) {
  await _processAwaitingUpkeepGrace(context);
  await _processUpkeepPreExpiry(event, context);
  await _refreshRegistry(event, context);
  await cleanupExpiredSpellEffects({ actors: _getTrackedActors(), context, source: `registry:${event}` });
}

function _registerTrackingHooks() {
  Hooks.on("createActiveEffect", (effect) => {
    if (!game.user?.isGM) return;
    const actor = effect?.parent;
    if (actor?.documentName !== "Actor") return;
    _trackActorEffect(actor, effect);
  });

  Hooks.on("updateActiveEffect", (effect) => {
    if (!game.user?.isGM) return;
    const actor = effect?.parent;
    if (actor?.documentName !== "Actor") return;
    if (_isSystemSpellEffect(effect)) _trackActorEffect(actor, effect);
    else _untrackActorEffect(actor?.id, effect?.id);
  });

  Hooks.on("deleteActiveEffect", (effect) => {
    if (!game.user?.isGM) return;
    _untrackActorEffect(effect?.parent?.id, effect?.id);
  });
}

async function _handleCombatBoundaryExpiration(payload) {
  if (!game.user?.isGM) return;
  if (payload?.source !== "combat") return;
  if (payload?.combat?.phase && payload.combat.phase !== "post") return;
  const combat = game.combat ?? payload?.combat ?? null;
  if (!combat?.id) return;

  const context = _contextForEvent("turnEnd", {
    combat,
    worldTime: _num(payload?.worldTime, MagicTimekeeping.nowWorldTimeSeconds())
  });
  await _handleNativeBoundary("turnEnd", context);
  await _handleNativeBoundary("turnStart", _contextForEvent("turnStart", context));
  if (payload?.combat?.prior?.round !== undefined && _num(payload.combat.prior.round, 0) !== _num(combat.round, 0)) {
    await _handleNativeBoundary("roundEnd", _contextForEvent("roundEnd", context));
    await _handleNativeBoundary("roundStart", _contextForEvent("roundStart", context));
  }
}

export function initializeSpellEffectExpirationSystem() {
  if (initializeSpellEffectExpirationSystem._initialized) return;
  initializeSpellEffectExpirationSystem._initialized = true;

  _seedTrackedSpellEffects();
  _registerTrackingHooks();

  MagicTimekeeping.onTimeChange(async ({ worldTime } = {}) => {
    if (!game.user?.isGM) return;
    if (game.combat) return;
    await _handleNativeBoundary("worldTime", _contextForEvent("worldTime", { worldTime }));
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

  Hooks.on("createCombat", async (combat) => {
    if (!game.user?.isGM) return;
    await _handleNativeBoundary("combatStart", _contextForEvent("combatStart", { combat: combat ?? game.combat }));
  });

  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user?.isGM) return;
    await _handleNativeBoundary("combatEnd", _contextForEvent("combatEnd", { combat }));
  });
}

export async function cleanupExpiredSpellEffects({ actors = null, context = null, source = "maintenance" } = {}) {
  if (!game.user?.isGM) return { checked: 0, deleted: 0 };

  const actorList = actors
    ? Array.from(actors)
    : (MagicTimekeeping.relevantActorsArray?.() ?? []);
  let checked = 0;
  let deleted = 0;
  const handledOrigins = new Set();
  const targetDeletes = [];

  for (const actor of actorList) {
    if (!actor?.effects) continue;
    _reconcileTrackedActor(actor);
    for (const effect of (actor.effects ?? [])) {
      if (!_isDeleteActionSpellEffect(effect)) continue;
      checked += 1;
      if (!_isExpired(effect)) continue;

      const flags = effect.flags?.[_FLAG_NS] ?? {};
      if (flags?.hasUpkeep && flags?.upkeepAwaiting && !_awaitingGraceExpired(effect, context ?? {})) continue;

      const origin = _resolveOriginEffectFor(effect, flags);
      if (origin?.id) {
        const key = String(origin.uuid ?? origin.id);
        if (handledOrigins.has(key)) continue;
        handledOrigins.add(key);
        if (await _deleteOriginCascade(origin)) deleted += 1;
        continue;
      }

      if (!flags?.isOriginAE) targetDeletes.push(effect);
    }
  }

  for (const effect of targetDeletes) {
    if (await _deleteEffectDirect(effect, source)) deleted += 1;
  }

  if (deleted > 0) _anchorDebug("Cleaned expired spell effects", { source, checked, deleted });
  return { checked, deleted };
}

export function isEffectExpiredByWorldTime(effect, nowTime) {
  const prepared = typeof effect?.updateDuration === "function"
    ? effect.updateDuration({ worldTime: _num(nowTime, MagicTimekeeping.nowWorldTimeSeconds()) })
    : effect?.duration;
  return Number(prepared?.remaining ?? 1) <= 0;
}

export function isEffectExpiredByCombat(effect, combat, options = {}) {
  const event = options?.event ?? effect?.duration?.expiry ?? "turnEnd";
  const context = _contextForEvent(event, { combat: combat ?? game?.combat ?? null });
  return _effectReadyToExpire(effect, event, context);
}
