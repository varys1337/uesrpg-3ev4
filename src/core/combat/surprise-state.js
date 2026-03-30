/**
 * src/core/combat/surprise-state.js
 *
 * Chapter 5 surprise-state helpers.
 */

import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { registerCombatBoundaryConsumer, noteCombatBoundaryLegacyFallbackSkip } from "../time/combat-boundary-orchestrator.js";
import { getActorCapabilityFlag } from "../active-effects/modifier-evaluator.js";
import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { hasAkaviriDangerSense } from "../traits/starsigns/index.js";
const SURPRISE_FLAG_PATH = "chapter5.surpriseState";

let _hooksRegistered = false;

function _isActiveCombat(combat) {
  return Boolean(combat?.id && combat?.started);
}

function _readState(actor) {
  const raw = actor?.getFlag?.(SYSTEM_ID, SURPRISE_FLAG_PATH);
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

function _combatId(combat) {
  return String(combat?.id ?? "").trim();
}

function _actorCombatant(actor, combat = game.combat) {
  if (!actor || !combat?.combatants) return null;
  return combat.combatants.find((c) => c?.actor?.id === actor.id) ?? null;
}

function _resolveLuckTarget(actor) {
  const candidates = [
    actor?.system?.characteristics?.lck?.total,
    actor?.system?.characteristics?.lck?.value,
    actor?.system?.characteristics?.lck?.base,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

async function _attemptAkaviriDangerSenseAvoidance(actor) {
  if (!actor || !hasAkaviriDangerSense(actor)) {
    return { attempted: false, succeeded: false, rollTotal: null, target: null };
  }

  const target = _resolveLuckTarget(actor);
  if (!Number.isFinite(target)) {
    return { attempted: false, succeeded: false, rollTotal: null, target: null };
  }

  try {
    const result = await doTestRoll(actor, { rollFormula: "1d100", target, allowLucky: true, allowUnlucky: true });
    return {
      attempted: true,
      succeeded: Boolean(result?.isSuccess),
      rollTotal: Number(result?.rollTotal ?? result?.roll?.total ?? NaN) || null,
      target
    };
  } catch (_e) {
    return { attempted: true, succeeded: false, rollTotal: null, target };
  }
}

export function resolveSurpriseState(actor, { combatContext = game.combat } = {}) {
  const combat = combatContext ?? game.combat ?? null;
  if (!actor || !_isActiveCombat(combat)) {
    return {
      combatId: null,
      isSurprised: false,
      hasPassedFirstTurn: true,
      onlyReactions: false,
      canTakeTurnActions: true
    };
  }
  if (getActorCapabilityFlag(actor, "flags.uesrpg-3ev4.senses.alwaysAwakeForSurprise")) {
    return {
      combatId: _combatId(combat),
      isSurprised: false,
      hasPassedFirstTurn: true,
      onlyReactions: false,
      canTakeTurnActions: true
    };
  }

  const cid = _combatId(combat);
  const state = _readState(actor);
  const current = state && String(state.combatId ?? "") === cid ? state : null;

  const isSurprised = Boolean(current?.isSurprised === true);
  const hasPassedFirstTurn = Boolean(current?.hasPassedFirstTurn === true);
  const onlyReactions = isSurprised && !hasPassedFirstTurn;

  return {
    combatId: cid,
    isSurprised,
    hasPassedFirstTurn,
    onlyReactions,
    canTakeTurnActions: !onlyReactions
  };
}

export async function setActorSurprised(actor, { combat = game.combat, surprised = true } = {}) {
  if (!actor || !_isActiveCombat(combat)) return false;

  const blockedByAwakeFlag = Boolean(surprised) && getActorCapabilityFlag(actor, "flags.uesrpg-3ev4.senses.alwaysAwakeForSurprise");
  const dangerSenseAvoided = Boolean(surprised) && !blockedByAwakeFlag
    ? await _attemptAkaviriDangerSenseAvoidance(actor)
    : { attempted: false, succeeded: false, rollTotal: null, target: null };
  const preventedByDangerSense = dangerSenseAvoided?.succeeded === true;

  const cid = _combatId(combat);
  const payload = {
    combatId: cid,
    isSurprised: (blockedByAwakeFlag || preventedByDangerSense) ? false : Boolean(surprised),
    hasPassedFirstTurn: (blockedByAwakeFlag || preventedByDangerSense) ? true : !Boolean(surprised),
    updatedAt: Date.now()
  };

  await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_ID}.${SURPRISE_FLAG_PATH}`]: payload
  });

  return true;
}

export async function clearActorSurpriseState(actor) {
  if (!actor) return;
  await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_ID}.${SURPRISE_FLAG_PATH}`]: null
  });
}

export async function markSurprisedFirstTurnPassed(actor, { combat = game.combat } = {}) {
  if (!actor || !_isActiveCombat(combat)) return false;

  const state = resolveSurpriseState(actor, { combatContext: combat });
  if (!state.isSurprised || state.hasPassedFirstTurn) return false;

  await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_ID}.${SURPRISE_FLAG_PATH}.hasPassedFirstTurn`]: true,
    [`flags.${SYSTEM_ID}.${SURPRISE_FLAG_PATH}.updatedAt`]: Date.now()
  });

  return true;
}

async function _handleCombatBoundarySurprise(payload) {
  try {
    if (!game.user?.isGM) return;
    if (payload?.source !== "combat") return;
    if (payload?.combat?.phase && payload.combat.phase !== "post") return;

    const combat = game.combat ?? null;
    if (!combat?.id) return;
    if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

    const changed = payload?.changed ?? {};
    const changedTurn = Object.prototype.hasOwnProperty.call(changed, "turn");
    const changedRound = Object.prototype.hasOwnProperty.call(changed, "round");
    if (!changedTurn && !changedRound) return;

    const currentRound = Number(combat.round ?? 0);
    const currentTurn = Number(combat.turn ?? 0);
    const changedRoundValue = Number(changed?.round ?? NaN);
    const changedTurnValue = Number(changed?.turn ?? NaN);
    const isInitialStart =
      currentRound === 1
      && currentTurn === 0
      && ((changedRound && changedRoundValue === 1) || (changedTurn && changedTurnValue === 0));
    if (isInitialStart) return;

    const turns = Array.isArray(combat.turns) ? combat.turns : [];
    if (!turns.length) return;

    const idx = Number(combat.turn ?? 0);
    const prevIdx = idx <= 0 ? turns.length - 1 : idx - 1;
    const prevCombatant = turns[prevIdx] ?? null;
    const prevActor = prevCombatant?.actor ?? null;
    if (!prevActor) return;

    await markSurprisedFirstTurnPassed(prevActor, { combat });
  } catch (err) {
    console.warn("UESRPG | Surprise ticker failed", err);
  }
}

export function registerSurpriseHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  registerCombatBoundaryConsumer({
    id: "surprise-state",
    // Surprise state clears after turn advancement is committed and other state lanes are stable.
    order: 325,
    handle: _handleCombatBoundarySurprise
  });

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    if (noteCombatBoundaryLegacyFallbackSkip("surprise-state", payload)) return;
    await _handleCombatBoundarySurprise(payload);
  });

  Hooks.on("deleteCombat", async (combat) => {
    try {
      if (!game.user?.isGM) return;
      const c = combat ?? null;
      const combatants = Array.isArray(c?.combatants)
        ? c.combatants
        : Array.from(c?.combatants ?? []);
      for (const cb of combatants) {
        const actor = cb?.actor ?? null;
        if (!actor) continue;
        const state = _readState(actor);
        if (!state) continue;
        if (String(state.combatId ?? "") !== String(c?.id ?? "")) continue;
        await clearActorSurpriseState(actor);
      }
    } catch (err) {
      console.warn("UESRPG | Surprise cleanup failed", err);
    }
  });
}
