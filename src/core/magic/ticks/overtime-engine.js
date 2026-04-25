/**
 * @module overtime-engine
 * @file src/core/magic/overtime-engine.js
 *
 * OverTime Effects Engine for UESRPG 3ev4.
 *
 * Provides periodic payload delivery (damage, healing, saves, self-termination) for
 * Active Effects that carry an OverTime configuration.  Integrates with the spell
 * tick engine ({@link module:spell-tick-engine}) for GM-authoritative, exactly-once
 * tick processing across combat and world-time contexts.
 *
 * ## Storage Model (midi-qol / DAE inspired)
 *
 * **Immutable config** — lives as an AE `changes[]` entry:
 * ```
 * {
 *   key:   "flags.uesrpg-3ev4.OverTime",           // or ".OverTime.<id>"
 *   mode:  "custom",
 *   value: JSON.stringify({ trigger, cadenceEvery, cadenceUnit, payloadType, … })
 * }
 * ```
 * Using `changes[]` ensures the config survives document cloning, transfer, and all
 * Foundry CRUD operations reliably.
 *
 * **Mutable tick state** — stored separately at `flags.uesrpg-3ev4.overTimeState`:
 * ```
 * { lastTickRound, lastTickTurn, lastTickWorldTime, tickCount }
 * ```
 *
 * ## Performance
 *
 * An internal **effect index** caches which actors carry OverTime effects.  The index
 * is invalidated (dirty-flagged) on any ActiveEffect create / update / delete and
 * lazily rebuilt on the next tick.  This avoids the O(actors × effects) full-scan on
 * every tick and instead yields O(indexed_effects) per tick.
 *
 * ## Upkeep Integration
 *
 * Effects with `flags.uesrpg-3ev4.upkeepAwaiting === true` (set by spell-effect-expiration
 * when a duration boundary is reached) are **skipped** during collection.  This ensures
 * OverTime payloads do not fire while the upkeep decision is pending.  Once upkeep is
 * confirmed the flag is cleared and the effect resumes ticking.
 *
 * Target: Foundry VTT v14 runtime
 */

import { registerSpellTickHandler } from "./spell-tick-engine.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { _num, _numOrNull, _str, createDebugLogger, isDebugEnabled } from "../_primitives.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../../utils/perf-tracker.js";
import { applyDamage, applyHealing } from "../../combat/damage/apply.js";
import { DAMAGE_TYPES } from "../../combat/damage/types.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { resolveActorFromUuidSync } from "../../../utils/uuid-cache.js";
import { isMissingDocError as _isMissingDocError, safeDeleteEmbeddedDocument } from "../../../utils/ae-helpers.js";
import { buildEffectChange, getEffectChanges } from "../../../utils/compat.js";
import {
  doesCadenceMatch,
  normalizeOverTimeCadence,
  OVERTIME_VALID_TRIGGERS,
} from "./overtime-cadence.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const _FLAG_NS = FLAG_SCOPE;

/** The AE changes key prefix used for OverTime configuration. */
export const OVERTIME_CHANGE_KEY = `flags.${_FLAG_NS}.OverTime`;

/** @type {ReadonlySet<string>} Valid trigger values. */
const VALID_TRIGGERS = OVERTIME_VALID_TRIGGERS;

/** @type {ReadonlySet<string>} Payload types that map to the heal executor. */
const HEAL_TYPES = Object.freeze(new Set(["heal", "healing"]));

// ─── Utility Helpers ─────────────────────────────────────────────────────────

const _debug = createDebugLogger("overTimeDebug", "[UESRPG][OverTime]");

function _warn(/** @type {...any} */ ...args) {
  try { console.warn("[UESRPG][OverTime][WARN]", ...args); } catch (_e) { /* no-op */ }
}

function _error(/** @type {...any} */ ...args) {
  try { console.error("[UESRPG][OverTime][ERROR]", ...args); } catch (_e) { /* no-op */ }
}

function _trace(debug, event, data = {}) {
  if (!debug) return;
  _debug(event, data);
}

function _provenanceBase(actor, effect, config, cadence, ctx) {
  return {
    actor: actor?.name ?? null,
    actorUuid: actor?.uuid ?? null,
    effect: effect?.name ?? null,
    effectId: effect?.id ?? null,
    trigger: ctx?.trigger ?? cadence?.trigger ?? config?.trigger ?? null,
    cadenceKey: cadence?.key ?? null,
    payloadType: config?.payloadType ?? null,
    tickCount: _num(effect ? _getTickState(effect).tickCount : 0, 0),
    maxTicks: _numOrNull(config?.maxTicks, null),
  };
}

/**
 * Check whether an effect is still present in its parent's embedded collection.
 * Used to guard against writing to effects deleted during payload execution.
 *
 * @param {Actor}        parent — The actor that owns the effect.
 * @param {ActiveEffect} effect — The effect to check.
 * @returns {boolean} `true` if the effect still exists.
 */
function _isEffectAlive(parent, effect) {
  if (!parent?.effects || !effect?.id) return false;
  return parent.effects.has(effect.id);
}

async function _deleteEffectIfAlive(parent, effect, { context = "delete" } = {}) {
  if (!parent || !effect?.id) return false;
  if (!_isEffectAlive(parent, effect)) {
    _debug(`${context}: already gone`, {
      effect: effect?.name ?? null,
      parent: parent?.name ?? null
    });
    return false;
  }

  try {
    const deleted = await safeDeleteEmbeddedDocument(parent, "ActiveEffect", effect.id, {
      context: `UESRPG | OverTime | ${context}`,
      logUnexpected: false
    });
    if (deleted) {
      _indexDirty = true;
      _debug("effectDeleted", {
        context,
        effect: effect?.name ?? null,
        effectId: effect?.id ?? null,
        parent: parent?.name ?? null,
        parentUuid: parent?.uuid ?? null
      });
      return true;
    }
  } catch (err) {
    if (!_isMissingDocError(err) && _isEffectAlive(parent, effect)) {
      _error(`${context}: Failed to delete effect "${effect?.name}"`, err);
      return false;
    }
  }

  if (!_isEffectAlive(parent, effect)) {
    _debug(`${context}: soft-suppressed missing document`, {
      effect: effect?.name ?? null,
      parent: parent?.name ?? null
    });
    return false;
  }

  _error(`${context}: Failed to delete effect "${effect?.name}"`, {
    effectId: effect?.id ?? null,
    parentUuid: parent?.uuid ?? null
  });
  return false;
}

// ─── Effect Index (Cached Actor → Effect Lookup) ─────────────────────────────
//
// The index tracks { actorUuid → Map<effectId, configs[]> } for all actors that
// carry at least one OverTime-configured effect.  It is lazily rebuilt when
// `_indexDirty` is true (set by AE lifecycle hooks).  This turns the per-tick
// collection phase from O(all_actors × all_effects) into O(indexed_entries).

/**
 * @typedef {object} IndexEntry
 * @property {string} actorUuid
 * @property {string} effectId
 * @property {object[]} configs  — parsed OverTime configuration objects (immutable)
 */

/** @type {Map<string, Map<string, object[]>>} actorUuid → Map<effectId, configs[]> */
const _effectIndex = new Map();

/** @type {boolean} Set true on AE create/update/delete to trigger lazy rebuild. */
let _indexDirty = true;

/** @type {boolean} Whether AE lifecycle hooks have been installed. */
let _indexHooksInstalled = false;

/**
 * Install AE lifecycle hooks that mark the index dirty on any mutation.
 * Called once during engine initialization.
 */
function _installIndexHooks() {
  if (_indexHooksInstalled) return;
  _indexHooksInstalled = true;

  const markDirty = () => { _indexDirty = true; };
  Hooks.on("createActiveEffect", markDirty);
  Hooks.on("updateActiveEffect", markDirty);
  Hooks.on("deleteActiveEffect", markDirty);

  // Also dirty on scene/token changes that affect synthetic actors
  Hooks.on("canvasReady", markDirty);
}

/**
 * Rebuild the effect index by scanning all world actors and synthetic token actors.
 * Only called when `_indexDirty` is true.
 */
function _rebuildIndex() {
  _effectIndex.clear();

  /**
   * Index one actor's effects.
   * @param {Actor} actor
   */
  const indexActor = (actor) => {
    if (!actor?.effects?.size) return;
    const uuid = actor.uuid;

    for (const ef of actor.effects) {
      const configs = _getAllOverTimeConfigs(ef);
      if (!configs.length) continue;
      const entries = _buildRuntimeEntries(configs);
      if (!entries.length) continue;

      let actorMap = _effectIndex.get(uuid);
      if (!actorMap) {
        actorMap = new Map();
        _effectIndex.set(uuid, actorMap);
      }
      actorMap.set(ef.id, entries);
    }
  };

  // World actors
  for (const actor of (game.actors?.contents ?? [])) {
    indexActor(actor);
  }

  // Synthetic (unlinked) token actors — their effects are NOT on the world actor
  if (canvas?.tokens?.placeables) {
    for (const token of canvas.tokens.placeables) {
      if (token.document?.actorLink) continue; // Linked — already covered
      if (token.actor) indexActor(token.actor);
    }
  }

  _indexDirty = false;
}

/**
 * Ensure the index is current.  No-op if already clean.
 */
function _ensureIndex() {
  if (!_indexDirty) return;
  const _t0 = isPerfEnabled() ? monoMs() : 0;
  _rebuildIndex();
  if (isPerfEnabled()) {
    perfRecord({
      event: "overtime.ensureIndex",
      wasRebuild: true,
      indexedActors: _effectIndex.size,
      durationMs: monoMs() - _t0,
    });
  }
}

// ─── Schema Helpers ──────────────────────────────────────────────────────────

/**
 * Build an OverTime `changes[]` entry for inclusion in an AE's changes array.
 *
 * @param {object} config — Flat OverTime configuration keys.
 * @param {string}  [config.trigger="turnStart"]
 * @param {number}  [config.cadenceEvery=1]
 * @param {string}  [config.cadenceUnit="rounds"]
 * @param {string}  [config.payloadType="damage"]
 * @param {string}  [config.formula="1d6"]
 * @param {string}  [config.damageType="fire"]
 * @param {string}  [config.saveKey=""]
 * @param {number}  [config.saveTN=0]
 * @param {string}  [config.saveSuccess="endEffect"]
 * @param {string}  [config.saveFailure="damage"]
 * @param {number|null} [config.maxTicks=null]
 * @param {string}  [config.label=""]
 * @param {boolean} [config.chatLog=true]
 * @returns {{ key: string, mode: string, value: string, priority: number }}
 */
export function buildOverTimeChange(config = {}) {
  const normalized = {
    trigger:      _str(config.trigger || "turnStart"),
    cadenceEvery: _num(config.cadenceEvery, 1),
    cadenceUnit:  _str(config.cadenceUnit || "rounds"),
    payloadType:  _str(config.payloadType || "damage"),
    formula:      _str(config.formula || "1d6"),
    damageType:   _str(config.damageType || "fire"),
    saveKey:      _str(config.saveKey || ""),
    saveTN:       _num(config.saveTN, 0),
    saveSuccess:  _str(config.saveSuccess || "endEffect"),
    saveFailure:  _str(config.saveFailure || "damage"),
    maxTicks:     _numOrNull(config.maxTicks, null),
    label:        _str(config.label || ""),
    chatLog:      config.chatLog !== false
  };

  return buildEffectChange({
    key: OVERTIME_CHANGE_KEY,
    type: "custom",
    value: JSON.stringify(normalized),
    priority: 20
  });
}

/**
 * Create a default OverTime configuration object with optional overrides.
 *
 * @param {object} [overrides]
 * @returns {object} Complete overTime config object.
 */
export function createOverTimeConfig(overrides = {}) {
  return foundry.utils.mergeObject({
    trigger: "turnStart",
    cadenceEvery: 1,
    cadenceUnit: "rounds",
    payloadType: "damage",
    formula: "1d6",
    damageType: "fire",
    saveKey: "",
    saveTN: 0,
    saveSuccess: "endEffect",
    saveFailure: "damage",
    maxTicks: null,
    label: "OverTime Effect",
    chatLog: true
  }, overrides, { inplace: false });
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Extract OverTime configurations from an AE's `changes[]` array.
 * Looks for entries whose key starts with {@link OVERTIME_CHANGE_KEY}.
 *
 * @param {ActiveEffect} effect
 * @returns {object[]} Parsed OverTime config objects (may be multiple if stacked).
 */
function _parseOverTimeChanges(effect) {
  const changes = getEffectChanges(effect);
  if (!changes?.length) return [];

  /** @type {object[]} */
  const results = [];

  for (let i = 0, len = changes.length; i < len; i++) {
    const c = changes[i];
    if (!c.key || !c.key.startsWith(OVERTIME_CHANGE_KEY)) continue;

    try {
      const parsed = JSON.parse(c.value);
      if (parsed && typeof parsed === "object") results.push(parsed);
    } catch (_e) {
      _warn(`Failed to parse OverTime JSON on "${effect?.name}":`, c.value);
    }
  }

  return results;
}

/**
 * Legacy fallback: extract OverTime config from deep-nested flags.
 * Supports old effects created before the changes-key migration.
 *
 * @param {ActiveEffect} effect
 * @returns {object|null}
 */
function _parseLegacyFlags(effect) {
  const ot = effect?.flags?.[_FLAG_NS]?.overTime;
  if (!ot || typeof ot !== "object") return null;

  return {
    trigger:      _str(ot.trigger || "turnStart"),
    cadenceEvery: _num(ot.cadence?.every ?? ot.cadenceEvery, 1),
    cadenceUnit:  _str(ot.cadence?.unit ?? ot.cadenceUnit ?? "rounds"),
    payloadType:  _str(ot.payload?.type ?? ot.payloadType ?? "damage"),
    formula:      _str(ot.payload?.formula ?? ot.formula ?? "1d6"),
    damageType:   _str(ot.payload?.damageType ?? ot.damageType ?? "fire"),
    saveKey:      _str(ot.payload?.saveKey ?? ot.saveKey ?? ""),
    saveTN:       _num(ot.payload?.saveTN ?? ot.saveTN, 0),
    saveSuccess:  _str(ot.payload?.saveSuccess ?? ot.saveSuccess ?? "endEffect"),
    saveFailure:  _str(ot.payload?.saveFailure ?? ot.saveFailure ?? "damage"),
    maxTicks:     _numOrNull(ot.state?.maxTicks ?? ot.maxTicks, null),
    label:        _str(ot.label || ""),
    chatLog:      ot.chatLog !== false
  };
}

/**
 * Get all OverTime configs from an effect (changes-key first, then legacy flags fallback).
 *
 * @param {ActiveEffect} effect
 * @returns {object[]}
 */
function _getAllOverTimeConfigs(effect) {
  const fromChanges = _parseOverTimeChanges(effect);
  if (fromChanges.length) return fromChanges;

  const fromFlags = _parseLegacyFlags(effect);
  return fromFlags ? [fromFlags] : [];
}

// ─── Tick State ──────────────────────────────────────────────────────────────

/**
 * Read mutable tick state from the effect's flags.
 *
 * @param {ActiveEffect} effect
 * @returns {{ lastTickRound?: number, lastTickTurn?: number, lastTickWorldTime?: number, tickCount?: number }}
 */
function _buildRuntimeEntries(configs) {
  const entries = [];
  for (const config of configs ?? []) {
    if (!config || typeof config !== "object") continue;
    entries.push({
      config,
      cadence: normalizeOverTimeCadence(config)
    });
  }
  return entries;
}

function _getTickState(effect) {
  const st = effect?.flags?.[_FLAG_NS]?.overTimeState;
  if (st && typeof st === "object") return st;
  // Legacy location
  const legacyState = effect?.flags?.[_FLAG_NS]?.overTime?.state;
  if (legacyState && typeof legacyState === "object") return legacyState;
  return {};
}

// ─── Engine Registration ─────────────────────────────────────────────────────

/** @type {boolean} */
let _engineRegistered = false;

/**
 * Initialize the OverTime engine.
 *
 * Registers with the spell tick engine and installs AE lifecycle hooks for
 * the effect index cache.  Must be called **once** during system init
 * (after `initializeSpellTickEngine()`).
 */
export function initializeOverTimeEngine() {
  if (_engineRegistered) return;
  _engineRegistered = true;

  _installIndexHooks();

  registerSpellTickHandler({
    id: "overtime-engine",
    label: "OverTime Effects Engine",
    fn: _onTick,
    fnBoundary: _onBoundaryTick
  });

  _debug("OverTime engine initialized (changes-key approach, indexed collection)");
}

// ─── Tick Handler ────────────────────────────────────────────────────────────

/**
 * Main tick entry point, called by the spell tick engine for each trigger.
 *
 * @param {import("./spell-tick-engine.js").SpellTickContext} ctx
 */
async function _onTick(ctx) {
  if (!game.user?.isGM) return;

  const trigger = ctx.trigger;
  if (!VALID_TRIGGERS.has(trigger)) return;

  const debug = isDebugEnabled("overTimeDebug");
  const _perf = isPerfEnabled();
  const _t0 = _perf ? monoMs() : 0;
  const _combatId = ctx.combat?.id ?? null;

  if (debug) _debug("═══ OverTime Tick START ═══", { trigger, actor: ctx.actor?.name, round: ctx.round, turn: ctx.turn });

  // Ensure index is current (lazy rebuild if dirty)
  _ensureIndex();

  // Fast path: if index is empty, nothing to do
  if (!_effectIndex.size) {
    if (debug) _debug("Collection Phase: No indexed OverTime effects, skipping");
    return;
  }

  const _tCollect = _perf ? monoMs() : 0;
  const candidates = _collectOverTimeEffects(trigger, ctx, debug);
  const _collectMs = _perf ? (monoMs() - _tCollect) : 0;

  if (_perf) {
    perfRecord({
      event: "overtime.collect",
      trigger,
      combatId: _combatId,
      round: ctx.round,
      turn: ctx.turn,
      actorsScanned: _effectIndex.size,
      candidateCount: candidates.length,
      durationMs: _collectMs,
    });
  }

  if (!candidates.length) {
    if (debug) _debug("Collection Phase: No matching effects found");
    return;
  }

  if (debug) _debug(`Processing ${candidates.length} OverTime effect(s) for trigger "${trigger}"`);

  let _processedCount = 0;
  for (const { actor, effect, config, cadence, tickState } of candidates) {
    const _tp = _perf ? monoMs() : 0;
    try {
      // Guard: if a prior candidate's payload deleted this effect, skip it
      if (!_isEffectAlive(actor, effect)) {
        if (debug) _debug(`├─ Skipping: "${effect.name}" on ${actor.name} — deleted by prior payload`);
        continue;
      }
      if (debug) _debug(`├─ Processing: "${effect.name}" on ${actor.name}`);
      await _processEffect(actor, effect, config, cadence, tickState, ctx, debug);
      _processedCount++;
    } catch (err) {
      _error(`Failed to process effect "${effect.name}" on ${actor.name}`, err);
    }
    if (_perf) {
      perfRecord({
        event: "overtime.process",
        trigger,
        combatId: _combatId,
        round: ctx.round,
        actorId: actor?.id ?? null,
        effectName: effect?.name ?? null,
        payloadType: config?.payloadType ?? null,
        durationMs: monoMs() - _tp,
      });
    }
  }

  if (debug) _debug("═══ OverTime Tick END ═══");

  if (_perf) {
    perfRecord({
      event: "overtime.tick",
      trigger,
      combatId: _combatId,
      round: ctx.round,
      turn: ctx.turn,
      candidateCount: candidates.length,
      processedCount: _processedCount,
      durationMs: monoMs() - _t0,
    });
  }
}

// ─── Composite Boundary Handler ──────────────────────────────────────────────

/**
 * Composite boundary tick handler — called once per round-boundary event when
 * `compositeBoundaryTickEnabled` is true.
 *
 * Calls `_ensureIndex()` exactly once for all phases and reuses one
 * boundary-level candidate precompute pass across phases. Phase processing
 * still runs in order and with unchanged trigger semantics.
 *
 * @param {import("./spell-tick-engine.js").SpellTickBoundaryContext} boundaryCtx
 */
async function _onBoundaryTick(boundaryCtx) {
  if (!game.user?.isGM) return;

  const debug = isDebugEnabled("overTimeDebug");
  const _perf = isPerfEnabled();
  const _t0 = _perf ? monoMs() : 0;
  const _combatId = boundaryCtx.combatId ?? null;
  let _boundaryEnsureIndexMs = 0;
  let _boundaryCollectMs = 0;
  let _boundaryCandidateCount = 0;
  let _boundaryPhaseProcessMs = 0;
  const _boundaryUsedSharedCandidates = true;

  if (debug) _debug("═══ OverTime Boundary Tick START ═══", {
    phases: boundaryCtx.phases,
    round: boundaryCtx.currentRound,
    roundChanged: boundaryCtx.roundChanged
  });

  // Ensure index is current — called ONCE for all phases
  const _tEnsure = _perf ? monoMs() : 0;
  _ensureIndex();
  _boundaryEnsureIndexMs = _perf ? (monoMs() - _tEnsure) : 0;

  if (!_effectIndex.size) {
    if (debug) _debug("Boundary: No indexed OverTime effects, skipping all phases");
    return;
  }

  const _tSharedCollect = _perf ? monoMs() : 0;
  const candidateBuckets = _buildBoundaryCandidateBuckets(boundaryCtx, debug);
  _boundaryCollectMs += _perf ? (monoMs() - _tSharedCollect) : 0;

  for (const phase of boundaryCtx.phases) {
    const phaseCtx = boundaryCtx.phaseContexts?.get?.(phase) ?? null;
    if (!phaseCtx) continue;

    const trigger = phaseCtx.trigger;
    if (!VALID_TRIGGERS.has(trigger)) continue;

    const bucketRefs = candidateBuckets.get(trigger) ?? [];
    const _tCollectPhase = _perf ? monoMs() : 0;
    const candidates = _resolveBoundaryCandidates(trigger, phaseCtx, bucketRefs, debug);
    const _collectMs = _perf ? (monoMs() - _tCollectPhase) : 0;
    _boundaryCollectMs += _collectMs;
    _boundaryCandidateCount += candidates.length;

    if (_perf) {
      perfRecord({
        event: "overtime.collect",
        trigger,
        combatId: _combatId,
        round: phaseCtx.round,
        turn: phaseCtx.turn,
        actorsScanned: _effectIndex.size,
        candidateCount: candidates.length,
        durationMs: _collectMs,
        composite: true,
      });
    }

    if (!candidates.length) {
      if (debug) _debug(`Boundary [${phase}]: No matching effects`);
      continue;
    }

    if (debug) _debug(`Boundary [${phase}]: Processing ${candidates.length} effect(s)`);
    const _tPhaseProcess = _perf ? monoMs() : 0;

    for (const { actor, effect, config, cadence, tickState } of candidates) {
      const _tp = _perf ? monoMs() : 0;
      try {
        if (!_isEffectAlive(actor, effect)) {
          if (debug) _debug(`├─ Skipping: "${effect.name}" on ${actor.name} — deleted by prior payload`);
          continue;
        }
        if (debug) _debug(`├─ Processing: "${effect.name}" on ${actor.name}`);
        await _processEffect(actor, effect, config, cadence, tickState, phaseCtx, debug);
      } catch (err) {
        _error(`Failed to process effect "${effect.name}" on ${actor.name}`, err);
      }
      if (_perf) {
        perfRecord({
          event: "overtime.process",
          trigger,
          combatId: _combatId,
          round: phaseCtx.round,
          actorId: actor?.id ?? null,
          effectName: effect?.name ?? null,
          payloadType: config?.payloadType ?? null,
          durationMs: monoMs() - _tp,
          composite: true,
        });
      }
    }
    _boundaryPhaseProcessMs += _perf ? (monoMs() - _tPhaseProcess) : 0;
  }

  if (debug) _debug("═══ OverTime Boundary Tick END ═══");

  if (_perf) {
    perfRecord({
      event: "overtime.boundaryTick",
      combatId: _combatId,
      round: boundaryCtx.currentRound,
      phases: boundaryCtx.phases.join(","),
      roundChanged: boundaryCtx.roundChanged,
      indexedActors: _effectIndex.size,
      boundaryEnsureIndexMs: _boundaryEnsureIndexMs,
      boundaryCollectMs: _boundaryCollectMs,
      boundaryCandidateCount: _boundaryCandidateCount,
      boundaryPhaseProcessMs: _boundaryPhaseProcessMs,
      boundaryUsedSharedCandidates: _boundaryUsedSharedCandidates,
      durationMs: monoMs() - _t0,
    });
  }
}

// ─── Effect Collection (Index-Accelerated) ───────────────────────────────────

/**
 * @typedef {object} OverTimeCandidate
 * @property {Actor}        actor     — The owning actor.
 * @property {ActiveEffect} effect    — The AE carrying the OverTime config.
 * @property {object}       config    — Parsed OverTime configuration.
 * @property {object}       cadence   — Normalized runtime cadence descriptor.
 * @property {object}       tickState — Current mutable tick state.
 */

/**
 * Collect all eligible OverTime effects matching the given trigger.
 *
 * Uses the pre-built effect index for fast actor lookup and applies the
 * following gates (in order):
 *   1. Effect must not be disabled
 *   2. Effect must not be awaiting upkeep (`upkeepAwaiting` flag)
 *   3. Config trigger must match the current trigger
 *   4. Turn-based triggers require actor UUID match
 *   5. Cadence gating (every N rounds/seconds)
 *   6. Max ticks gating
 *
 * @param {string} trigger
 * @param {import("./spell-tick-engine.js").SpellTickContext} ctx
 * @param {boolean} debug — Whether debug logging is active.
 * @returns {OverTimeCandidate[]}
 */
function _collectOverTimeEffects(trigger, ctx, debug) {
  /** @type {OverTimeCandidate[]} */
  const results = [];
  const uuidCache = new Map();

  // Diagnostic counters (only tracked when debug is on)
  let totalActors = 0, totalEffects = 0;
  let skippedDisabled = 0, skippedUpkeep = 0, skippedNoEffect = 0;
  let skippedWrongTrigger = 0, skippedWrongActor = 0;
  let skippedCadence = 0, skippedMaxTicks = 0;

  // Resolve each indexed actor → look up its live effects
  for (const [actorUuid, effectMap] of _effectIndex) {
    totalActors++;

    // Resolve the live actor from UUID — fromUuidSync is safe here because
    // world actors and canvas token actors are always loaded
    const actor = resolveActorFromUuidSync(actorUuid, { cache: uuidCache });
    if (!actor?.effects) continue;

    for (const [effectId, cachedEntries] of effectMap) {
      totalEffects++;

      // Look up live effect on the actor
      const ef = actor.effects.get(effectId);
      if (!ef) {
        skippedNoEffect++;
        continue;
      }

      // Gate 1: disabled
      if (ef.disabled) {
        skippedDisabled++;
        for (const entry of cachedEntries) {
          _trace(debug, "skip", {
            ..._provenanceBase(actor, ef, entry.config, entry.cadence, ctx),
            reason: "disabled"
          });
        }
        continue;
      }

      // Gate 2: upkeep awaiting — do not tick while upkeep decision is pending
      if (ef.flags?.[_FLAG_NS]?.upkeepAwaiting) {
        skippedUpkeep++;
        for (const entry of cachedEntries) {
          _trace(debug, "skip", {
            ..._provenanceBase(actor, ef, entry.config, entry.cadence, ctx),
            reason: "upkeepAwaiting"
          });
        }
        continue;
      }

      // Read live tick state (mutable — must be fresh, not cached)
      const tickState = _getTickState(ef);

      // Iterate entries (usually 1, but stacked effects may have multiple)
      for (const entry of cachedEntries) {
        const config = entry.config;
        const cadence = entry.cadence;
        const base = _provenanceBase(actor, ef, config, cadence, ctx);
        _trace(debug, "candidateFound", base);

        // Gate 3: trigger match
        if (!cadence.valid || cadence.trigger !== trigger) {
          skippedWrongTrigger++;
          _trace(debug, "skip", {
            ...base,
            reason: cadence.valid ? "wrongTrigger" : "invalidTrigger"
          });
          continue;
        }

        // Gate 4: turn-based actor match (uuid comparison for synthetic safety)
        if ((trigger === "turnStart" || trigger === "turnEnd") && ctx.actor) {
          if (actor.uuid !== ctx.actor.uuid) {
            skippedWrongActor++;
            _trace(debug, "skip", { ...base, reason: "wrongActor" });
            continue;
          }
        }

        // Gate 5: cadence
        const cadenceResult = doesCadenceMatch(cadence, tickState, ctx);
        if (!cadenceResult.matched) {
          skippedCadence++;
          _trace(debug, "skip", {
            ...base,
            reason: cadenceResult.reason,
            elapsed: cadenceResult.elapsed,
            required: cadenceResult.required
          });
          continue;
        }
        _trace(debug, "cadenceMatched", {
          ...base,
          reason: cadenceResult.reason,
          elapsed: cadenceResult.elapsed,
          required: cadenceResult.required
        });

        // Gate 6: max ticks
        const maxTicks = _numOrNull(config.maxTicks, null);
        const currentTicks = _num(tickState.tickCount, 0);
        if (maxTicks !== null && currentTicks >= maxTicks) {
          skippedMaxTicks++;
          _trace(debug, "skip", { ...base, reason: "maxTicksReached" });
          continue;
        }

        if (debug) {
          _debug(`     ✓ [${actor.name}] "${ef.name}" - ELIGIBLE`, {
            trigger: config.trigger,
            cadence: `${config.cadenceEvery ?? 1} ${config.cadenceUnit ?? "rounds"}`,
            payload: config.payloadType,
            tickCount: currentTicks,
            maxTicks
          });
        }

        results.push({ actor, effect: ef, config, cadence, tickState });
      }
    }
  }

  if (debug) {
    _debug(`  Collection Summary: ${results.length} eligible | scanned ${totalEffects} effects on ${totalActors} actors`);
    _debug(`    Skipped: disabled=${skippedDisabled}, upkeepAwaiting=${skippedUpkeep}, stale=${skippedNoEffect}, wrongTrigger=${skippedWrongTrigger}, wrongActor=${skippedWrongActor}, cadence=${skippedCadence}, maxTicks=${skippedMaxTicks}`);
  }

  return results;
}

/**
 * @typedef {object} OverTimeCandidateRef
 * @property {string} actorUuid
 * @property {string} effectId
 * @property {object} config
 * @property {object} cadence
 */

/**
 * Build per-trigger candidate reference buckets once for a boundary tick.
 *
 * This is a static-safe prefilter only. Runtime/mutable checks (disabled,
 * upkeepAwaiting, cadence, maxTicks, stale effect deletion) are deferred to
 * phase-time candidate materialization.
 *
 * @param {import("./spell-tick-engine.js").SpellTickBoundaryContext} boundaryCtx
 * @param {boolean} debug
 * @returns {Map<string, OverTimeCandidateRef[]>}
 */
function _buildBoundaryCandidateBuckets(boundaryCtx, debug) {
  /** @type {Map<string, OverTimeCandidateRef[]>} */
  const buckets = new Map();
  const activeTriggers = new Set(boundaryCtx.phases ?? []);

  // Optional static narrowing for turn-boundary phases.
  const turnActorByTrigger = new Map();
  const turnStartCtx = boundaryCtx.phaseContexts?.get?.("turnStart") ?? null;
  const turnEndCtx = boundaryCtx.phaseContexts?.get?.("turnEnd") ?? null;
  if (turnStartCtx?.actor?.uuid) turnActorByTrigger.set("turnStart", String(turnStartCtx.actor.uuid));
  if (turnEndCtx?.actor?.uuid) turnActorByTrigger.set("turnEnd", String(turnEndCtx.actor.uuid));

  for (const [actorUuid, effectMap] of _effectIndex) {
    for (const [effectId, cachedEntries] of effectMap) {
      for (const entry of cachedEntries) {
        const { config, cadence } = entry;
        const trigger = cadence?.trigger;
        if (!activeTriggers.has(trigger)) continue;

        // Static-safe actor narrowing for turn phases only when actor is known.
        const narrowedActorUuid = turnActorByTrigger.get(trigger);
        if (narrowedActorUuid && narrowedActorUuid !== actorUuid) continue;

        let triggerBucket = buckets.get(trigger);
        if (!triggerBucket) {
          triggerBucket = [];
          buckets.set(trigger, triggerBucket);
        }
        triggerBucket.push({ actorUuid, effectId, config, cadence });
      }
    }
  }

  if (debug) {
    const summary = {};
    for (const [trigger, refs] of buckets) summary[trigger] = refs.length;
    _debug("Boundary shared candidate precompute complete", summary);
  }

  return buckets;
}

/**
 * Materialize live OverTime candidates for one boundary phase from precomputed
 * lightweight references.
 *
 * Applies mutable/runtime gates in the same order as `_collectOverTimeEffects`.
 *
 * @param {string} trigger
 * @param {import("./spell-tick-engine.js").SpellTickContext} ctx
 * @param {OverTimeCandidateRef[]} refs
 * @param {boolean} debug
 * @returns {OverTimeCandidate[]}
 */
function _resolveBoundaryCandidates(trigger, ctx, refs, debug) {
  /** @type {OverTimeCandidate[]} */
  const results = [];
  const uuidCache = new Map();

  // Diagnostic counters (only tracked when debug is on)
  let totalRefs = 0;
  let skippedNoActor = 0, skippedNoEffect = 0;
  let skippedDisabled = 0, skippedUpkeep = 0;
  let skippedWrongTrigger = 0, skippedWrongActor = 0;
  let skippedCadence = 0, skippedMaxTicks = 0;

  for (const ref of refs) {
    totalRefs++;
    const actor = resolveActorFromUuidSync(ref.actorUuid, { cache: uuidCache });
    if (!actor?.effects) {
      skippedNoActor++;
      continue;
    }

    const config = ref.config;
    const cadence = ref.cadence ?? normalizeOverTimeCadence(config);
    const ef = actor.effects.get(ref.effectId);
    if (!ef) {
      skippedNoEffect++;
      continue;
    }

    if (ef.disabled) {
      skippedDisabled++;
      _trace(debug, "skip", {
        ..._provenanceBase(actor, ef, config, cadence, ctx),
        reason: "disabled"
      });
      continue;
    }

    if (ef.flags?.[_FLAG_NS]?.upkeepAwaiting) {
      skippedUpkeep++;
      _trace(debug, "skip", {
        ..._provenanceBase(actor, ef, config, cadence, ctx),
        reason: "upkeepAwaiting"
      });
      continue;
    }

    // Defensive check: should be guaranteed by bucket build.
    const base = _provenanceBase(actor, ef, config, cadence, ctx);
    _trace(debug, "candidateFound", base);
    if (!cadence.valid || cadence.trigger !== trigger) {
      skippedWrongTrigger++;
      _trace(debug, "skip", {
        ...base,
        reason: cadence.valid ? "wrongTrigger" : "invalidTrigger"
      });
      continue;
    }

    if ((trigger === "turnStart" || trigger === "turnEnd") && ctx.actor) {
      if (actor.uuid !== ctx.actor.uuid) {
        skippedWrongActor++;
        _trace(debug, "skip", { ...base, reason: "wrongActor" });
        continue;
      }
    }

    const tickState = _getTickState(ef);

    const cadenceResult = doesCadenceMatch(cadence, tickState, ctx);
    if (!cadenceResult.matched) {
      skippedCadence++;
      _trace(debug, "skip", {
        ...base,
        reason: cadenceResult.reason,
        elapsed: cadenceResult.elapsed,
        required: cadenceResult.required
      });
      continue;
    }
    _trace(debug, "cadenceMatched", {
      ...base,
      reason: cadenceResult.reason,
      elapsed: cadenceResult.elapsed,
      required: cadenceResult.required
    });

    const maxTicks = _numOrNull(config.maxTicks, null);
    const currentTicks = _num(tickState.tickCount, 0);
    if (maxTicks !== null && currentTicks >= maxTicks) {
      skippedMaxTicks++;
      _trace(debug, "skip", { ...base, reason: "maxTicksReached" });
      continue;
    }

    if (debug) {
      _debug(`     ✓ [${actor.name}] "${ef.name}" - ELIGIBLE`, {
        trigger: config.trigger,
        cadence: `${config.cadenceEvery ?? 1} ${config.cadenceUnit ?? "rounds"}`,
        payload: config.payloadType,
        tickCount: currentTicks,
        maxTicks
      });
    }

    results.push({ actor, effect: ef, config, cadence, tickState });
  }

  if (debug) {
    _debug(`  Boundary Materialize Summary (${trigger}): ${results.length} eligible | scanned ${totalRefs} refs`);
    _debug(`    Skipped: noActor=${skippedNoActor}, stale=${skippedNoEffect}, disabled=${skippedDisabled}, upkeepAwaiting=${skippedUpkeep}, wrongTrigger=${skippedWrongTrigger}, wrongActor=${skippedWrongActor}, cadence=${skippedCadence}, maxTicks=${skippedMaxTicks}`);
  }

  return results;
}

// ─── Effect Processing ───────────────────────────────────────────────────────

/**
 * Process a single OverTime effect tick: resolve targets, execute payload,
 * update state, post chat, emit hook.
 *
 * @param {Actor}        actor
 * @param {ActiveEffect} effect
 * @param {object}       config    — Parsed OverTime config.
 * @param {object}       tickState — Current mutable tick state.
 * @param {import("./spell-tick-engine.js").SpellTickContext} ctx
 * @param {boolean}      debug     — Whether debug logging is active.
 */
async function _processEffect(actor, effect, config, cadence, tickState, ctx, debug) {
  const payloadType = _str(config.payloadType || "damage");
  const base = _provenanceBase(actor, effect, config, cadence, ctx);

  // Determine targets
  const isOrigin = effect.flags?.[_FLAG_NS]?.isOriginAE === true;
  const targets = isOrigin
    ? await _resolveOriginTargets(effect, actor)
    : [actor];

  if (debug) {
    _debug(`    ┌── Process Effect: "${effect.name}" on ${actor.name}`, {
      origin: isOrigin, payload: payloadType,
      targets: targets.map(t => t.name),
      formula: config.formula || "none",
      tickCount: tickState.tickCount ?? 0,
      maxTicks: config.maxTicks ?? "unlimited"
    });
  }

  // Execute payload for each target
  /** @type {string[]} */
  const chatParts = [];

  for (const target of targets) {
    if (debug) _debug(`    │   ├─ Executing payload for ${target.name}...`);
    try {
      const content = await _executePayload(payloadType, target, effect, config, ctx);
      if (content) {
        chatParts.push(content);
        _trace(debug, "payloadExecuted", {
          ...base,
          target: target?.name ?? null,
          targetUuid: target?.uuid ?? null,
          contentLength: String(content).length
        });
      } else {
        _trace(debug, "payloadSkipped", {
          ...base,
          target: target?.name ?? null,
          targetUuid: target?.uuid ?? null,
          reason: "emptyResult"
        });
      }
    } catch (err) {
      _error(`Failed to execute ${payloadType} payload for ${target.name}`, err);
      _trace(debug, "payloadSkipped", {
        ...base,
        target: target?.name ?? null,
        targetUuid: target?.uuid ?? null,
        reason: "error"
      });
    }
  }

  // ── Post-payload liveness check ──
  // Payload execution (endEffect, saveThenApply→endEffect, maxTicks) can delete
  // the effect from the parent's collection.  If the effect is gone, skip state
  // update and hook emission to avoid "does not exist in EmbeddedCollection".
  const effectAlive = _isEffectAlive(actor, effect);

  if (effectAlive) {
    // Update tick state (single batched write)
    if (debug) _debug(`    │   Updating tick state...`);
    const stateResult = await _updateTickState(effect, config, tickState, ctx);
    _trace(debug, stateResult?.updated ? "stateUpdated" : "stateSkipped", {
      ...base,
      ...(stateResult ?? { updated: false, reason: "stateUpdateUnknown" })
    });
  } else {
    _trace(debug, "stateSkipped", { ...base, reason: "effectDeleted" });
    _debug(`    │   ⚠ Effect "${effect.name}" no longer exists — skipping state update`);
  }

  // Post chat message (chat is always safe even if effect was deleted)
  if (config.chatLog !== false && chatParts.length) {
    await _postChatMessage(actor, effect, config, chatParts);
  }

  if (debug) _debug(`    └── Effect processing complete`);

  // Emit system hook
  try {
    Hooks.callAll("uesrpg.overTime.tick", {
      actor, targets, effect, config, payloadType,
      trigger: ctx.trigger,
      round: ctx.round,
      tickCount: _num(tickState.tickCount, 0) + 1,
      effectDeleted: !effectAlive
    });
  } catch (_e) { /* no-op */ }
}

// ─── Payload Dispatch ────────────────────────────────────────────────────────

/**
 * Route to the correct payload executor based on type.
 *
 * @param {string}       type
 * @param {Actor}        target
 * @param {ActiveEffect} effect
 * @param {object}       config
 * @param {import("./spell-tick-engine.js").SpellTickContext} ctx
 * @returns {Promise<string>} Chat HTML fragment.
 */
async function _executePayload(type, target, effect, config, ctx) {
  if (HEAL_TYPES.has(type))           return _executeHealPayload(target, effect, config, ctx);
  if (type === "damage")              return _executeDamagePayload(target, effect, config, ctx);
  if (type === "endEffect")           return _executeEndEffectPayload(target, effect, config, ctx);
  if (type === "saveThenApply")       return _executeSaveThenApplyPayload(target, effect, config, ctx);
  _warn(`Unknown payload type: ${type}`);
  _debug("payloadSkipped", {
    reason: "unknownPayloadType",
    payloadType: type,
    effect: effect?.name ?? null,
    effectId: effect?.id ?? null,
    target: target?.name ?? null,
    targetUuid: target?.uuid ?? null
  });
  return "";
}

// ─── Origin-Linked Target Resolution ─────────────────────────────────────────

/**
 * Resolve target actors from an Origin AE's `linkedEntities` or `upkeep.targetLock`.
 *
 * @param {ActiveEffect} originEffect
 * @param {Actor}        casterActor — Fallback if no targets found.
 * @returns {Promise<Actor[]>}
 */
async function _resolveOriginTargets(originEffect, casterActor) {
  const flags = originEffect.flags?.[_FLAG_NS];
  /** @type {Set<string>} */
  const targetUuids = new Set();
  const uuidCache = new Map();

  // Primary: linkedEntities
  const linked = flags?.linkedEntities;
  if (Array.isArray(linked)) {
    for (const link of linked) {
      if (link.type === "targetAE" && link.actorUuid) targetUuids.add(link.actorUuid);
    }
  }

  // Fallback: upkeep.targetLock
  if (!targetUuids.size) {
    const lock = flags?.upkeep?.targetLock;
    if (Array.isArray(lock)) {
      for (const uuid of lock) { if (uuid) targetUuids.add(uuid); }
    }
  }

  if (!targetUuids.size) {
    _debug("Origin AE has no linked targets, falling back to caster");
    return [casterActor];
  }

  /** @type {Actor[]} */
  const actors = [];
  for (const uuid of targetUuids) {
    const actor = resolveActorFromUuidSync(uuid, { cache: uuidCache });
    if (actor) actors.push(actor);
    else _debug(`Failed to resolve target UUID: ${uuid}`);
  }

  return actors.length ? actors : [casterActor];
}

// ─── Payload Executors ───────────────────────────────────────────────────────

/**
 * Execute a **damage** payload.
 *
 * @param {Actor}        actor
 * @param {ActiveEffect} effect
 * @param {object}       config
 * @param {import("./spell-tick-engine.js").SpellTickContext} ctx
 * @returns {Promise<string>} Chat HTML.
 */
async function _executeDamagePayload(actor, effect, config, ctx) {
  const formula = _str(config.formula || "0");
  const damageType = _str(config.damageType || "magic");
  const ignoreReduction = config.ignoreReduction !== undefined ? !!config.ignoreReduction : false;
  const source = _str(config.label || effect?.name || "OverTime");

  const roll = new Roll(formula);
  await roll.evaluate();
  const damage = _num(roll.total, 0);

  if (damage <= 0) return `<p>No damage dealt.</p>`;

  // Delegate to the centralized damage/healing pipeline.
  // applyDamage handles the healing redirect when damageType === "healing",
  // plus temp HP absorption, wound threshold, immunity, incorporeal,
  // and dispatches uesrpgDamageApplied / uesrpgHealingApplied hooks.
  try {
    const result = await applyDamage(actor, damage, damageType, {
      ignoreReduction,
      source,
      skipChatMessage: true, // OT engine posts its own chat card
    });

    if (result) {
      const oldHP = _num(result.oldHP, 0);
      const newHP = _num(result.newHP, 0);
      const applied = _num(result.damage ?? result.healing ?? damage, 0);

      // Build chat fragment based on what the pipeline actually did
      const isHealRedirect = damageType === DAMAGE_TYPES.HEALING;
      if (isHealRedirect) {
        const healed = _num(result.healing ?? result.effectiveHealed ?? applied, 0);
        _debug(`Damage→Heal redirect: ${actor.name} heals ${healed} (${oldHP} → ${newHP})`);
        return `<p><strong>${actor.name}</strong> heals <strong>${healed}</strong> HP. (HP: ${oldHP} → ${newHP})</p>`;
      }

      // Standard damage result
      const parts = [`<p><strong>${actor.name}</strong> takes <strong>${applied}</strong> ${damageType} damage. (HP: ${oldHP} → ${newHP})</p>`];
      if (result.immunity?.isImmune) {
        parts.push(`<p><em>Immune to ${damageType} — no damage dealt.</em></p>`);
      }
      if (result.incorporealBlock?.isBlocked) {
        parts.push(`<p><em>Incorporeal — non-magic source blocked.</em></p>`);
      }
      if (result.woundStatus === "wounded") {
        parts.push(`<p><em>⚠ WOUNDED</em></p>`);
      }
      if (result.woundStatus === "unconscious") {
        parts.push(`<p><em>💀 UNCONSCIOUS</em></p>`);
      }
      _debug(`Damage: ${actor.name} takes ${applied} ${damageType} (${oldHP} → ${newHP})`);
      return parts.join("");
    }
  } catch (err) {
    _error(`Failed to apply damage to ${actor.name}`, err);
  }

  return `<p>Damage application failed for <strong>${actor.name}</strong>.</p>`;
}

/**
 * Execute a **heal** payload.
 *
 * @param {Actor}        actor
 * @param {ActiveEffect} effect
 * @param {object}       config
 * @param {import("./spell-tick-engine.js").SpellTickContext} ctx
 * @returns {Promise<string>} Chat HTML.
 */
async function _executeHealPayload(actor, effect, config, ctx) {
  const formula = _str(config.formula || "0");
  const damageType = _str(config.damageType || "");
  const source = _str(config.label || effect?.name || "OverTime");
  const isTemporary = damageType === "temporaryHealing";

  const roll = new Roll(formula);
  await roll.evaluate();
  const healing = _num(roll.total, 0);

  if (healing <= 0) return `<p>No healing applied.</p>`;

  // Delegate to the centralized healing pipeline.
  // Gains: uesrpgHealingApplied hook dispatch (Bleeding interaction),
  // overheal tracking, temp HP routing, and proper unlinked-token handling.
  try {
    const result = await applyHealing(actor, healing, {
      source,
      isTemporary,
      skipChatMessage: true, // OT engine posts its own chat card
    });

    if (result) {
      if (isTemporary) {
        const granted = _num(result.granted, 0);
        const totalTemp = _num(result.tempHP, 0);
        _debug(`TempHeal: ${actor.name} gains ${granted} temp HP (total: ${totalTemp})`);
        return `<p><strong>${actor.name}</strong> gains <strong>${granted}</strong> temporary HP. (Temp HP: ${totalTemp})</p>`;
      }

      const oldHP = _num(result.oldHP, 0);
      const newHP = _num(result.newHP, 0);
      const healed = _num(result.healing ?? result.effectiveHealed, 0);
      _debug(`Heal: ${actor.name} heals ${healed} (${oldHP} → ${newHP})`);
      return `<p><strong>${actor.name}</strong> heals <strong>${healed}</strong> HP. (HP: ${oldHP} → ${newHP})</p>`;
    }
  } catch (err) {
    _error(`Failed to apply healing to ${actor.name}`, err);
  }

  return `<p>Healing application failed for <strong>${actor.name}</strong>.</p>`;
}

/**
 * Execute an **endEffect** payload (self-terminating).
 *
 * @param {Actor}        actor
 * @param {ActiveEffect} effect
 * @param {object}       config
 * @param {import("./spell-tick-engine.js").SpellTickContext} ctx
 * @returns {Promise<string>} Chat HTML.
 */
async function _executeEndEffectPayload(actor, effect, config, ctx) {
  _debug(`EndEffect: removing "${effect.name}" from ${actor.name}`);

  if (!_isEffectAlive(actor, effect)) {
    _debug(`EndEffect: "${effect.name}" already removed from ${actor.name}`);
    return `<p><strong>${effect.name}</strong> ends on <strong>${actor.name}</strong>.</p>`;
  }

  await _deleteEffectIfAlive(actor, effect, { context: `EndEffect on ${actor.name}` });

  return `<p><strong>${effect.name}</strong> ends on <strong>${actor.name}</strong>.</p>`;
}

/**
 * Execute a **saveThenApply** payload.
 *
 * Rolls a d100 save against a characteristic TN.  On success, executes the
 * configured success action; on failure, executes the failure action.
 *
 * @param {Actor}        actor
 * @param {ActiveEffect} effect
 * @param {object}       config
 * @param {import("./spell-tick-engine.js").SpellTickContext} ctx
 * @returns {Promise<string>} Chat HTML.
 */
async function _executeSaveThenApplyPayload(actor, effect, config, ctx) {
  const saveTN = _num(config.saveTN, 50);
  const saveKey = _str(config.saveKey || "wp");
  const successAction = _str(config.saveSuccess || "endEffect");
  const failureAction = _str(config.saveFailure || "damage");

  const roll = new Roll("1d100");
  await roll.evaluate();
  const rollResult = _num(roll.total, 100);

  // Resolve characteristic bonus
  let bonus = 0;
  let charLabel = saveKey.toUpperCase();
  try {
    const charObj = actor.system?.characteristics?.[saveKey];
    if (charObj && typeof charObj === "object") {
      bonus = _num(charObj.total, _num(charObj.base, 0));
      if (charObj.name) charLabel = charObj.name;
    } else if (typeof charObj === "number") {
      bonus = _num(charObj, 0);
    }
  } catch (_e) { /* no-op */ }

  const effectiveTN = saveTN + bonus;
  const success = rollResult <= effectiveTN;

  _debug(`Save: ${actor.name} rolls ${rollResult} vs TN ${effectiveTN} → ${success ? "SUCCESS" : "FAILURE"}`);

  let actionChat = "";

  if (success) {
    switch (successAction) {
      case "endEffect":
        actionChat = await _executeEndEffectPayload(actor, effect, config, ctx);
        break;
      case "halve": {
        // Evaluate the original formula first, then halve the numeric result.
        // (The previous Math.floor() wrapper produced invalid Roll expressions.)
        const halveRoll = new Roll(_str(config.formula || "0"));
        await halveRoll.evaluate();
        const halvedValue = Math.max(0, Math.floor(_num(halveRoll.total, 0) / 2));
        const halfConfig = { ...config, formula: String(halvedValue) };
        actionChat = await _executeDamagePayload(actor, effect, halfConfig, ctx);
        if (halvedValue > 0) {
          actionChat = `<p><em>(Halved: ${halveRoll.total} → ${halvedValue})</em></p>${actionChat}`;
        }
        break;
      }
      case "negate":
        actionChat = `<p>Save succeeded — effect negated this tick.</p>`;
        break;
    }
  } else {
    switch (failureAction) {
      case "damage":
        actionChat = await _executeDamagePayload(actor, effect, config, ctx);
        break;
      case "condition":
        actionChat = `<p>Save failed — condition persists.</p>`;
        break;
    }
  }

  return `<p><strong>${actor.name}</strong> saves vs ${_str(config.label || effect.name)} (${charLabel}): rolled <strong>${rollResult}</strong> vs TN <strong>${effectiveTN}</strong> — <strong>${success ? "Success" : "Failure"}</strong></p>${actionChat}`;
}

// ─── Chat Output ─────────────────────────────────────────────────────────────

/**
 * Post an OverTime tick result to the chat log.
 *
 * @param {Actor}        actor
 * @param {ActiveEffect} effect
 * @param {object}       config
 * @param {string[]}     chatParts — HTML fragments from payload executors.
 */
async function _postChatMessage(actor, effect, config, chatParts) {
  const label = _str(config.label || effect.name);
  const content = `<div class="uesrpg"><h4>${label}</h4>${chatParts.join("")}</div>`;

  try {
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (err) {
    _error("Failed to post chat message", err);
  }
}

// ─── State Management ────────────────────────────────────────────────────────

/**
 * Persist updated tick state to the effect's flags.
 *
 * Writes a single batched update to `flags.uesrpg-3ev4.overTimeState.*`.
 * If maxTicks is reached, auto-deletes the effect.
 *
 * @param {ActiveEffect} effect
 * @param {object}       config
 * @param {object}       tickState
 * @param {import("./spell-tick-engine.js").SpellTickContext} ctx
 */
async function _updateTickState(effect, config, tickState, ctx) {
  // Guard: verify effect still exists in parent collection
  const parent = effect?.parent;
  if (!parent || !_isEffectAlive(parent, effect)) {
    _debug(`Skipping tick state update — effect "${effect?.name}" no longer exists`);
    return { updated: false, reason: "effectMissingBeforeStateUpdate" };
  }

  const newTickCount = _num(tickState.tickCount, 0) + 1;

  // Check max ticks BEFORE writing state — avoids a pointless write followed
  // by immediate deletion when max is reached on this tick.
  const maxTicks = _numOrNull(config.maxTicks, null);
  const shouldAutoEnd = maxTicks !== null && newTickCount >= maxTicks;

  if (shouldAutoEnd) {
    // Max ticks reached — delete effect directly, no need to update state first
    _debug(`Max ticks reached for "${effect.name}" (${newTickCount}/${maxTicks}), auto-ending`);
    const deleted = await _deleteEffectIfAlive(parent, effect, { context: `MaxTicks auto-end on ${parent?.name ?? "actor"}` });
    return {
      updated: false,
      reason: "maxTicks",
      tickCount: newTickCount,
      maxTicks,
      deleted
    };
  }

  // Write updated tick state
  const updates = {
    [`flags.${_FLAG_NS}.overTimeState.lastTickRound`]: ctx.round,
    [`flags.${_FLAG_NS}.overTimeState.lastTickTurn`]: ctx.turn,
    [`flags.${_FLAG_NS}.overTimeState.lastTickWorldTime`]: ctx.worldTime,
    [`flags.${_FLAG_NS}.overTimeState.tickCount`]: newTickCount
  };

  try {
    await requestUpdateDocument(effect, updates);
    return {
      updated: true,
      reason: "stateUpdated",
      tickCount: newTickCount,
      updates
    };
  } catch (err) {
    if (_isMissingDocError(err) || !_isEffectAlive(parent, effect)) {
      return { updated: false, reason: "effectMissingDuringStateUpdate", tickCount: newTickCount };
    }
    // Fallback: direct update (if authority proxy fails for owned effects)
    if (_isEffectAlive(parent, effect)) {
      try {
        await effect.update(updates);
        return {
          updated: true,
          reason: "stateUpdatedFallback",
          tickCount: newTickCount,
          updates
        };
      }
      catch (_e) {
        if (_isMissingDocError(_e) || !_isEffectAlive(parent, effect)) {
          return { updated: false, reason: "effectMissingDuringStateUpdate", tickCount: newTickCount };
        }
        _warn(`Failed to update tick state for "${effect.name}"`, _e);
        return { updated: false, reason: "stateUpdateFailed", tickCount: newTickCount };
      }
    }
  }
  return { updated: false, reason: "stateUpdateFailed", tickCount: newTickCount };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if an ActiveEffect has an OverTime configuration (changes-key or legacy flags).
 *
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
export function hasOverTimeConfig(effect) {
  return _getAllOverTimeConfigs(effect).length > 0;
}

/**
 * Get the first OverTime configuration from an effect.
 *
 * @param {ActiveEffect} effect
 * @returns {object|null} The first OverTime config, or null if none.
 */
export function getOverTimeConfig(effect) {
  const configs = _getAllOverTimeConfigs(effect);
  return configs.length ? configs[0] : null;
}
