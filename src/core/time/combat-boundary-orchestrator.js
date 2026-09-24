/**
 * @module core/time/combat-boundary-orchestrator
 *
 * Optional orchestrator for post-combat boundary consumers.
 * Keeps `uesrpg.combatTimeChanged` as the external ingress while allowing
 * internal fan-out to happen through one ordered dispatch lane.
 */

import { isPerfEnabled, monoMs, perfRecord } from "../../utils/perf-tracker.js";
import { isCombatBoundaryOrchestratorPolicyEnabled } from "../config/automation-policy.js";
import { isActiveGMUser } from "../../utils/users.js";

/** @type {Array<{id: string, order: number, handle: Function, retrySafe: boolean}>} */
const _consumers = [];

/** @type {Map<string, string>} */
const _lastCompletedBoundaryByCombat = new Map();
const _inFlightBoundaryKeys = new Set();

let _registered = false;

export function isCombatBoundaryOrchestratorEnabled() {
  return isCombatBoundaryOrchestratorPolicyEnabled();
}

export function registerCombatBoundaryConsumer(consumer) {
  const id = String(consumer?.id ?? "").trim();
  const handle = consumer?.handle;
  if (!id || typeof handle !== "function") return;
  if (_consumers.some((c) => c.id === id)) return;

  _consumers.push({
    id,
    order: Number(consumer?.order ?? 1000) || 1000,
    handle,
    retrySafe: consumer?.retrySafe === true,
  });
}

export function noteCombatBoundaryLegacyFallbackSkip(consumerId, payload) {
  if (!isCombatBoundaryOrchestratorEnabled()) return false;
  if (!isPerfEnabled()) return true;

  perfRecord({
    event: "combatBoundaryOrchestrator.legacyFallbackSkipped",
    consumerId: String(consumerId ?? "") || null,
    combatId: payload?.combat?.id ?? null,
    round: payload?.combat?.round ?? null,
    turn: payload?.combat?.turn ?? null,
    phase: payload?.combat?.phase ?? null,
    boundaryKey: _buildBoundaryKey(payload),
  });
  return true;
}

function _buildBoundaryKey(payload) {
  const combatId = String(payload?.combat?.id ?? "");
  if (!combatId) return null;
  const priorRound = Number(payload?.combat?.prior?.round ?? -1);
  const priorTurn = Number(payload?.combat?.prior?.turn ?? -1);
  const nextRound = Number(payload?.combat?.round ?? payload?.combat?.current?.round ?? -1);
  const nextTurn = Number(payload?.combat?.turn ?? payload?.combat?.current?.turn ?? -1);
  return `${combatId}:${priorRound}.${priorTurn}->${nextRound}.${nextTurn}`;
}

function _isEligiblePayload(payload) {
  if (!isActiveGMUser(game.user)) return false;
  if (payload?.source !== "combat") return false;
  if (payload?.combat?.phase && payload.combat.phase !== "post") return false;
  return true;
}

async function _dispatch(payload) {
  if (!isCombatBoundaryOrchestratorEnabled()) return;
  if (!_isEligiblePayload(payload)) return;

  const combat = game?.combat ?? null;
  if (!combat?.id) return;
  if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

  const _perf = isPerfEnabled();
  const _t0 = _perf ? monoMs() : 0;

  const boundaryKey = _buildBoundaryKey(payload);
  const duplicateDetected = Boolean(boundaryKey) && (
    _lastCompletedBoundaryByCombat.get(String(combat.id)) === boundaryKey
    || _inFlightBoundaryKeys.has(boundaryKey)
  );
  if (duplicateDetected) {
    if (_perf) {
      perfRecord({
        event: "combatBoundaryOrchestrator.duplicateSkipped",
        combatId: combat.id,
        boundaryKey,
        durationMs: monoMs() - _t0,
      });
    }
    return;
  }
  if (boundaryKey) _inFlightBoundaryKeys.add(boundaryKey);

  const ordered = [..._consumers].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  let invokedCount = 0;
  let failedCount = 0;

  try {
    for (const consumer of ordered) {
      try {
        await consumer.handle(payload);
        invokedCount++;
      } catch (firstError) {
        if (!consumer.retrySafe) {
          failedCount++;
          console.warn(`UESRPG | combat-boundary-orchestrator | Consumer "${consumer.id}" failed`, firstError);
          continue;
        }
        try {
          await consumer.handle(payload);
          invokedCount++;
          console.warn(`UESRPG | combat-boundary-orchestrator | Consumer "${consumer.id}" succeeded on retry`, firstError);
        } catch (retryError) {
          failedCount++;
          console.warn(`UESRPG | combat-boundary-orchestrator | Consumer "${consumer.id}" failed`, retryError);
        }
      }
    }
    if (boundaryKey && failedCount === 0) _lastCompletedBoundaryByCombat.set(String(combat.id), boundaryKey);
  } finally {
    if (boundaryKey) _inFlightBoundaryKeys.delete(boundaryKey);
  }

  if (_perf) {
    perfRecord({
      event: "combatBoundaryOrchestrator.dispatch",
      combatId: combat.id ?? null,
      round: Number(combat.round ?? 0),
      turn: Number(combat.turn ?? 0),
      boundaryKey,
      consumerCount: ordered.length,
      invokedConsumerCount: invokedCount,
      failedConsumerCount: failedCount,
      duplicateDetected,
      duplicateCount: duplicateDetected ? 1 : 0,
      durationMs: monoMs() - _t0,
    });
  }
}

export function initializeCombatBoundaryOrchestrator() {
  if (_registered) return;
  _registered = true;

  Hooks.on("uesrpg.combatTimeChanged", _dispatch);
  Hooks.on("deleteCombat", (combat) => {
    _lastCompletedBoundaryByCombat.delete(String(combat?.id ?? ""));
  });
}
