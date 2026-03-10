/**
 * src/core/conditions/turn-ticker.js
 *
 * Deterministic end-of-turn condition ticking.
 * Runs GM-only on uesrpg.combatTimeChanged.
 */

import { tickConditionsEndTurn, runSilencedRealizationCheck } from "./condition-engine.js";
import { getActorTraitValue } from "../traits/trait-registry.js";
import { postRegenerationPrompt, postRegenPromptBatch } from "../traits/trait-automation.js";
import { requestUpdateDocument, requestDeleteEmbeddedDocuments, requestBatchUpdateDocuments } from "../../utils/authority-proxy.js";
import { FLAG_SCOPE } from "./constants.js";
import { getSystemFlagsWithFallback } from "../system/flags.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../utils/perf-tracker.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { scheduleBoundaryWork } from "../time/boundary-work-scheduler.js";
import { registerCombatBoundaryConsumer, noteCombatBoundaryLegacyFallbackSkip } from "../time/combat-boundary-orchestrator.js";
import { getRegenerationCandidatesForCombat, getSilencedCandidatesForCombat } from "./round-start-candidate-registry.js";

let _registered = false;

/** @type {Map<string, {round: number, turn: number, combatantId: string|null}>} */
const _combatState = new Map();

function _snapshotCombat(combat) {
  return {
    round: Number(combat?.round ?? 0),
    turn: Number(combat?.turn ?? 0),
    combatantId: combat?.combatant?.id ?? combat?.combatantId ?? null
  };
}

function _setState(combat) {
  if (!combat?.id) return;
  _combatState.set(String(combat.id), _snapshotCombat(combat));
}

function _getState(combat) {
  if (!combat?.id) return null;
  return _combatState.get(String(combat.id)) ?? null;
}

function _getPreviousCombatant(combat, changed) {
  if (!combat) return null;
  const turns = combat.turns ?? [];
  if (!Array.isArray(turns) || turns.length === 0) return null;

  if (!("turn" in (changed ?? {})) && !("round" in (changed ?? {}))) return null;

  const turn = Number(combat.turn ?? 0);
  if (turn === 0 && Number(combat.round ?? 0) === 1 && Number(changed?.round ?? 1) === 1) return null;

  const prevIndex = (turn - 1) < 0 ? (turns.length - 1) : (turn - 1);
  return turns[prevIndex] ?? null;
}

function _isAggregateRegenEnabled() {
  try { return Boolean(game?.settings?.get?.(SYSTEM_ID, "aggregateRegenPrompts")); }
  catch (_e) { return false; }
}

function _isAggregateSilencedEnabled() {
  try { return Boolean(game?.settings?.get?.(SYSTEM_ID, "aggregateSilencedChecks")); }
  catch (_e) { return false; }
}

async function _expireStartOfTurnEffects(combat, changed) {
  if (!combat) return;
  if (!((changed ?? {}) && ("turn" in changed || "round" in changed))) return;

  const turns = combat.turns ?? [];
  if (!Array.isArray(turns) || turns.length === 0) return;

  const idx = Number(combat.turn ?? 0);
  const current = turns[idx] ?? null;
  const actor = current?.actor ?? null;
  if (!actor) return;

  const currentTurn = Number(combat.turn ?? 0);
  const currentRound = Number(combat.round ?? 0);
  const currentCombatantId = String(current?.id ?? "");
  const combatId = String(combat.id ?? "");

  const effects = actor?.effects?.contents ?? [];
  const toRemove = effects.filter((e) => {
    if (!e || e.disabled) return false;
    const flags = getSystemFlagsWithFallback(e) ?? null;
    if (!flags) return false;
    if (flags.expiresOnTurnStart !== true) return false;

    const eCombatId = String(flags.expiresCombatId ?? "");
    if (eCombatId && combatId && eCombatId !== combatId) return false;

    const eCombatantId = String(flags.expiresCombatantId ?? "");
    if (eCombatantId && currentCombatantId && eCombatantId !== currentCombatantId) return false;

    const hasRoundTurn = (flags.expiresRound !== undefined || flags.expiresTurn !== undefined);
    if (hasRoundTurn) {
      const eRound = Number(flags.expiresRound ?? NaN);
      const eTurn = Number(flags.expiresTurn ?? NaN);
      if (Number.isFinite(eRound) && Number.isFinite(currentRound) && eRound !== currentRound) return false;
      if (Number.isFinite(eTurn) && Number.isFinite(currentTurn) && eTurn !== currentTurn) return false;
    }

    return true;
  });

  if (toRemove.length === 0) return;

  const uniqueIds = Array.from(new Set(toRemove.map((e) => e?.id).filter(Boolean)));
  const existingIds = uniqueIds.filter((id) => actor.effects?.get?.(id));
  if (existingIds.length === 0) return;

  try {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", existingIds);
  } catch (err) {
    const msg = String(err?.message ?? "");
    const stillExisting = existingIds.filter((id) => actor.effects?.has?.(id));

    if (stillExisting.length > 0) {
      try {
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", stillExisting);
        return;
      } catch (_retryErr) {
        // Fall through.
      }
    }

    if (!msg.includes("does not exist")) {
      console.warn("UESRPG | Start-of-turn effect expiry failed", err);
    }
  }
}

async function _postRegenerationPrompts(candidates, round) {
  if (!Array.isArray(candidates) || !candidates.length) return;

  for (const entry of candidates) {
    const actor = entry?.actor ?? null;
    if (!actor) continue;

    const value = Number(entry?.traitValue ?? 0) || 0;
    if (value <= 0) continue;

    const lastRound = Number(actor.getFlag(FLAG_SCOPE, "regenerationPromptRound") ?? 0);
    if (lastRound === round) {
      if (isPerfEnabled()) {
        console.warn(`UESRPG | turn-ticker | GUARDRAIL: Regen prompt already sent for "${actor.name}" round ${round} - skipping duplicate.`);
      }
      continue;
    }

    await postRegenerationPrompt({ actor, traitValue: value, round });
    await requestUpdateDocument(actor, { [`flags.${FLAG_SCOPE}.regenerationPromptRound`]: round });
  }
}

async function _postRegenerationPromptsAggregated(candidates, round) {
  if (!Array.isArray(candidates) || !candidates.length) return;

  /** @type {Array<{actor: Actor, traitValue: number}>} */
  const eligible = [];
  for (const entry of candidates) {
    const actor = entry?.actor ?? null;
    if (!actor) continue;

    const value = Number(entry?.traitValue ?? 0) || 0;
    if (value <= 0) continue;

    const lastRound = Number(actor.getFlag(FLAG_SCOPE, "regenerationPromptRound") ?? 0);
    if (lastRound === round) continue;

    eligible.push({ actor, traitValue: value });
  }

  if (!eligible.length) return;

  await postRegenPromptBatch(eligible, { round });

  const batchRows = eligible.map(({ actor }) => ({
    docOrUuid: actor,
    updateData: { [`flags.${FLAG_SCOPE}.regenerationPromptRound`]: round }
  }));

  const result = await requestBatchUpdateDocuments(batchRows);
  if (result?.ok === true) {
    return {
      writeCount: eligible.length,
      batchCount: 1,
      failureCount: 0
    };
  }

  const failedUuidSet = new Set((result?.failures ?? []).map((f) => String(f?.uuid ?? "")).filter(Boolean));
  let fallbackFailures = 0;
  for (const row of batchRows) {
    const actor = row.docOrUuid;
    const uuid = String(actor?.uuid ?? "");
    if (failedUuidSet.size && !failedUuidSet.has(uuid)) continue;
    const ok = await requestUpdateDocument(actor, row.updateData);
    if (!ok) fallbackFailures += 1;
  }

  return {
    writeCount: eligible.length,
    batchCount: 1,
    failureCount: fallbackFailures
  };
}

async function _runSilencedRoundChecks(candidates, combat) {
  if (!Array.isArray(candidates) || !candidates.length) return;

  // Intentionally sequential/non-batched writes:
  // runSilencedRealizationCheck performs roll + per-actor dedupe/write as one
  // immediate operation. Batching that write lane safely would require API
  // changes in condition-engine and is out of scope for command 02.
  for (const entry of candidates) {
    const actor = entry?.actor ?? null;
    if (!actor) continue;
    await runSilencedRealizationCheck(actor, { combat });
  }
}

async function _runSilencedRoundChecksParallel(candidates, combat) {
  if (!Array.isArray(candidates) || !candidates.length) return;

  const checks = [];
  for (const entry of candidates) {
    const actor = entry?.actor ?? null;
    if (!actor) continue;
    checks.push(runSilencedRealizationCheck(actor, { combat }));
  }

  if (checks.length) await Promise.allSettled(checks);
}

function _collectRegenerationCandidatesByCombatScan(combat) {
  const out = [];
  const combatants = Array.isArray(combat?.combatants) ? combat.combatants : Array.from(combat?.combatants ?? []);

  for (const combatant of combatants) {
    const actor = combatant?.actor ?? null;
    if (!actor) continue;
    const traitValue = Number(getActorTraitValue(actor, "regeneration", { mode: "max" })) || 0;
    if (traitValue > 0) out.push({ actor, traitValue });
  }

  return out;
}

function _collectSilencedCandidatesByCombatScan(combat) {
  const out = [];
  const combatants = Array.isArray(combat?.combatants) ? combat.combatants : Array.from(combat?.combatants ?? []);

  for (const combatant of combatants) {
    const actor = combatant?.actor ?? null;
    if (!actor) continue;
    out.push({ actor });
  }

  return out;
}

async function _handleCombatBoundaryTick(payload) {
  try {
    if (!game.user?.isGM) return;
    if (payload?.source !== "combat") return;
    if (payload?.combat?.phase && payload.combat.phase !== "post") return;

    const combat = game.combat ?? null;
    if (!combat?.id) return;
    if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

    const prev = _getState(combat);
    const next = _snapshotCombat(combat);

    if (!prev) {
      _setState(combat);
      return;
    }

    const changed = {};
    if (prev.round !== next.round) changed.round = next.round;
    if (prev.turn !== next.turn) changed.turn = next.turn;
    if (prev.combatantId !== next.combatantId) changed.combatantId = next.combatantId;

    _setState(combat);
    if (!Object.keys(changed).length) return;

    const _perf = isPerfEnabled();
    const _t0 = _perf ? monoMs() : 0;
    const _combatId = combat.id;
    const _round = next.round;
    const _combatantsTotal = Array.from(combat.combatants ?? []).length;

    const prevCombatant = _getPreviousCombatant(combat, changed);
    const actor = prevCombatant?.actor ?? null;

    const _tEndTurn = _perf ? monoMs() : 0;
    if (actor) await tickConditionsEndTurn(actor);
    if (_perf) {
      perfRecord({
        event: "turnTicker.endTurnTick",
        combatId: _combatId,
        round: _round,
        actorId: actor?.id ?? null,
        durationMs: monoMs() - _tEndTurn,
      });
    }

    const _tExpiry = _perf ? monoMs() : 0;
    await _expireStartOfTurnEffects(combat, changed);
    if (_perf) {
      perfRecord({
        event: "turnTicker.expireEffects",
        combatId: _combatId,
        round: _round,
        durationMs: monoMs() - _tExpiry,
      });
    }

    const _tRegen = _perf ? monoMs() : 0;
    let _regenCandidates = [];
    let _regenFallbackUsed = false;
    let _regenFallbackReason = null;
    let _regenFlagWriteCount = 0;
    let _regenFlagWriteBatchCount = 0;
    let _regenFlagWriteDurationMs = 0;
    let _regenFlagWriteFailureCount = 0;
    if ("round" in changed) {
      const query = getRegenerationCandidatesForCombat(combat);
      if (query.usedFallback) {
        _regenFallbackUsed = true;
        _regenFallbackReason = query.fallbackReason ?? "unknown";
        _regenCandidates = _collectRegenerationCandidatesByCombatScan(combat);
      } else {
        _regenCandidates = query.candidates;
      }
    }

    const _aggregateRegen = _isAggregateRegenEnabled();
    const _roundForRegen = Number(combat.round ?? 0);
    await scheduleBoundaryWork(
      async () => {
        if (_aggregateRegen) {
          const _tWrite = _perf ? monoMs() : 0;
          const writeStats = await _postRegenerationPromptsAggregated(_regenCandidates, _roundForRegen);
          if (_perf) {
            _regenFlagWriteCount = Number(writeStats?.writeCount ?? 0) || 0;
            _regenFlagWriteBatchCount = Number(writeStats?.batchCount ?? 0) || 0;
            _regenFlagWriteFailureCount = Number(writeStats?.failureCount ?? 0) || 0;
            _regenFlagWriteDurationMs = monoMs() - _tWrite;
          }
        } else {
          await _postRegenerationPrompts(_regenCandidates, _roundForRegen);
        }
      },
      { combatId: _combatId, round: _round, label: "regenPrompts" }
    );

    if (_perf) {
      perfRecord({
        event: "turnTicker.regenPrompts",
        combatId: _combatId,
        round: _round,
        combatantsTotal: _combatantsTotal,
        regenCandidateCount: _regenCandidates.length,
        fallbackScanUsed: _regenFallbackUsed,
        fallbackReason: _regenFallbackReason,
        regenFlagWriteCount: _regenFlagWriteCount,
        regenFlagWriteBatchCount: _regenFlagWriteBatchCount,
        regenFlagWriteDurationMs: _regenFlagWriteDurationMs,
        regenFlagWriteFailureCount: _regenFlagWriteFailureCount,
        isRoundBoundary: "round" in changed,
        aggregated: _aggregateRegen,
        durationMs: monoMs() - _tRegen,
      });
    }

    const _tSilenced = _perf ? monoMs() : 0;
    let _silencedCandidates = [];
    let _silencedFallbackUsed = false;
    let _silencedFallbackReason = null;
    if ("round" in changed) {
      const query = getSilencedCandidatesForCombat(combat);
      if (query.usedFallback) {
        _silencedFallbackUsed = true;
        _silencedFallbackReason = query.fallbackReason ?? "unknown";
        _silencedCandidates = _collectSilencedCandidatesByCombatScan(combat);
      } else {
        _silencedCandidates = query.candidates;
      }
    }

    const _aggregateSilenced = _isAggregateSilencedEnabled();
    await scheduleBoundaryWork(
      async () => {
        if (_aggregateSilenced) {
          await _runSilencedRoundChecksParallel(_silencedCandidates, combat);
        } else {
          await _runSilencedRoundChecks(_silencedCandidates, combat);
        }
      },
      { combatId: _combatId, round: _round, label: "silencedChecks" }
    );

    if (_perf) {
      perfRecord({
        event: "turnTicker.silencedCheck",
        combatId: _combatId,
        round: _round,
        combatantsTotal: _combatantsTotal,
        silencedCandidateCount: _silencedCandidates.length,
        fallbackScanUsed: _silencedFallbackUsed,
        fallbackReason: _silencedFallbackReason,
        isRoundBoundary: "round" in changed,
        parallel: _aggregateSilenced,
        durationMs: monoMs() - _tSilenced,
      });
    }

    if (_perf) {
      perfRecord({
        event: "turnTicker.round",
        combatId: _combatId,
        round: _round,
        combatantsTotal: _combatantsTotal,
        regenCandidateCount: _regenCandidates.length,
        silencedCandidateCount: _silencedCandidates.length,
        regenFallbackScanUsed: _regenFallbackUsed,
        silencedFallbackScanUsed: _silencedFallbackUsed,
        isRoundBoundary: "round" in changed,
        isTurnBoundary: "turn" in changed,
        durationMs: monoMs() - _t0,
      });
    }
  } catch (err) {
    console.warn("UESRPG | Condition/Wound turn ticker failed", err);
  }
}

export function registerConditionTurnTicker() {
  if (_registered) return;
  _registered = true;

  if (game?.combat) _setState(game.combat);

  Hooks.on("createCombat", (combat) => {
    _setState(combat);
  });

  Hooks.on("deleteCombat", (combat) => {
    if (!combat?.id) return;
    _combatState.delete(String(combat.id));
  });

  registerCombatBoundaryConsumer({
    id: "turn-ticker",
    order: 100,
    handle: _handleCombatBoundaryTick
  });

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    if (noteCombatBoundaryLegacyFallbackSkip("turn-ticker", payload)) return;
    await _handleCombatBoundaryTick(payload);
  });
}
