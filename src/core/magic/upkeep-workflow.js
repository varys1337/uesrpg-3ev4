/**
 * @module upkeep-workflow
 * @file src/core/magic/upkeep-workflow.js
 *
 * Spell upkeep system for UESRPG 3ev4.
 *
 * RAW intent (Chapter 6):
 * - The caster can, as a Free Action, refresh the effect and duration of a spell with the Upkeep
 *   attribute when it ends by paying the original cost they paid for the spell.
 * - Upkeep must use the original target(s) and requires that spell requirements (e.g., range) are still met.
 * - If a spell has no listed duration, treat it as having a 1 round duration for the purposes of upkeep.
 * - Spells with no listed duration cannot be upkept if the caster has cast a different spell since the
 *   original cast of the upkept spell.
 *
 * Implementation notes:
 * - We treat Upkeep as an effect-refresh (duration reset + cost spend). We do not perform the original
 *   casting test again.
 * - Upkeep prompts are grouped by spell instance: {casterUuid, spellUuid, originalCastWorldTime}.
 *   This prevents duplicate prompts when the same spell instance applied multiple effects/targets.
 * - Prompt de-duplication is tracked on the spell-created ActiveEffect(s) themselves via flags, not on the caster,
 *   so that unlinked token actors do not cause repeated prompt spam.
 *
 * ## Performance
 *
 * - `_recentPromptCache` is pruned on every realtime scan to prevent memory growth.
 * - Actor/document resolution uses synchronous `fromUuidSync()` since actors and tokens
 *   are always loaded client-side — avoids unnecessary microtask overhead.
 * - The confirm handler performs a single effect-collection pass and merges the duration
 *   refresh with buffer restoration in one iteration.
 *
 * Target: Foundry VTT v13.351
 */

/**
 * Upkeep group entry collected during expiration scanning.
 *
 * Groups all effects that belong to the same spell instance (caster + spell +
 * cast-time) so they can be presented as a single upkeep prompt.
 *
 * @typedef {object} UpkeepGroupEntry
 * @property {string}       groupKey              - "{casterUuid}::{spellUuid}::{originalCastWorldTime}"
 * @property {string}       casterUuid            - Caster actor UUID
 * @property {string}       spellUuid             - Spell item UUID
 * @property {number}       originalCastWorldTime - World time when the spell was originally cast
 * @property {string}       spellName             - Human-readable spell name
 * @property {Set<number>}  upkeepCosts           - Set of observed upkeep cost values
 * @property {Array<{targetActorId: string, effectId: string}>} effectRefs - Affected actor/effect pairs
 * @property {{mode: string, endTime?: number, endRound?: number, endTurn?: number, atWorldTime: number}} promptContext
 */

import { getSpellMaxRangeMeters, getSpellRangeType } from "./spell-range.js";
import { requestBatchUpdateDocuments, requestUpdateChatMessage, requestUpdateDocument, requestUpdateEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { MagicTimekeeping } from "./timekeeping-helper.js";
import { classifySpellForRouting } from "./spell-runtime.js";
import { AttackTracker } from "../combat/attack-tracker.js";
import { isActorInStartedCombatEncounter } from "../combat/combat-scope.js";
import { safeDeleteEmbeddedDocuments, safeGetEffect } from "../../utils/ae-helpers.js";
import { findOriginAEByGroupKey, refreshOriginAEUpkeep, cancelOriginAEUpkeep } from "./effects/origin-effect.js";
import { buildUpkeepGroupKey, parseUpkeepGroupKey } from "./effects/spell-effect-metadata.js";
import { extendEffectDurationByCanonicalPeriod, SPELL_EFFECT_DURATION_FLAG_KEY } from "./effects/spell-effect-duration.js";
import { hasTalent } from "../traits/talents-api.js";
import { resolveActorFromUuidSync, resolveUuidSync } from "../../utils/uuid-cache.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../utils/perf-tracker.js";
import { registerCombatBoundaryConsumer, noteCombatBoundaryLegacyFallbackSkip } from "../time/combat-boundary-orchestrator.js";
import { buildSpellExpirationAnchor, normalizeSpellExpirationAnchor, explainSpellAnchorResolution, resolveCombatantForActor } from "../../utils/document-resolution.js";
import { getActorCapabilityFlag } from "../active-effects/modifier-evaluator.js";
import { isMagicDynamicInitiativeEnabled } from "./settings.js";

const _FLAG_NS = FLAG_SCOPE;
const _anchorDebug = createDebugLogger("aeLifecycleDebug", "[UESRPG][Upkeep]");

/** @type {Set<string>} Serialization locks to prevent concurrent prompts for the same group+boundary. */
const _promptLocks = new Set();

/** @type {Map<string, {time: number}>} De-duplication cache for realtime prompts. Pruned on each scan. */
const _recentPromptCache = new Map();

/** @type {boolean} Guard against overlapping realtime scans. */
let _realtimeScanInFlight = false;

/** @type {Map<string, string>} per-combat dedupe key "{round}:{turn}" for post-commit upkeep cadence. */
const _lastCombatUpkeepBoundaryKey = new Map();

async function _handleCombatBoundaryUpkeep(payload) {
  const p = payload ?? {};
  const combat = p.combat ?? null;
  if (String(p.source ?? "") !== "combat") return;
  if (String(combat?.phase ?? "") !== "post") return;
  if (!game.user?.isGM) return;

  const activeCombat = game.combat ?? null;
  if (!activeCombat?.id) return;
  if (combat?.id && String(combat.id) !== String(activeCombat.id)) return;
  if (!activeCombat.started) return;

  const nextRound = _num(combat?.round, _num(activeCombat.round, _currentRound()));
  const nextTurn = _num(combat?.turn, _num(activeCombat.turn, _currentTurn()));
  const combatId = String(activeCombat.id ?? "");
  const dedupeKey = `${nextRound}:${nextTurn}`;
  if (_lastCombatUpkeepBoundaryKey.get(combatId) === dedupeKey) return;
  _lastCombatUpkeepBoundaryKey.set(combatId, dedupeKey);

  const _perf = isPerfEnabled();
  const _t0 = _perf ? monoMs() : 0;
  const targetCombatantId = String(activeCombat.combatant?.id ?? activeCombat.combatantId ?? "");
  await _checkUpkeepCombatTurnStart(nextRound, nextTurn);
  if (_perf) {
    perfRecord({
      event: "dynamicInitiative.upkeepTarget",
      combatId,
      round: nextRound,
      turn: nextTurn,
      targetCombatantId: targetCombatantId || null,
      enabled: isMagicDynamicInitiativeEnabled(),
      durationMs: monoMs() - _t0,
    });
  }
}

// ─── Utility Helpers ─────────────────────────────────────────────────────────

/** @returns {number} Configured round time in seconds. */
function _roundTimeSeconds() {
  return MagicTimekeeping.roundTimeSeconds();
}

/** @returns {number} Current combat round (0 if no combat). */
function _currentRound() {
  return MagicTimekeeping.combatRound();
}

/** @returns {number} Current combat turn index (0 if no combat). */
function _currentTurn() {
  return MagicTimekeeping.combatTurn();
}

/** @returns {number} Current world time in seconds. */
function _nowWorldTime() {
  return MagicTimekeeping.nowWorldTimeSeconds();
}

/**
 * Coerce to string.
 * @param {*} v
 * @returns {string}
 */
import { _num, _str, createDebugLogger } from "./_primitives.js";

function _fromUuidSync(uuid) {
  return resolveUuidSync(uuid);
}

/**
 * Build a de-duplication signature from prompt context.
 * @param {object} promptContext
 * @returns {string}
 */
function _promptSignature(promptContext) {
  if (!promptContext) return "";
  if (promptContext.mode === "realtime") return `rt:${_num(promptContext.endTime, 0)}`;
  if (promptContext.mode === "combat") return `cb:${_num(promptContext.endRound, 0)}:${_num(promptContext.endTurn, 0)}`;
  return "";
}

/**
 * Check if a group+boundary was recently prompted (within one round time).
 * @param {string} groupKey
 * @param {object} promptContext
 * @returns {boolean}
 */
function _isRecentlyPrompted(groupKey, promptContext) {
  const signature = _promptSignature(promptContext);
  if (!groupKey || !signature) return false;
  const key = `${groupKey}::${signature}`;
  const entry = _recentPromptCache.get(key);
  if (!entry) return false;
  const ttl = Math.max(1, _roundTimeSeconds());
  if ((_nowWorldTime() - entry.time) <= ttl) return true;
  _recentPromptCache.delete(key);
  return false;
}

/**
 * Mark a group+boundary as recently prompted.
 * @param {string} groupKey
 * @param {object} promptContext
 */
function _markRecentlyPrompted(groupKey, promptContext) {
  const signature = _promptSignature(promptContext);
  if (!groupKey || !signature) return;
  const key = `${groupKey}::${signature}`;
  _recentPromptCache.set(key, { time: _nowWorldTime() });
}

/**
 * Prune stale entries from `_recentPromptCache` to prevent memory growth.
 * Called once per realtime scan cycle.
 */
function _prunePromptCache() {
  if (_recentPromptCache.size === 0) return;
  const now = _nowWorldTime();
  const ttl = Math.max(1, _roundTimeSeconds()) * 3; // 3× round time safety margin
  for (const [key, entry] of _recentPromptCache) {
    if ((now - entry.time) > ttl) _recentPromptCache.delete(key);
  }
}

/**
 * Execute a function under a serialization lock for a specific group+boundary.
 * Prevents concurrent prompts being created for the same spell instance.
 *
 * @param {string} groupKey
 * @param {object} promptContext
 * @param {Function} fn
 */
async function _withPromptLock(groupKey, promptContext, fn) {
  if (typeof fn !== "function") return;
  const signature = _promptSignature(promptContext);
  const lockKey = signature ? `${groupKey}::${signature}` : String(groupKey || "");
  if (_promptLocks.has(lockKey)) return;
  _promptLocks.add(lockKey);
  try {
    await fn();
  } finally {
    _promptLocks.delete(lockKey);
  }
}

/**
 * Safely retrieve a live effect from an actor, returning null if deleted.
 * @param {Actor} actor
 * @param {string} effectId
 * @returns {ActiveEffect|null}
 */
function _getActorEffect(actor, effectId) {
  if (!actor || !effectId) return null;
  return safeGetEffect(actor, effectId);
}

/** @type {ReadonlySet<string>} Error message substrings indicating a missing/deleted document. */
const _MISSING_DOC_MARKERS = Object.freeze(new Set([
  "does not exist", "No Document", "Cannot read properties of undefined"
]));

/**
 * Check whether an error is a "document doesn't exist" error.
 * @param {Error|string} err
 * @returns {boolean}
 */
function _isMissingDocError(err) {
  const msg = String(err?.message ?? err);
  for (const marker of _MISSING_DOC_MARKERS) {
    if (msg.includes(marker)) return true;
  }
  return false;
}

/**
 * Update an Active Effect defensively, handling race conditions where the
 * effect may have been deleted between when we resolved it and when the
 * update executes.
 *
 * @param {ActiveEffect} effect
 * @param {object}       updates — Foundry update payload.
 * @returns {Promise<boolean>} Whether the update succeeded.
 */
async function _safeUpdateEffect(effect, updates) {
  if (!effect || !updates) return false;
  if (!effect.id) return false;
  const parent = effect.parent;
  if (!parent?.id) return false;
  // Use safe getter to avoid "does not exist" errors
  const currentEffect = safeGetEffect(parent, effect.id);
  if (!currentEffect) return false;

  if (game.user?.isGM || currentEffect.isOwner) {
    try {
      // Re-verify parent is still valid before update (guards against stale references)
      if (!currentEffect.parent?.id) return false;
      await currentEffect.update(updates);
      return true;
    } catch (err) {
      if (_isMissingDocError(err)) return false;
      console.error("UESRPG | upkeep-workflow | Failed to update effect", { effectId: effect?.id, err });
      return false;
    }
  }

  try {
    return await requestUpdateDocument(effect, updates);
  } catch (err) {
    if (_isMissingDocError(err)) return false;
    console.error("UESRPG | upkeep-workflow | Failed to proxy-update effect", { effectId: effect?.id, err });
    return false;
  }
}

/**
 * Build a group key from effect flags.
 * Format: `{casterUuid}::{spellUuid}::{originalCastWorldTime}`
 *
 * @param {object} flags
 * @returns {string|null}
 */
function _groupKeyFromFlags(flags) {
  const existing = _str(flags?.upkeepGroupKey);
  if (existing) return existing;
  const groupKey = buildUpkeepGroupKey({
    casterUuid: flags?.casterUuid,
    casterTokenUuid: flags?.casterTokenUuid,
    spellUuid: flags?.spellUuid,
    originalCastWorldTime: flags?.originalCastWorldTime
  });
  return groupKey || null;
}

/**
 * Parse a group key back to its constituent parts.
 * @param {string} key
 * @returns {{ casterUuid: string, spellUuid: string, originalCastWorldTime: number }}
 */
function _parseGroupKey(key) {
  return parseUpkeepGroupKey(key);
}

function _getNominalDuration(effect, flags = null) {
  const effectFlags = flags ?? effect?.flags?.[_FLAG_NS] ?? {};
  const canonical = effectFlags?.[SPELL_EFFECT_DURATION_FLAG_KEY] ?? null;
  if (Number(canonical?.value) > 0) {
    return {
      value: Number(canonical.value),
      units: String(canonical.units ?? "seconds"),
      expiry: canonical.expiry ?? null,
      seconds: 0,
      rounds: String(canonical.units ?? "") === "rounds" ? Number(canonical.value) : 0,
      turns: String(canonical.units ?? "") === "turns" ? Number(canonical.value) : 0
    };
  }
  const live = effect?.duration ?? {};
  return {
    seconds: _num(effectFlags?.durationSeconds, _num(live.seconds, 0)),
    rounds: _num(effectFlags?.durationRounds, _num(live.rounds, 0)),
    turns: _num(effectFlags?.durationTurns, _num(live.turns, 0))
  };
}

function _isOriginSpellEffect(effect) {
  return Boolean(effect?.flags?.[_FLAG_NS]?.isOriginAE);
}

function _collectRelevantActors() {
  return MagicTimekeeping.relevantActorsArray?.() ?? Array.from(MagicTimekeeping.collectRelevantActors?.() ?? []);
}

function _getTokenByUuidOnScene(tokenUuid, scene) {
  const resolved = tokenUuid ? _fromUuidSync(tokenUuid) : null;
  const token = resolved?.object ?? resolved ?? null;
  const doc = token?.document ?? token;
  if (!token || !doc) return null;
  if (scene?.id && String(doc?.scene?.id ?? doc?.parent?.id ?? "") !== String(scene.id)) return null;
  return token;
}

/**
 * Measure the grid-space distance between two tokens in meters.
 *
 * Uses Foundry v13's `measurePath` API with fallback to deprecated `measureDistances`
 * for compatibility. Returns `Infinity` if measurement is impossible.
 *
 * @param {Token|TokenDocument} aToken
 * @param {Token|TokenDocument} bToken
 * @returns {number} Distance in scene units (meters).
 */
function _measureDistanceMeters(aToken, bToken) {
  try {
    const a = aToken?.center ?? aToken?.object?.center ?? null;
    const b = bToken?.center ?? bToken?.object?.center ?? null;
    if (!a || !b) return Number.POSITIVE_INFINITY;

    if (!canvas?.grid || !canvas?.scene) return Number.POSITIVE_INFINITY;

    // Use v13 measurePath API with fallback to deprecated measureDistances
    if (typeof canvas.grid.measurePath === "function") {
      const path = canvas.grid.measurePath([a, b], { gridSpaces: true });
      const d = path?.distance ?? (Array.isArray(path) && path.length > 0 ? path[0] : null);
      if (Number.isFinite(d)) return d;
    } else {
      const distances = canvas.grid.measureDistances([a, b], { gridSpaces: true });
      const d = Array.isArray(distances) ? distances[0] : null;
      if (Number.isFinite(d)) return d;
    }

    // Fallback: approximate using pixel distance and grid scale.
    const pixels = Math.hypot(b.x - a.x, b.y - a.y);
    const gridSize = Number(canvas.grid.size ?? 0) || 0;
    const gridDistance = Number(canvas.scene.grid?.distance ?? 0) || 0;
    if (gridSize > 0 && gridDistance > 0) return (pixels / gridSize) * gridDistance;

    return Number.POSITIVE_INFINITY;
  } catch (_e) {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Find a token for the given actor on the given scene.
 * @param {Actor}  actor
 * @param {Scene}  scene
 * @returns {Token|null}
 */
function _getTokenForActorOnScene(actor, scene) {
  if (!actor || !scene) return null;
  const tokens = actor.getActiveTokens?.(true, true) ?? actor.getActiveTokens?.() ?? [];
  for (const t of tokens) {
    const doc = t?.document ?? t;
    if (doc?.scene?.id && doc.scene.id !== scene.id) continue;
    if (doc?.parent?.id && doc.parent.id !== scene.id) continue;
    return t?.object ?? t;
  }
  return null;
}

/**
 * Get the realtime end-time of an effect (startTime + seconds).
 * @param {ActiveEffect} effect
 * @returns {number|null}
 */
function _getEffectEndTime(effect) {
  const d = effect?.duration ?? {};
  const flags = effect?.flags?.[_FLAG_NS] ?? {};
  const nominal = _getNominalDuration(effect, flags);
  const seconds = _num(nominal.seconds, 0);
  const startTime = _num(flags?.durationStartTime, _num(d.startTime, 0));
  if (!(seconds > 0) || !(startTime > 0)) return null;
  return startTime + seconds;
}

/**
 * Get the combat-boundary (endRound, endTurn) for an upkeep effect.
 * Returns null if the effect doesn't have valid combat duration markers.
 *
 * @param {ActiveEffect} effect
 * @param {object}       flags — The effect's system flags.
 * @returns {{ endRound: number, endTurn: number }|null}
 */
function _getEffectCombatBoundary(effect, flags) {
  const d = effect?.duration ?? {};
  const srRaw = flags?.durationStartRound ?? d.startRound;
  const stRaw = flags?.durationStartTurn ?? d.startTurn;
  if (srRaw === null || srRaw === undefined) return null;
  if (stRaw === null || stRaw === undefined) return null;

  const startRound = _num(srRaw, 0);
  const startTurn = _num(stRaw, 0);

  const nominal = _getNominalDuration(effect, flags);
  const roundsRaw = _num(nominal.rounds, 0);
  const roundsForUpkeep = Boolean(flags?.noListedDuration) ? 1 : roundsRaw;
  if (!(roundsForUpkeep > 0)) return null;

  const anchor = normalizeSpellExpirationAnchor(flags, { combat: game.combat ?? null });
  const explanation = explainSpellAnchorResolution(game.combat ?? null, anchor);
  _anchorDebug("Computed upkeep combat boundary", {
    effect: effect?.name ?? null,
    targetActor: effect?.parent?.name ?? null,
    source: explanation?.source ?? "unresolved",
    reason: explanation?.reason ?? "",
    combatantId: explanation?.combatantId ?? null,
    round: game?.combat?.round ?? null,
    turn: game?.combat?.turn ?? null
  });
  const casterTurnIndex = explanation?.turnIndex ?? null;
  const endTurn = Number.isFinite(Number(casterTurnIndex)) ? _num(casterTurnIndex, startTurn) : startTurn;

  return {
    endRound: startRound + roundsForUpkeep,
    endTurn
  };
}

function _buildPromptContextForEffect(effect, flags, nowTime, { nextRound = null, nextTurn = null } = {}) {
  const awaiting = Boolean(flags?.upkeepAwaiting);
  const expiredAtWorldTime = _num(flags?.expiredAtWorldTime, 0);
  const expiredAtCombatRound = _num(flags?.expiredAtCombatRound, -1);

  const realtimeEndTime = _getEffectEndTime(effect);
  const combatBoundary = _getEffectCombatBoundary(effect, flags);
  const rt = _roundTimeSeconds();

  if (Number.isFinite(Number(nextRound)) && Number.isFinite(Number(nextTurn))) {
    const boundaryRound = awaiting
      ? _num(flags?.upkeepPromptedCombatRound, combatBoundary?.endRound ?? -999999)
      : _num(combatBoundary?.endRound, -999999);
    const boundaryTurn = awaiting
      ? _num(flags?.upkeepPromptedCombatTurn, combatBoundary?.endTurn ?? -999999)
      : _num(combatBoundary?.endTurn, -999999);
    const currentRound = _currentRound();
    const inGraceWindow = awaiting && expiredAtCombatRound >= 0 && (currentRound - expiredAtCombatRound) < 1;
    if (!combatBoundary && !inGraceWindow) return null;
    if (boundaryRound !== _num(nextRound, 0) || boundaryTurn !== _num(nextTurn, 0)) return null;
    return {
      mode: "combat",
      endRound: boundaryRound,
      endTurn: boundaryTurn,
      atWorldTime: nowTime
    };
  }

  const inGraceWindow = awaiting && expiredAtWorldTime > 0 && ((nowTime - expiredAtWorldTime) <= rt);
  if (!_isWithinRealtimeWindow(effect, nowTime) && !inGraceWindow) return null;

  const endTime = realtimeEndTime ?? _num(flags?.upkeepPromptedEndTime, 0) ?? expiredAtWorldTime;
  if (!(endTime > 0)) return null;

  return {
    mode: "realtime",
    endTime,
    atWorldTime: nowTime
  };
}

/**
 * Check if an effect's realtime expiry is within the prompt window.
 * @param {ActiveEffect} effect
 * @param {number}       nowTime — Current world time.
 * @returns {boolean}
 */
function _isWithinRealtimeWindow(effect, nowTime) {
  const endTime = _getEffectEndTime(effect);
  if (endTime == null) return false;

  const rt = _roundTimeSeconds();

  // Prompt window:
  // - last "round" before expiry
  // - and a grace window after expiry to support calendar time jumps.
  return (nowTime >= (endTime - rt)) && (nowTime < (endTime + rt));
}

/**
 * Scan all relevant actors for spell effects whose realtime duration is within
 * the prompt window. Returns groups keyed by groupKey.
 *
 * @param {number|null} [nowTimeOverride] — Override world time (for testing).
 * @returns {Promise<{ groups: Map<string, object>, nowTime: number }>}
 */
async function _collectExpiringGroupsRealtime(nowTimeOverride = null) {
  const groups = new Map();
  const nowTime = Number.isFinite(Number(nowTimeOverride)) ? Number(nowTimeOverride) : _nowWorldTime();
  for (const casterActor of _collectRelevantActors()) {
    for (const effect of (casterActor.effects ?? [])) {
      const flags = effect.flags?.[_FLAG_NS];
      if (!flags?.spellEffect || !flags?.hasUpkeep || !_isOriginSpellEffect(effect)) continue;
      if (!Boolean(flags?.upkeepAwaiting)) continue;

      const promptContext = _buildPromptContextForEffect(effect, flags, nowTime);
      if (!promptContext) continue;

      const gk = _groupKeyFromFlags(flags);
      if (!gk) continue;

      const matches = await _collectCurrentEffectsForGroup(gk);
      const linkedMatches = matches.filter((m) => !Boolean(m.flags?.isOriginAE));
      const entry = groups.get(gk) ?? {
        groupKey: gk,
        casterUuid: _str(flags.casterUuid),
        casterTokenUuid: _str(flags.casterTokenUuid),
        spellUuid: _str(flags.spellUuid),
        originalCastWorldTime: _num(flags.originalCastWorldTime, 0),
        spellName: _str(flags.spellName || effect.name),
        upkeepCosts: new Set(),
        effectRefs: [],
        originRef: { actorId: casterActor.id, effectId: effect.id },
        promptContext
      };

      entry.upkeepCosts.add(_num(flags.upkeepCost, 0));
      entry.effectRefs = linkedMatches.map((m) => ({ targetActorId: m.targetActor.id, effectId: m.effect.id }));
      if (_num(entry.promptContext?.endTime, _num(promptContext.endTime, 0)) > _num(promptContext.endTime, 0)) {
        entry.promptContext.endTime = _num(promptContext.endTime, 0);
      }
      groups.set(gk, entry);
    }
  }

  return { groups, nowTime };
}

function _buildUpkeepGroupFromMatches(groupKey, matches, promptContext, originEffect = null) {
  if (!groupKey || !promptContext) return null;
  const sortedMatches = Array.isArray(matches) ? matches : [];
  const originMatch = sortedMatches.find((m) => Boolean(m.flags?.isOriginAE)) ?? null;
  const linkedMatches = sortedMatches.filter((m) => !Boolean(m.flags?.isOriginAE));
  const origin = originEffect ?? originMatch?.effect ?? findOriginAEByGroupKey(groupKey);
  const originFlags = origin?.flags?.[_FLAG_NS] ?? originMatch?.flags ?? linkedMatches[0]?.flags ?? {};
  const originActor = origin?.parent ?? originMatch?.targetActor ?? null;
  if (!origin?.id || !originActor?.id) return null;

  const upkeepCosts = new Set();
  for (const match of sortedMatches) {
    const value = _num(match?.flags?.upkeepCost, Number.NaN);
    if (Number.isFinite(value)) upkeepCosts.add(value);
  }

  return {
    groupKey,
    casterUuid: _str(originFlags.casterUuid),
    casterTokenUuid: _str(originFlags.casterTokenUuid),
    spellUuid: _str(originFlags.spellUuid),
    originalCastWorldTime: _num(originFlags.originalCastWorldTime, 0),
    spellName: _str(originFlags.spellName || origin?.name),
    upkeepCosts,
    effectRefs: linkedMatches.map((m) => ({ targetActorId: m.targetActor.id, effectId: m.effect.id })),
    originRef: { actorId: originActor.id, effectId: origin.id },
    promptContext
  };
}

/**
 * Scan all relevant actors for spell effects whose combat-boundary matches the
 * incoming (nextRound, nextTurn). Returns groups keyed by groupKey.
 *
 * @param {number} nextRound — The incoming combat round.
 * @param {number} nextTurn  — The incoming combat turn.
 * @returns {Promise<{ groups: Map<string, object>, nowTime: number }>}
 */
async function _collectExpiringGroupsCombatTurnStart(nextRound, nextTurn) {
  const groups = new Map();
  const nowTime = _nowWorldTime();
  const nr = _num(nextRound, _currentRound());
  const nt = _num(nextTurn, _currentTurn());

  for (const casterActor of _collectRelevantActors()) {
    for (const effect of (casterActor.effects ?? [])) {
      const flags = effect.flags?.[_FLAG_NS];
      if (!flags?.spellEffect || !flags?.hasUpkeep || !_isOriginSpellEffect(effect)) continue;
      if (!Boolean(flags?.upkeepAwaiting)) continue;

      const promptContext = _buildPromptContextForEffect(effect, flags, nowTime, { nextRound: nr, nextTurn: nt });
      if (!promptContext) continue;

      const gk = _groupKeyFromFlags(flags);
      if (!gk) continue;

      const matches = await _collectCurrentEffectsForGroup(gk);
      const linkedMatches = matches.filter((m) => !Boolean(m.flags?.isOriginAE));
      const entry = groups.get(gk) ?? {
        groupKey: gk,
        casterUuid: _str(flags.casterUuid),
        casterTokenUuid: _str(flags.casterTokenUuid),
        spellUuid: _str(flags.spellUuid),
        originalCastWorldTime: _num(flags.originalCastWorldTime, 0),
        spellName: _str(flags.spellName || effect.name),
        upkeepCosts: new Set(),
        effectRefs: [],
        originRef: { actorId: casterActor.id, effectId: effect.id },
        promptContext
      };

      entry.upkeepCosts.add(_num(flags.upkeepCost, 0));
      entry.effectRefs = linkedMatches.map((m) => ({ targetActorId: m.targetActor.id, effectId: m.effect.id }));
      groups.set(gk, entry);
    }
  }

  return { groups, nowTime };
}

/**
 * Stamp prompt-tracking flags onto all effects that belong to the given group
 * so that subsequent expiry scans skip them.
 *
 * @param {string} groupKey
 * @param {object} promptContext — Contains mode, endTime/endRound/endTurn, atWorldTime.
 */
async function _markEffectsPromptedForGroup(groupKey, promptContext) {
  if (!groupKey || !promptContext) return;

  const matches = await _collectCurrentEffectsForGroup(groupKey);
  if (!matches.length) return;

  for (const m of matches) {
    const updates = {
      [`flags.${_FLAG_NS}.upkeepPromptedAtWorldTime`]: _num(promptContext.atWorldTime, _nowWorldTime())
    };

    if (promptContext.mode === "realtime") {
      const endTime = _num(promptContext.endTime, 0);
      if (endTime > 0) updates[`flags.${_FLAG_NS}.upkeepPromptedEndTime`] = endTime;
    } else if (promptContext.mode === "combat") {
      updates[`flags.${_FLAG_NS}.upkeepPromptedCombatRound`] = _num(promptContext.endRound, 0);
      updates[`flags.${_FLAG_NS}.upkeepPromptedCombatTurn`] = _num(promptContext.endTurn, 0);
    }
    updates[`flags.${_FLAG_NS}.upkeepPromptSignature`] = _promptSignature(promptContext);

    const live = _getActorEffect(m.targetActor, m.effect?.id);
    if (!live) continue;
    const ok = await _safeUpdateEffect(live, updates);
    if (!ok) continue;
  }
}

/**
 * Initialize upkeep system hooks.
 */
export function initializeUpkeepSystem() {
  // Guard against multi-registration on hot reload.
  if (globalThis.__UESRPG_UPKEEP_SYSTEM_HOOKS_INSTALLED__) return;
  globalThis.__UESRPG_UPKEEP_SYSTEM_HOOKS_INSTALLED__ = true;
}

/**
 * Entry point for combat-cadence upkeep checks. Called on post-commit
 * uesrpg.combatTimeChanged hook.
 *
 * @param {number} nextRound
 * @param {number} nextTurn
 */
async function _checkUpkeepCombatTurnStart(nextRound, nextTurn) {
  const { groups } = await _collectExpiringGroupsCombatTurnStart(nextRound, nextTurn);

  for (const group of groups.values()) {
    await ensureUpkeepPromptForGroup(group.groupKey, group.promptContext);
  }
}

/**
 * Entry point for realtime (out-of-combat) upkeep checks. Called on
 * uesrpg.timeChanged hook. Re-entrant guard prevents overlapping scans.
 *
 * @param {number|null} [nowTimeOverride]
 */
async function _checkUpkeepRealtime(nowTimeOverride = null) {
  if (_realtimeScanInFlight) return;
  _realtimeScanInFlight = true;
  try {
    // Prune stale prompt cache entries to prevent unbounded growth
    _prunePromptCache();

    const { groups } = await _collectExpiringGroupsRealtime(nowTimeOverride);

    for (const group of groups.values()) {
      if (_isRecentlyPrompted(group.groupKey, group.promptContext)) continue;

      await _withPromptLock(group.groupKey, group.promptContext, async () => {
        await ensureUpkeepPromptForGroup(group.groupKey, group.promptContext);
        _markRecentlyPrompted(group.groupKey, group.promptContext);
      });
    }
  } finally {
    _realtimeScanInFlight = false;
  }
}

/**
 * Build a human-readable summary of target names from effectRefs.
 * Truncates to 3 names with a "+N more" suffix.
 *
 * @param {Array<{ targetActorId: string }>} effectRefs
 * @returns {string}
 */
function _formatTargetNames(effectRefs) {
  const names = [];
  for (const ref of effectRefs ?? []) {
    const a = game.actors.get(ref.targetActorId);
    if (!a) continue;
    names.push(a.name);
  }
  const unique = Array.from(new Set(names));
  if (!unique.length) return "(no targets)";
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 3).join(", ")} (+${unique.length - 3} more)`;
}

function _resolveUpkeepResourcePresentation(group, upkeepCost) {
  const originActor = game.actors?.get?.(_str(group?.originRef?.actorId)) ?? null;
  const originEffect = originActor?.effects?.get?.(_str(group?.originRef?.effectId)) ?? null;
  const castSource = originEffect?.flags?.[_FLAG_NS]?.castSource ?? null;
  if (castSource?.type !== "enchantment") {
    return {
      isEnchantment: false,
      mode: "magicka",
      itemName: "",
      promptText: `Pay <strong>${upkeepCost}</strong> Magicka to refresh the effect?`
    };
  }

  const mode = _str(castSource.costMode || "soul").toLowerCase();
  if (mode === "none") {
    return {
      isEnchantment: true,
      mode,
      itemName: _str(castSource.itemName),
      promptText: "Refresh the effect with no resource cost?"
    };
  }
  if (mode === "magicka") {
    return {
      isEnchantment: true,
      mode,
      itemName: _str(castSource.itemName),
      promptText: `Pay <strong>${upkeepCost}</strong> Magicka to refresh this enchanted spell?`
    };
  }
  const itemName = foundry.utils.escapeHTML(_str(castSource.itemName || "enchanted item"));
  return {
    isEnchantment: true,
    mode: "soul",
    itemName: _str(castSource.itemName),
    promptText: `Pay <strong>${upkeepCost}</strong> Soul Energy from <strong>${itemName}</strong> to refresh this enchanted spell?`
  };
}

/**
 * Create the upkeep prompt ChatMessage for a spell group.
 * Includes Living Armory talent detection and whispers to the caster's owner(s).
 *
 * @param {object} group       — Group data from _collectExpiringGroups*.
 * @param {Actor}  casterActor — The resolved caster Actor document.
 */
async function _createUpkeepPrompt(group, casterActor) {
  if (!group?.originRef?.effectId || !_str(group?.spellUuid)) return;
  const promptSignature = _promptSignature(group.promptContext);
  const existingPrompt = (game.messages?.contents ?? []).find((msg) => {
    const upkeepGroup = msg?.flags?.[_FLAG_NS]?.upkeepGroup;
    return upkeepGroup?.groupKey === group.groupKey
      && String(upkeepGroup?.promptSignature ?? "") === promptSignature;
  });
  if (existingPrompt) return;

  const spellDoc = _fromUuidSync(_str(group.spellUuid));
  const spell = spellDoc?.documentName === "Item" ? spellDoc : null;
  if (!spell) return;

  const targetSummary = _formatTargetNames(group.effectRefs);

  const upkeepCosts = Array.from(group.upkeepCosts ?? []).filter(n => Number.isFinite(n));
  const upkeepCost = upkeepCosts.length ? Math.max(...upkeepCosts) : 0;
  const resourcePresentation = _resolveUpkeepResourcePresentation(group, upkeepCost);
  const casterToken = _getTokenByUuidOnScene(group.casterTokenUuid, canvas?.scene ?? null);

  // Living Armory check for prompt display
  const spellName = _str(group.spellName).toLowerCase();
  const isConjureEquipment = spellName.includes("conjure weapon") || spellName.includes("conjure armour") ||
    spellName.includes("conjure armor") || spellName.includes("bound weapon") || spellName.includes("bound armour") ||
    spellName.includes("bound armor");
  const hasLivingArmory = getActorCapabilityFlag(casterActor, "flags.uesrpg-3ev4.magic.upkeepViaAP") || hasTalent(casterActor, "livingarmory");
  // Check if all effect targets are the caster
  const allSelf = (group.effectRefs ?? []).every(ref => ref.targetActorId === casterActor.id);
  const showLivingArmory = isConjureEquipment && hasLivingArmory && allSelf && !resourcePresentation.isEnchantment;
  const livingArmoryNote = showLivingArmory
    ? `<p style="color: #2a7; font-style: italic;"><strong>Living Armory:</strong> Can pay 1 AP instead of ${upkeepCost} MP.</p>`
    : "";

  const content = `
  <div class="uesrpg-upkeep-card">
    <h3>Spell Upkeep</h3>
    <p><strong>${spell.name}</strong> is about to end.</p>
    <p><strong>Targets:</strong> ${targetSummary}</p>
    <p>${resourcePresentation.promptText}</p>
    ${livingArmoryNote}
    <div class="uesrpg-upkeep-buttons">
      <button type="button" class="uesrpg-upkeep-confirm" data-ues-upkeep-action="confirm"><i class="fas fa-sync-alt"></i> Upkeep</button>
      <button type="button" class="uesrpg-upkeep-cancel" data-ues-upkeep-action="cancel"><i class="fas fa-times"></i> End</button>
    </div>
  </div>`;

  const whisperIds = (game.users ?? [])
    .filter(u => u.active && (u.isGM || casterActor.testUserPermission(u, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)))
    .map(u => u.id);

  const msgData = {
    content,
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken?.document ?? casterToken ?? null }),
    flags: {
      [_FLAG_NS]: {
        upkeepGroup: {
          groupKey: group.groupKey,
          casterActorId: casterActor.id,
          casterUuid: group.casterUuid,
          casterTokenUuid: group.casterTokenUuid ?? null,
          spellUuid: group.spellUuid,
          originalCastWorldTime: group.originalCastWorldTime,
          upkeepCost,
          upkeepResource: {
            isEnchantment: resourcePresentation.isEnchantment,
            mode: resourcePresentation.mode,
            itemName: resourcePresentation.itemName
          },
          spellName: spell.name,
          effectRefs: group.effectRefs,
          promptSignature,
          resolving: false,
          resolved: false,
          resolvedAction: null,
          resolvedAt: null
        }
      }
    }
  };

  if (whisperIds.length) msgData.whisper = whisperIds;

  const created = await ChatMessage.create(msgData);
  const messageId = String(created?.id ?? "");
  if (messageId) {
    const matches = await _collectCurrentEffectsForGroup(group.groupKey);
    for (const match of matches) {
      const live = _getActorEffect(match.targetActor, match.effect?.id);
      if (!live) continue;
      await _safeUpdateEffect(live, {
        [`flags.${_FLAG_NS}.upkeepPromptMessageId`]: messageId,
        [`flags.${_FLAG_NS}.upkeepPromptSignature`]: promptSignature
      });
    }
  }
}

function _renderResolvedUpkeepPrompt(data, { action = "confirm", summary = "" } = {}) {
  const spellName = foundry.utils.escapeHTML(String(data?.spellName ?? "Spell"));
  const targetNames = Array.isArray(data?.effectRefs)
    ? foundry.utils.escapeHTML(String(_formatTargetNames(data.effectRefs) || "Unknown"))
    : "Unknown";
  const finalLabel = action === "confirm" ? "Upkept" : "Ended";
  const icon = action === "confirm" ? "fa-sync-alt" : "fa-times";
  const detail = summary
    ? `<p>${foundry.utils.escapeHTML(String(summary))}</p>`
    : "";
  return `
  <div class="uesrpg-upkeep-card is-resolved">
    <h3>Spell Upkeep</h3>
    <p><strong>${spellName}</strong> ${action === "confirm" ? "was refreshed." : "has ended."}</p>
    <p><strong>Targets:</strong> ${targetNames}</p>
    ${detail}
    <div class="uesrpg-upkeep-resolution">
      <span class="uesrpg-upkeep-resolution-pill">
        <i class="fas ${icon}"></i> ${finalLabel}
      </span>
    </div>
  </div>`;
}

async function _markUpkeepMessageResolved(message, { action = "confirm", summary = "" } = {}) {
  if (!message?.id) return false;
  const state = message.flags?.[_FLAG_NS]?.upkeepGroup ?? {};
  if (state.resolved === true) return false;

  await requestUpdateChatMessage(message, {
    content: _renderResolvedUpkeepPrompt(state, { action, summary }),
    [`flags.${_FLAG_NS}.upkeepGroup.resolving`]: false,
    [`flags.${_FLAG_NS}.upkeepGroup.resolved`]: true,
    [`flags.${_FLAG_NS}.upkeepGroup.resolvedAction`]: String(action),
    [`flags.${_FLAG_NS}.upkeepGroup.resolvedAt`]: Date.now()
  });
  return true;
}

async function _markUpkeepMessageResolving(message, action) {
  if (!message?.id) return false;
  const state = message.flags?.[_FLAG_NS]?.upkeepGroup ?? {};
  if (state.resolved === true || state.resolving === true) return false;
  await requestUpdateChatMessage(message, {
    [`flags.${_FLAG_NS}.upkeepGroup.resolving`]: true,
    [`flags.${_FLAG_NS}.upkeepGroup.resolvedAction`]: String(action)
  });
  return true;
}

async function _clearUpkeepMessageResolving(message) {
  if (!message?.id) return false;
  await requestUpdateChatMessage(message, {
    [`flags.${_FLAG_NS}.upkeepGroup.resolving`]: false
  });
  return true;
}

function _clearSuppressionFlags(updateTarget, updates) {
  if (!updateTarget || !updates) return updates;
  const meta = updateTarget?.flags?.[_FLAG_NS]?.ae?.suppressed ?? null;
  if (!meta) return updates;
  updates[`flags.${_FLAG_NS}.ae.suppressed.expired`] = false;
  updates[`flags.${_FLAG_NS}.ae.suppressed.atWorldTime`] = null;
  updates[`flags.${_FLAG_NS}.ae.suppressed.atCombatRound`] = null;
  updates[`flags.${_FLAG_NS}.ae.suppressed.reason`] = null;
  return updates;
}

export async function ensureUpkeepPromptForGroup(groupKey, promptContext = null) {
  const gk = _str(groupKey);
  if (!gk) return false;

  const matches = await _collectCurrentEffectsForGroup(gk);
  if (!matches.length) return false;

  const originMatch = matches.find((m) => Boolean(m.flags?.isOriginAE)) ?? null;
  const originEffect = originMatch?.effect ?? findOriginAEByGroupKey(gk);
  const originFlags = originEffect?.flags?.[_FLAG_NS] ?? originMatch?.flags ?? {};
  const casterActor = resolveActorFromUuidSync(_str(originFlags.casterUuid));
  if (!casterActor || !originEffect?.id) return false;

  const effectivePromptContext = promptContext ?? _buildPromptContextForEffect(originEffect, originFlags, _nowWorldTime());
  if (!effectivePromptContext) return false;

  const group = _buildUpkeepGroupFromMatches(gk, matches, effectivePromptContext, originEffect);
  if (!group) return false;

  let created = false;
  await _withPromptLock(group.groupKey, effectivePromptContext, async () => {
    const beforeId = _str(originFlags?.upkeepPromptMessageId);
    await _createUpkeepPrompt(group, casterActor);
    await _markEffectsPromptedForGroup(group.groupKey, effectivePromptContext);
    const refreshedOrigin = findOriginAEByGroupKey(group.groupKey);
    const refreshedId = _str(refreshedOrigin?.flags?.[_FLAG_NS]?.upkeepPromptMessageId);
    created = Boolean(refreshedId) && refreshedId !== beforeId;
  });

  return created;
}

/**
 * Collect all currently-live effects across relevant actors that match the given
 * group key (casterUuid + spellUuid + originalCastWorldTime).
 *
 * @param {string} groupKey
 * @returns {Promise<Array<{ targetActor: Actor, effect: ActiveEffect, flags: object }>>}
 */
async function _collectCurrentEffectsForGroup(groupKey) {
  const { casterUuid, casterTokenUuid, spellUuid, originalCastWorldTime } = _parseGroupKey(groupKey);
  const matches = [];

  for (const targetActor of _collectRelevantActors()) {
    for (const effect of (targetActor.effects ?? [])) {
      const flags = effect.flags?.[_FLAG_NS];
      if (!flags?.spellEffect || !flags?.hasUpkeep) continue;
      if (_str(flags.casterUuid) !== casterUuid) continue;
      if (casterTokenUuid && _str(flags.casterTokenUuid) !== casterTokenUuid) continue;
      if (_str(flags.spellUuid) !== spellUuid) continue;
      if (_num(flags.originalCastWorldTime, 0) !== originalCastWorldTime) continue;
      matches.push({ targetActor, effect, flags });
    }
  }

  matches.sort((a, b) => Number(Boolean(b.flags?.isOriginAE)) - Number(Boolean(a.flags?.isOriginAE)));
  return matches;
}

/**
 * Validate that all upkeep targets are still within the spell's max range.
 *
 * @param {{ casterActor: Actor, casterTokenUuid?: string|null, spell: Item|null, matches: Array }} params
 * @returns {Promise<{ ok: boolean, failures: Array<{ actorName: string, distance: number, maxRange: number }> }>}
 */
async function _validateUpkeepRange({ casterActor, casterTokenUuid = null, spell, matches }) {
  const rangeType = getSpellRangeType(spell);
  if (rangeType === "none") return { ok: true, failures: [] };

  const maxRange = getSpellMaxRangeMeters(spell);
  if (!Number.isFinite(maxRange) || maxRange <= 0) return { ok: true, failures: [] };

  const scene = canvas?.scene ?? null;
  if (!scene) return { ok: true, failures: [] };

  const casterToken = _getTokenByUuidOnScene(casterTokenUuid, scene) ?? _getTokenForActorOnScene(casterActor, scene);
  if (!casterToken) return { ok: true, failures: [] };

  const failures = [];
  for (const m of matches) {
    const targetToken = _getTokenForActorOnScene(m.targetActor, scene);
    if (!targetToken) continue;

    const d = _measureDistanceMeters(casterToken, targetToken);
    if (Number.isFinite(d) && d > maxRange) {
      failures.push({ actorName: m.targetActor.name, distance: d, maxRange });
    }
  }

  if (failures.length) return { ok: false, failures };
  return { ok: true, failures: [] };
}

/**
 * Confirm upkeep from a grouped upkeep prompt message.
 * @param {ChatMessage} message
 */
export async function handleUpkeepGroupConfirm(message) {
  const data = message?.flags?.[_FLAG_NS]?.upkeepGroup;
  if (!data) return;
  if (data.resolved === true || data.resolving === true) return;

  const casterActor = resolveActorFromUuidSync(data.casterUuid);

  if (!casterActor) {
    console.error("UESRPG | upkeep-workflow | Could not resolve caster actor", data.casterUuid);
    ui.notifications?.error?.("Could not find caster actor.");
    return;
  }

  const matches = await _collectCurrentEffectsForGroup(data.groupKey);
  if (!matches.length) {
    await _markUpkeepMessageResolved(message, {
      action: "cancel",
      summary: "Nothing remained to upkeep."
    });
    ui.notifications?.info?.("Nothing to upkeep: the effect(s) already ended.");
    return;
  }
  const linkedMatches = matches.filter((m) => !Boolean(m.flags?.isOriginAE));
  const originMatch = matches.find((m) => Boolean(m.flags?.isOriginAE)) ?? null;
  if (!(await _markUpkeepMessageResolving(message, "confirm"))) return;

  // Best-effort resolve spell (synchronous — items are always loaded)
  const spellDoc = _fromUuidSync(_str(data.spellUuid));
  const spell = (spellDoc?.documentName === "Item") ? spellDoc : null;
  const originAE = originMatch?.effect ?? findOriginAEByGroupKey(data.groupKey);
  const originCastSource = originAE?.flags?.[_FLAG_NS]?.castSource ?? null;
  const isEnchantmentOrigin = originCastSource?.type === "enchantment";
  const enchantmentCostMode = String(originCastSource?.costMode ?? "soul").trim().toLowerCase();
  const enchantmentSourceLane = String(originCastSource?.sourceLane ?? "workshop").trim().toLowerCase();

  // RAW: if no listed duration, cannot upkeep if a different spell was cast since original cast
  const anyNoListed = linkedMatches.some(m => Boolean(m.flags?.noListedDuration));
  if (anyNoListed) {
    const originalCast = _num(data.originalCastWorldTime, 0);
    const lastCast = _num(casterActor.getFlag(_FLAG_NS, "lastSpellCastWorldTime"), 0);
    const lastSpellUuid = casterActor.getFlag(_FLAG_NS, "lastSpellCastSpellUuid");
    const spellUuid = _str(data.spellUuid);

    if (lastCast > originalCast && lastSpellUuid && _str(lastSpellUuid) !== spellUuid) {
      ui.notifications?.warn?.("Cannot upkeep this spell: you have cast a different spell since the original cast.");
      await _clearUpkeepMessageResolving(message);
      return;
    }
  }

  // RAW: requirements (range) must still be met.
  if (spell) {
    const rangeCheck = await _validateUpkeepRange({
      casterActor,
      casterTokenUuid: _str(data.casterTokenUuid),
      spell,
      matches: linkedMatches
    });
    if (!rangeCheck.ok) {
      const parts = rangeCheck.failures
        .map(f => `${f.actorName} (${Math.round(f.distance * 10) / 10}m > ${f.maxRange}m)`)
        .join(", ");
      ui.notifications?.warn?.(`Cannot upkeep: out of range: ${parts}.`);
      await _clearUpkeepMessageResolving(message);
      return;
    }
  }

  // Spend upkeep cost once:
  // - enchantment-origin casts spend Soul Energy from enchanted item pool
  // - standard casts use existing Magicka/AP logic
  const upkeepCost = _num(data.upkeepCost, 0);
  const currentMP = _num(casterActor.system?.magicka?.value, 0);
  let enchantmentUpkeepHandled = false;

  if (isEnchantmentOrigin && enchantmentCostMode === "soul") {
    enchantmentUpkeepHandled = true;
    const itemUuid = _str(originCastSource.enchantedItemUuid);
    const slotId = _str(originCastSource.enchantSpellSlotId);
    const itemDoc = _fromUuidSync(itemUuid);
    const enchantedItem = (itemDoc?.documentName === "Item") ? itemDoc : null;

    if (!enchantedItem) {
      ui.notifications?.warn?.("Upkeep failed: enchanted item no longer exists. Spell ends.");
      await _clearUpkeepMessageResolving(message);
      if (originAE) await cancelOriginAEUpkeep(originAE);
      return;
    }

    const pool = enchantmentSourceLane === "extension"
      ? (enchantedItem.flags?.[_FLAG_NS]?.itemSpellcasting?.pool ?? {})
      : (enchantedItem.flags?.[_FLAG_NS]?.enchanting?.cast?.pool ?? {});
    const poolValue = enchantmentSourceLane === "extension"
      ? _num(enchantedItem.system?.charge?.value, _num(pool.value, 0))
      : _num(pool.value, 0);
    const poolMax = enchantmentSourceLane === "extension"
      ? _num(enchantedItem.system?.charge?.max, _num(pool.max, 0))
      : _num(pool.max, 0);
    if (poolValue < upkeepCost) {
      ui.notifications?.warn?.(`Upkeep failed: not enough Soul Energy (${poolValue}/${upkeepCost}). Spell ends.`);
      await _clearUpkeepMessageResolving(message);
      if (originAE) await cancelOriginAEUpkeep(originAE);
      return;
    }

    const nextPool = Math.max(0, poolValue - upkeepCost);
    try {
      const upkeepItemUpdate = {
        [enchantmentSourceLane === "extension"
          ? `flags.${_FLAG_NS}.itemSpellcasting.pool.value`
          : `flags.${_FLAG_NS}.enchanting.cast.pool.value`]: nextPool,
        "system.charge.value": nextPool
      };
      if (slotId) {
        upkeepItemUpdate[enchantmentSourceLane === "extension"
          ? `flags.${_FLAG_NS}.itemSpellcasting.activeUpkeepSlotId`
          : `flags.${_FLAG_NS}.enchanting.cast.activeUpkeepSpellId`] = slotId;
      }
      const ok = await requestUpdateDocument(enchantedItem, upkeepItemUpdate);
      if (!ok) throw new Error("authority update rejected");
      ui.notifications?.info?.(`Upkeep paid from ${enchantedItem.name}: Soul Energy ${nextPool}/${poolMax}.`);
    } catch (err) {
      console.error("UESRPG | upkeep-workflow | Failed to deduct Soul Energy upkeep", err);
      ui.notifications?.warn?.("Upkeep failed to spend Soul Energy. Spell ends.");
      await _clearUpkeepMessageResolving(message);
      if (originAE) await cancelOriginAEUpkeep(originAE);
      return;
    }
  } else if (isEnchantmentOrigin && enchantmentCostMode === "none") {
    enchantmentUpkeepHandled = true;
  }

  // ── Free Upkeep if Buffer Remains ─────────────────────────────────────
  // Check if the spell has the freeUpkeepIfRemains flag and evaluate buffer status.
  // If ANY buffer HP remains on ANY target, upkeep is free and buffers refresh fully.
  // If ALL buffers are depleted (0), upkeep fails and the spell must be recast.
  const freeUpkeepIfBufferRemains = Boolean(spell?.system?.buffer?.freeUpkeepIfRemains);
  let bufferUpkeepMode = null; // null | "free" | "depleted"

  if (freeUpkeepIfBufferRemains && spell?.system?.hasBuffer && spell?.system?.buffer?.type && spell.system.buffer.type !== "none") {
    const bufferType = spell.system.buffer.type;
    const bufferPath = `system.buffers.${bufferType}`;

    // Check all target actors for buffer status
    const bufferStatuses = linkedMatches.map(m => {
      const currentBuffer = _num(m.targetActor.system?.buffers?.[bufferType], 0);
      return { actor: m.targetActor, current: currentBuffer };
    });

    const anyRemaining = bufferStatuses.some(s => s.current > 0);
    const allDepleted = bufferStatuses.every(s => s.current === 0);

    if (allDepleted) {
      bufferUpkeepMode = "depleted";
      ui.notifications?.warn?.(`Cannot upkeep ${data.spellName}: All barrier HP is depleted. The spell must be recast.`);
      await _clearUpkeepMessageResolving(message);
      return;
    } else if (anyRemaining) {
      bufferUpkeepMode = "free";
      ui.notifications?.info?.(`${data.spellName} barrier remains active — upkeep costs 0 MP and restores barrier to full.`);
    }
  }

  // Living Armory (Chapter 4): Conjurers with this talent can pay 1 AP instead of MP
  // for upkeeping Conjure Weapon / Conjure Armour effects that target only the caster.
  const spellName = _str(data.spellName).toLowerCase();
  const isConjureEquipment = spellName.includes("conjure weapon") || spellName.includes("conjure armour") ||
    spellName.includes("conjure armor") || spellName.includes("bound weapon") || spellName.includes("bound armour") ||
    spellName.includes("bound armor");
  const hasLivingArmory = getActorCapabilityFlag(casterActor, "flags.uesrpg-3ev4.magic.upkeepViaAP") || hasTalent(casterActor, "livingarmory");
  const allTargetsSelf = linkedMatches.every(m => m.targetActor.id === casterActor.id);
  const canUseLivingArmory = isConjureEquipment && hasLivingArmory && allTargetsSelf && !isEnchantmentOrigin;

  let useLivingArmory = false;
  if (canUseLivingArmory) {
    const enforceAP = isActorInStartedCombatEncounter(casterActor);
    const currentAP = _num(casterActor.system?.action_points?.value, 0);
    if (!enforceAP || currentAP >= 1) {
      // Prefer AP over MP when Living Armory applies and AP is available
      useLivingArmory = true;
    }
  }

  // Skip MP/AP cost if buffer upkeep is free
  if (enchantmentUpkeepHandled) {
    // no-op: already paid from Soul Energy pool
  } else if (bufferUpkeepMode === "free") {
    // Free upkeep — no cost
  } else if (useLivingArmory) {
    const enforceAP = isActorInStartedCombatEncounter(casterActor);
    const currentAP = _num(casterActor.system?.action_points?.value, 0);
    const newAP = currentAP - 1;
    try {
      if (enforceAP) await requestUpdateDocument(casterActor, { "system.action_points.value": newAP });
      ui.notifications?.info?.(`Living Armory: ${enforceAP ? "Paid 1 AP" : "Used outside combat"} (instead of ${upkeepCost} MP) to upkeep ${data.spellName}.`);
    } catch (err) {
      console.error("UESRPG | upkeep-workflow | Failed to deduct AP (Living Armory)", err);
      ui.notifications?.error?.("Failed to deduct AP. See console.");
      await _clearUpkeepMessageResolving(message);
      return;
    }
  } else {
    if (upkeepCost > currentMP) {
      ui.notifications?.warn?.("Not enough Magicka to upkeep this spell.");
      await _clearUpkeepMessageResolving(message);
      return;
    }

    const newMagicka = currentMP - upkeepCost;

    try {
      await requestUpdateDocument(casterActor, { "system.magicka.value": newMagicka });
    } catch (err) {
      console.error("UESRPG | upkeep-workflow | Failed to update magicka", err);
      ui.notifications?.error?.("Failed to deduct magicka. See console.");
      await _clearUpkeepMessageResolving(message);
      return;
    }
  }

  // RAW: If a spell has the Attack attribute, then upkeeping the spell counts toward the
  // maximum attacks per round limit.
  if (game.combat && spell) {
    const cls = classifySpellForRouting(spell);
    if (cls.isAttack) {
      try {
        const trackerContext = {
          combatantId: resolveCombatantForActor(game?.combat ?? null, casterActor, {
            tokenUuid: _str(data.casterTokenUuid) || casterActor?.token?.document?.uuid || casterActor?.token?.uuid || null,
            actorUuid: casterActor?.uuid ?? null,
            combatId: game?.combat?.id ?? null
          })?.id ?? null,
          tokenUuid: _str(data.casterTokenUuid) || casterActor?.token?.document?.uuid || null,
          source: "magic-upkeep",
          sourceTag: "magic-upkeep",
          attackMode: "magic",
          phase: "upkeep-increment"
        };
        await AttackTracker.incrementAttacks(casterActor, trackerContext);
        const warning = AttackTracker.getLimitWarning(casterActor, {}, trackerContext);
        if (warning) ui.notifications?.warn?.(warning);
      } catch (err) {
        console.error("UESRPG | upkeep-workflow | Failed to increment attack counter for upkeep", err);
      }
    }
  }

  // Refresh duration by resetting start markers on all currently-matched effects.
  // Buffer / barrier restoration is merged into the same pass to avoid iterating twice.
  const nowTime = _nowWorldTime();

  const effectUpdatesByActor = new Map();
  const actorBufferUpdates = new Map();
  const refreshedAnchor = buildSpellExpirationAnchor({
    casterActor,
    casterTokenUuid: _str(data.casterTokenUuid) || originCastSource?.casterTokenUuid || linkedMatches[0]?.flags?.expirationAnchor?.casterTokenUuid || null,
    combat: game?.combat ?? null,
    existing: linkedMatches[0]?.flags?.expirationAnchor ?? originMatch?.flags?.expirationAnchor ?? null
  });
  _anchorDebug("Normalized upkeep refresh anchor", {
    groupKey: data.groupKey,
    spell: data.spellName,
    caster: casterActor?.name ?? null,
    round: game?.combat?.round ?? null,
    turn: game?.combat?.turn ?? null,
    anchor: refreshedAnchor
  });
  for (const m of linkedMatches) {
    const live = _getActorEffect(m.targetActor, m.effect?.id);
    if (!live) continue;
    const canonicalDuration = m.flags?.[SPELL_EFFECT_DURATION_FLAG_KEY] ?? _getNominalDuration(live, m.flags);
    const durationExtension = m.flags?.upkeepPendingNativeExtension
      ? {}
      : (extendEffectDurationByCanonicalPeriod(live, canonicalDuration) ?? {});

    // ── Duration refresh ─────────────────────────────────────────────────
    const updates = {
      "disabled": false,
      ...durationExtension
    };
    _clearSuppressionFlags(live, updates);

    // Clear prompt de-dup and expiration flags so the next expiry cycle prompts cleanly.
    updates[`flags.${_FLAG_NS}.upkeepPromptedEndTime`] = null;
    updates[`flags.${_FLAG_NS}.upkeepPromptedCombatRound`] = null;
    updates[`flags.${_FLAG_NS}.upkeepPromptedCombatTurn`] = null;
    updates[`flags.${_FLAG_NS}.upkeepPromptMessageId`] = null;
    updates[`flags.${_FLAG_NS}.upkeepPromptSignature`] = null;
    updates[`flags.${_FLAG_NS}.upkeepBoundaryMode`] = null;
    updates[`flags.${_FLAG_NS}.upkeepBoundaryEndTime`] = null;
    updates[`flags.${_FLAG_NS}.upkeepBoundaryEndRound`] = null;
    updates[`flags.${_FLAG_NS}.upkeepBoundaryEndTurn`] = null;
    updates[`flags.${_FLAG_NS}.expiredAtWorldTime`] = null;
    updates[`flags.${_FLAG_NS}.expiredAtCombatRound`] = null;
    updates[`flags.${_FLAG_NS}.upkeepAwaiting`] = null;
    updates[`flags.${_FLAG_NS}.upkeepPendingNativeExtension`] = null;
    updates[`flags.${_FLAG_NS}.upkeepPendingGraceExtension`] = null;
    updates[`flags.${_FLAG_NS}.durationStartTime`] = nowTime;
    updates[`flags.${_FLAG_NS}.durationStartRound`] = null;
    updates[`flags.${_FLAG_NS}.durationStartTurn`] = null;
    updates[`flags.${_FLAG_NS}.expirationAnchor`] = buildSpellExpirationAnchor({
      casterActor,
      casterTokenUuid: m.flags?.expirationAnchor?.casterTokenUuid ?? refreshedAnchor?.casterTokenUuid ?? null,
      combat: game?.combat ?? null,
      existing: m.flags?.expirationAnchor ?? refreshedAnchor
    });

    const actorUpdates = effectUpdatesByActor.get(m.targetActor) ?? [];
    actorUpdates.push({ _id: live.id, ...updates });
    effectUpdatesByActor.set(m.targetActor, actorUpdates);

    // ── Buffer / Barrier restoration ─────────────────────────────────────
    // If this effect applied a buffer, restore it to the original cast-time value.
    const effectFlags = m.effect?.flags?.[_FLAG_NS];
    if (effectFlags?.bufferApplied) {
      const bufferType = effectFlags.bufferType;
      const originalValue = _num(effectFlags.bufferOriginalValue, 0);
      if (bufferType && originalValue > 0) {
        const currentBuffer = _num(m.targetActor.system?.buffers?.[bufferType], 0);
        if (currentBuffer < originalValue) {
          const pendingActorUpdate = actorBufferUpdates.get(m.targetActor) ?? {};
          pendingActorUpdate[`system.buffers.${bufferType}`] = Math.max(
            _num(pendingActorUpdate[`system.buffers.${bufferType}`], currentBuffer),
            originalValue
          );
          actorBufferUpdates.set(m.targetActor, pendingActorUpdate);
        }
      }
    }
  }

  for (const [actor, updates] of effectUpdatesByActor.entries()) {
    if (!updates.length) continue;
    const ok = await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", updates);
    if (!ok) {
      for (const update of updates) {
        const live = _getActorEffect(actor, update._id);
        if (!live) continue;
        const fallbackUpdate = { ...update };
        delete fallbackUpdate._id;
        await _safeUpdateEffect(live, fallbackUpdate);
      }
    }
  }

  const actorBatchRows = [];
  for (const [actor, updateData] of actorBufferUpdates.entries()) {
    if (!actor || !Object.keys(updateData).length) continue;
    actorBatchRows.push({ docOrUuid: actor, updateData });
  }
  if (actorBatchRows.length) {
    const batchResult = await requestBatchUpdateDocuments(actorBatchRows);
    if (batchResult?.ok !== true) {
      const failedUuidSet = new Set((batchResult?.failures ?? []).map((f) => String(f?.uuid ?? "")).filter(Boolean));
      for (const row of actorBatchRows) {
        const actor = row.docOrUuid;
        const uuid = String(actor?.uuid ?? "");
        if (failedUuidSet.size && !failedUuidSet.has(uuid)) continue;
        try {
          await requestUpdateDocument(actor, row.updateData);
        } catch (err) {
          console.warn("UESRPG | upkeep-workflow | Failed to restore buffer on upkeep", err);
        }
      }
    }
  }

  // Sync Origin AE upkeep contract on the caster (if one exists)
  try {
    if (originAE) {
      await refreshOriginAEUpkeep(originAE, { costPaid: upkeepCost });
    }
  } catch (err) {
    console.warn("UESRPG | upkeep-workflow | Failed to sync Origin AE upkeep", err);
  }

  await _markUpkeepMessageResolved(message, {
    action: "confirm",
    summary: `${data.spellName} was refreshed.`
  });

  ui.notifications?.info?.(`${data.spellName} upkept.`);
}

/**
 * Cancel upkeep from a grouped upkeep prompt message (end the effect(s) now).
 * @param {ChatMessage} message
 */
export async function handleUpkeepGroupCancel(message) {
  const data = message?.flags?.[_FLAG_NS]?.upkeepGroup;
  if (!data) return;
  if (data.resolved === true || data.resolving === true) return;

  const matches = await _collectCurrentEffectsForGroup(data.groupKey);
  if (!matches.length) {
    await _markUpkeepMessageResolved(message, {
      action: "cancel",
      summary: "The spell had already ended."
    });
    return;
  }
  if (!(await _markUpkeepMessageResolving(message, "cancel"))) return;
  const linkedMatches = matches.filter((m) => !Boolean(m.flags?.isOriginAE));

  const byActor = new Map();
  for (const m of linkedMatches) {
    const actor = m.targetActor;
    if (!actor) continue;
    const eid = m.effect?.id;
    if (!eid) continue;
    const arr = byActor.get(actor) ?? [];
    arr.push(eid);
    byActor.set(actor, arr);
  }

  for (const [actor, ids] of byActor.entries()) {
    const liveIds = ids.filter(id => _getActorEffect(actor, id));
    if (!liveIds.length) continue;

    // Skip individual flag-clears — the effects are about to be deleted.
    const deleted = game.user?.isGM
      ? (await actor.deleteEmbeddedDocuments("ActiveEffect", liveIds, { uesrpgExpirationSweep: true }), true)
      : await safeDeleteEmbeddedDocuments(actor, "ActiveEffect", liveIds, {
          context: "UESRPG | upkeep-workflow",
          logUnexpected: true,
          deleteOptions: { uesrpgExpirationSweep: true }
        });
    if (!deleted && liveIds.some((id) => _getActorEffect(actor, id))) {
      console.error("UESRPG | upkeep-workflow | Failed to delete upkeep effects", {
        actor: actor?.uuid ?? null,
        ids: liveIds
      });
    }
  }

  // Cancel the Origin AE on the caster so the cascade teardown fires.
  try {
    const originAE = findOriginAEByGroupKey(data.groupKey);
    if (originAE) {
      await cancelOriginAEUpkeep(originAE);
    }
  } catch (err) {
    console.warn("UESRPG | upkeep-workflow | Failed to cancel Origin AE on upkeep decline", err);
  }

  await _markUpkeepMessageResolved(message, {
    action: "cancel",
    summary: `${data.spellName} ended.`
  });

  ui.notifications?.info?.(`${data.spellName} ended.`);
}
