/**
 * src/core/combat/activation-state-flags.js
 *
 * Shared short-lived actor flag helpers for activation-driven combat states:
 * - Defender: free next defense commit
 * - Thunder Charge: primed state
 */

import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { _num } from "../../utils/coerce.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { registerCombatBoundaryConsumer, noteCombatBoundaryLegacyFallbackSkip } from "../time/combat-boundary-orchestrator.js";

const FLAG_FREE_DEFENSE = `flags.${FLAG_SCOPE}.combat.freeNextDefenseCommit`;
const FLAG_THUNDER_CHARGE = `flags.${FLAG_SCOPE}.talents.thunderCharge`;

let _activationStateHooksRegistered = false;
const _activationFlagActors = new Set();

function _worldTimeSeconds() {
  return _num(game?.time?.worldTime, 0);
}

function _roundTimeSecondsSafe() {
  try {
    const roundTime = Number(game?.settings?.get?.("core", "roundTime"));
    return Number.isFinite(roundTime) && roundTime > 0 ? roundTime : 6;
  } catch (_err) {
    return 6;
  }
}

function _readFlagByPath(actor, path) {
  try {
    if (!actor) return null;
    const canonicalPrefix = `flags.${FLAG_SCOPE}.`;
    if (path.startsWith(canonicalPrefix)) {
      return getFlagValueWithFallback(actor, path.slice(canonicalPrefix.length)) ?? null;
    }
    return foundry.utils.getProperty(actor, path) ?? null;
  } catch (_err) {
    return null;
  }
}

function _trackActorForActivationCleanup(actor) {
  const actorId = String(actor?.id ?? "").trim();
  if (!actorId) return;
  _activationFlagActors.add(actorId);
}

function _untrackActorIfNoActivationFlags(actor) {
  const actorId = String(actor?.id ?? "").trim();
  if (!actorId) return;
  const hasFree = Boolean(_readFlagByPath(actor, FLAG_FREE_DEFENSE));
  const hasThunder = Boolean(_readFlagByPath(actor, FLAG_THUNDER_CHARGE));
  if (!hasFree && !hasThunder) _activationFlagActors.delete(actorId);
}

function _isFreeDefenseExpired(state, { combat = null, worldTime = null } = {}) {
  if (!state || typeof state !== "object") return true;

  const expiresAt = _num(state.expiresAt, 0);
  if (expiresAt > 0 && Date.now() >= expiresAt) return true;

  const expiresWorldTime = _num(state.expiresWorldTime, 0);
  const wt = _num(worldTime, _worldTimeSeconds());
  if (expiresWorldTime > 0 && wt >= expiresWorldTime) return true;

  const c = combat ?? game?.combat ?? null;
  if (!c || !c.started) return false;

  const combatId = String(state.combatId ?? "").trim();
  if (combatId && String(c.id ?? "") !== combatId) return true;

  if (state.expireOnStepAdvance === true) {
    const startRound = _num(state.round, -1);
    const startTurn = _num(state.turn, -1);
    const nowRound = _num(c.round, -2);
    const nowTurn = _num(c.turn, -2);
    if (startRound !== nowRound || startTurn !== nowTurn) return true;
  }

  return false;
}

function _isThunderChargeExpired(state, { combat = null, worldTime = null } = {}) {
  if (!state || typeof state !== "object") return true;
  if (state.primed !== true) return true;

  const expiresAt = _num(state.expiresAt, 0);
  if (expiresAt > 0 && Date.now() >= expiresAt) return true;

  const expiresWorldTime = _num(state.expiresWorldTime, 0);
  const wt = _num(worldTime, _worldTimeSeconds());
  if (expiresWorldTime > 0 && wt >= expiresWorldTime) return true;

  const c = combat ?? game?.combat ?? null;
  const combatId = String(state.combatId ?? "").trim();
  if (combatId && (!c?.started || String(c.id ?? "") !== combatId)) return true;

  return false;
}

export function peekFreeNextDefenseCommit(actor, { messageId = null } = {}) {
  const state = _readFlagByPath(actor, FLAG_FREE_DEFENSE);
  if (!state || typeof state !== "object") return null;
  if (_isFreeDefenseExpired(state, { combat: game?.combat ?? null })) return null;
  if (messageId && state.messageId && String(state.messageId) !== String(messageId)) return null;
  return state;
}

export async function grantFreeNextDefenseCommit(actor, payload = {}) {
  if (!actor) return false;
  const now = Date.now();
  const worldTime = _worldTimeSeconds();
  const combat = (game?.combat && game.combat.started) ? game.combat : null;
  const state = {
    source: "Defender",
    createdAt: now,
    createdWorldTime: worldTime,
    expireOnStepAdvance: true,
    ...payload
  };
  if (!Object.prototype.hasOwnProperty.call(state, "combatId")) state.combatId = combat?.id ?? null;
  if (!Object.prototype.hasOwnProperty.call(state, "round")) state.round = combat ? _num(combat.round, 0) : null;
  if (!Object.prototype.hasOwnProperty.call(state, "turn")) state.turn = combat ? _num(combat.turn, 0) : null;
  if (!Object.prototype.hasOwnProperty.call(state, "expiresWorldTime")) {
    // Fallback TTL: 1 combat round (or 6 seconds out of combat).
    state.expiresWorldTime = worldTime + Math.max(1, _roundTimeSecondsSafe());
  }
  const ok = await requestUpdateDocument(actor, { [FLAG_FREE_DEFENSE]: state });
  if (ok) _trackActorForActivationCleanup(actor);
  return ok;
}

export async function consumeFreeNextDefenseCommit(actor, { messageId = null } = {}) {
  const state = peekFreeNextDefenseCommit(actor, { messageId });
  if (!state) return null;
  const ok = await requestUpdateDocument(actor, { [FLAG_FREE_DEFENSE]: null });
  if (ok) _untrackActorIfNoActivationFlags(actor);
  return ok ? state : null;
}

export function peekThunderChargePrimed(actor) {
  const state = _readFlagByPath(actor, FLAG_THUNDER_CHARGE);
  if (!state || typeof state !== "object") return null;
  if (_isThunderChargeExpired(state, { combat: game?.combat ?? null })) return null;
  return state;
}

export async function setThunderChargePrimed(actor, payload = {}) {
  if (!actor) return false;
  const now = Date.now();
  const worldTime = _worldTimeSeconds();
  const combat = (game?.combat && game.combat.started) ? game.combat : null;
  const state = {
    primed: true,
    createdAt: now,
    createdWorldTime: worldTime,
    ...payload
  };
  if (!Object.prototype.hasOwnProperty.call(state, "combatId")) state.combatId = combat?.id ?? null;
  if (!Object.prototype.hasOwnProperty.call(state, "round")) state.round = combat ? _num(combat.round, 0) : null;
  if (!Object.prototype.hasOwnProperty.call(state, "turn")) state.turn = combat ? _num(combat.turn, 0) : null;
  const ok = await requestUpdateDocument(actor, { [FLAG_THUNDER_CHARGE]: state });
  if (ok) _trackActorForActivationCleanup(actor);
  return ok;
}

export async function consumeThunderChargePrimed(actor) {
  const state = peekThunderChargePrimed(actor);
  if (!state) return null;
  const ok = await requestUpdateDocument(actor, { [FLAG_THUNDER_CHARGE]: null });
  if (ok) _untrackActorIfNoActivationFlags(actor);
  return ok ? state : null;
}

async function _cleanupActorActivationFlags(actor, { combat = null, worldTime = null } = {}) {
  if (!actor) return;
  const updates = {};

  const free = _readFlagByPath(actor, FLAG_FREE_DEFENSE);
  if (free && _isFreeDefenseExpired(free, { combat, worldTime })) {
    updates[FLAG_FREE_DEFENSE] = null;
  }

  const thunder = _readFlagByPath(actor, FLAG_THUNDER_CHARGE);
  if (thunder && _isThunderChargeExpired(thunder, { combat, worldTime })) {
    updates[FLAG_THUNDER_CHARGE] = null;
  }

  if (Object.keys(updates).length) {
    await requestUpdateDocument(actor, updates);
  }
}

async function _handleCombatBoundaryActivationCleanup(payload) {
  if (!game.user?.isGM) return;
  if (payload?.source !== "combat") return;
  if (payload?.combat?.phase && payload.combat.phase !== "post") return;

  const combat = game?.combat ?? null;
  if (!combat?.id) return;
  if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;
  if (!_activationFlagActors.size) return;

  const wt = _num(payload?.worldTime, _worldTimeSeconds());
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant?.actor ?? null;
    if (!actor?.id) continue;
    if (!_activationFlagActors.has(String(actor.id))) continue;
    await _cleanupActorActivationFlags(actor, { combat, worldTime: wt });
    _untrackActorIfNoActivationFlags(actor);
  }
}

export function registerActivationStateHooks() {
  if (_activationStateHooksRegistered) return;
  _activationStateHooksRegistered = true;
  if (globalThis.__UESRPG_ACTIVATION_STATE_HOOKS__) return;
  globalThis.__UESRPG_ACTIVATION_STATE_HOOKS__ = true;

  if (game.user?.isGM) {
    const actors = Array.from(game?.actors?.contents ?? []);
    for (const actor of actors) {
      const hasFree = Boolean(_readFlagByPath(actor, FLAG_FREE_DEFENSE));
      const hasThunder = Boolean(_readFlagByPath(actor, FLAG_THUNDER_CHARGE));
      if (hasFree || hasThunder) _trackActorForActivationCleanup(actor);
    }
  }
  registerCombatBoundaryConsumer({
    id: "activation-state-flags",
    // Cleanup runs after core rules/effect consumers so transient combat flags settle last.
    order: 300,
    handle: _handleCombatBoundaryActivationCleanup
  });

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    if (noteCombatBoundaryLegacyFallbackSkip("activation-state-flags", payload)) return;
    await _handleCombatBoundaryActivationCleanup(payload);
  });

  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user?.isGM) return;
    const wt = _worldTimeSeconds();
    for (const combatant of combat?.combatants ?? []) {
      await _cleanupActorActivationFlags(combatant?.actor ?? null, { combat: null, worldTime: wt });
      _untrackActorIfNoActivationFlags(combatant?.actor ?? null);
    }
  });

  Hooks.on("uesrpg.timeChanged", async (payload) => {
    if (!game.user?.isGM) return;
    const source = String(payload?.source ?? "");
    if (source !== "worldTime" && source !== "calendaria") return;
    const wt = _num(payload?.worldTime, _worldTimeSeconds());
    for (const actorId of Array.from(_activationFlagActors)) {
      const actor = game?.actors?.get?.(actorId) ?? null;
      if (!actor) {
        _activationFlagActors.delete(actorId);
        continue;
      }
      await _cleanupActorActivationFlags(actor, { combat: game?.combat ?? null, worldTime: wt });
      _untrackActorIfNoActivationFlags(actor);
    }
  });
}

