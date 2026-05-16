/**
 * @module magic/ticks/spell-tick-engine
 *
 * src/core/magic/spell-tick-engine.js
 *
 * Unified spell tick engine for UESRPG 3ev4.
 *
 * Responsibilities:
 * - Exactly-once per-turn ticking for active spell zones and ongoing effects
 * - Combat ticks via `uesrpg.combatTimeChanged` (phase "post")
 * - Out-of-combat ticks via `uesrpg.timeChanged` at configurable intervals
 * - GM-only execution to prevent races
 * - lastTick markers on Origin AE to guarantee idempotency
 *
 * Design follows wound-ticker.js pattern:
 * - Snapshot prior combat state per combat ID
 * - Detect turn advancement → fire tick for the combatant whose turn just ended
 * - Also fire per-round tick at round boundaries
 *
 * ## Composite boundary dispatch (Milestone B)
 *
 * When `compositeBoundaryTickEnabled` is true, the four sequential
 * `_dispatchTick` calls at a round boundary (turnStart → turnEnd →
 * roundStart → roundEnd) are collapsed into a single `_dispatchTickComposite`
 * call that carries all phase contexts at once.
 *
 * Handlers that register an `fnBoundary` callback receive the full
 * `SpellTickBoundaryContext` and can iterate phases themselves (e.g.,
 * overtime-engine calls `_ensureIndex()` once for all phases).
 *
 * Handlers that do NOT register `fnBoundary` are shim-called once per phase
 * using the individual `SpellTickContext` from `phaseContexts`, preserving
 * backward compatibility.
 *
 * The legacy path (default, `compositeBoundaryTickEnabled = false`) is
 * unchanged and is extracted into `_handleBoundaryLegacy()` for clarity.
 *
 * Target: Foundry VTT v14.359+
 */

import { getOriginAEs } from "../effects/origin-effect.js";
import { getActiveSpellZones, getTokensInArea, hasActiveZones } from "../spell-runtime.js";
import { createDebugLogger } from "../_primitives.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../../utils/perf-tracker.js";
import { isCompositeBoundaryTickEnabled } from "../../config/automation-policy.js";
import { registerCombatBoundaryConsumer, noteCombatBoundaryLegacyFallbackSkip } from "../../time/combat-boundary-orchestrator.js";

const _FLAG_NS = FLAG_SCOPE;

let _registered = false;

/** @type {Map<string, {round: number, turn: number, combatantId: string|null}>} */
const _combatState = new Map();

/** @type {Array<SpellTickHandler>} */
const _handlers = [];

/**
 * Guardrail: tracks composite boundary keys seen in the current combat session.
 * Populated in _handleBoundaryComposite when timePerformanceDebug is enabled.
 * Cleared on deleteCombat.
 * Key format: "<combatId>:<prevRound>.<prevTurn>-><nextRound>.<nextTurn>"
 * @type {Set<string>}
 */
const _seenBoundaryKeys = new Set();

/**
 * @typedef {object} SpellTickContext
 * @property {"turnStart"|"turnEnd"|"roundStart"|"roundEnd"|"worldTime"} trigger
 * @property {Actor|null} actor - The actor whose turn just ended/started (turn triggers), or null
 * @property {number} round - Current combat round
 * @property {number} turn - Current combat turn index
 * @property {number} worldTime - Current world time
 * @property {number} dtSeconds - Seconds elapsed (for worldTime ticks)
 * @property {Combat|null} combat - Active combat document
 */

/**
 * @typedef {object} SpellTickBoundaryContext
 * @property {Combat} combat - Active combat document
 * @property {string} combatId - String combat id
 * @property {number} previousRound - Round before the boundary
 * @property {number} previousTurn - Turn index before the boundary
 * @property {string|null} previousCombatantId - Combatant id whose turn just ended
 * @property {number} currentRound - Round after the boundary
 * @property {number} currentTurn - Turn index after the boundary
 * @property {string|null} currentCombatantId - Combatant id whose turn is starting
 * @property {boolean} roundChanged - Whether the round number changed at this boundary
 * @property {boolean} turnChanged - Whether the turn index changed at this boundary
 * @property {string[]} phases - Ordered list of trigger names that will be dispatched
 * @property {Map<string, SpellTickContext>} phaseContexts - Per-phase SpellTickContext keyed by trigger name
 * @property {number} worldTime - Current world time at boundary
 */

/**
 * @typedef {object} SpellTickHandler
 * @property {string} id - Unique handler id
 * @property {string} label - Human-readable label
 * @property {(ctx: SpellTickContext) => Promise<void>} fn - Tick handler function (always called on legacy path; shim-called per-phase on composite path when fnBoundary is absent)
 * @property {((boundaryCtx: SpellTickBoundaryContext) => Promise<void>)|null} fnBoundary - Optional boundary handler called once with the full composite context (composite path only)
 * @property {((ctx: SpellTickContext) => boolean)|null} [hasWork] - Optional cheap predicate. If provided and returns false for a given SpellTickContext, the handler's fn is skipped for that tick entirely. For fnBoundary handlers this is not auto-applied — the handler manages its own skip logic.
 */

const _debug = createDebugLogger("spellTickDebug", "[UESRPG][SpellTick]");

function _snapshotCombat(combat) {
  const round = Number(combat?.round ?? 0);
  const turn = Number(combat?.turn ?? 0);
  const combatantId = combat?.combatant?.id ?? combat?.combatantId ?? null;
  return { round, turn, combatantId: combatantId ? String(combatantId) : null };
}

function _setState(combat) {
  if (!combat?.id) return;
  _combatState.set(String(combat.id), _snapshotCombat(combat));
}

function _getState(combat) {
  if (!combat?.id) return null;
  return _combatState.get(String(combat.id)) ?? null;
}

/**
 * Read the compositeBoundaryTickEnabled setting.
 * Defaults to false if the setting is unavailable (e.g., before ready).
 *
 * @returns {boolean}
 */
function _isCompositeBoundaryEnabled() {
  return isCompositeBoundaryTickEnabled();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a tick handler.
 * Handlers are called in registration order at each tick point.
 *
 * @param {object} handler
 * @param {string} handler.id - Unique handler id (used for dedup)
 * @param {string} handler.label - Human-readable label
 * @param {(ctx: SpellTickContext) => Promise<void>} handler.fn - Tick function
 * @param {((boundaryCtx: SpellTickBoundaryContext) => Promise<void>)} [handler.fnBoundary] - Optional composite boundary handler
 * @param {((ctx: SpellTickContext) => boolean)} [handler.hasWork] - Optional cheap predicate; return false to skip fn for that tick
 */
export function registerSpellTickHandler(handler) {
  if (!handler?.id || typeof handler.fn !== "function") return;
  // Prevent duplicate registration by id
  if (_handlers.some(h => h.id === handler.id)) return;
  _handlers.push({
    id: handler.id,
    label: handler.label || handler.id,
    fn: handler.fn,
    fnBoundary: typeof handler.fnBoundary === "function" ? handler.fnBoundary : null,
    hasWork: typeof handler.hasWork === "function" ? handler.hasWork : null
  });
  _debug("Registered tick handler:", handler.id);
}

/**
 * Unregister a tick handler by id.
 *
 * @param {string} handlerId
 */
export function unregisterSpellTickHandler(handlerId) {
  const idx = _handlers.findIndex(h => h.id === handlerId);
  if (idx >= 0) {
    _handlers.splice(idx, 1);
    _debug("Unregistered tick handler:", handlerId);
  }
}

/**
 * Initialize the spell tick engine.
 * Must be called once during system initialization (Hooks.once('ready')).
 * GM-only execution is enforced inside the handlers.
 */
export function initializeSpellTickEngine() {
  if (_registered) return;
  _registered = true;

  // Seed state if combat already exists
  if (game?.combat) _setState(game.combat);

  Hooks.on("createCombat", (combat) => _setState(combat));
  Hooks.on("deleteCombat", (combat) => {
    if (combat?.id) _combatState.delete(String(combat.id));
    // Clear guardrail boundary key set when a combat ends.
    _seenBoundaryKeys.clear();
  });

  const handleCombatBoundaryTicks = async (payload) => {
    if (!game.user?.isGM) return;
    if (payload?.source !== "combat") return;
    if (payload?.combat?.phase && payload.combat.phase !== "post") return;

    const combat = game?.combat ?? null;
    if (!combat?.id) return;
    if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

    const prev = _getState(combat);
    if (!prev) {
      _setState(combat);
      return;
    }

    const next = _snapshotCombat(combat);
    const advanced = (next.round !== prev.round) || (next.turn !== prev.turn) || (next.combatantId !== prev.combatantId);
    _setState(combat);
    if (!advanced) return;

    const nowTime = Number(game.time?.worldTime ?? 0);

    if (_isCompositeBoundaryEnabled()) {
      await _handleBoundaryComposite(combat, prev, next, nowTime);
    } else {
      await _handleBoundaryLegacy(combat, prev, next, nowTime);
    }
  };

  registerCombatBoundaryConsumer({
    id: "spell-tick-engine",
    // Spell and OverTime payloads must resolve before v14 registry expiry.
    order: 190,
    handle: handleCombatBoundaryTicks
  });

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    if (noteCombatBoundaryLegacyFallbackSkip("spell-tick-engine", payload)) return;
    await handleCombatBoundaryTicks(payload);
  });

  // Out-of-combat world time tick
  Hooks.on("uesrpg.timeChanged", async (payload) => {
    if (!game.user?.isGM) return;
    // Skip combat-sourced time changes (already handled above)
    const source = String(payload?.source ?? "");
    if (source === "combat" || source === "combatTurn" || source === "combatRound") return;
    // Only fire if time actually changed
    const dt = Number(payload?.dtSeconds ?? 0);
    if (dt <= 0) return;
    // Skip if combat is active (combat ticks handle it)
    if (game?.combat?.started) return;

    const nowTime = Number(payload?.worldTime ?? game.time?.worldTime ?? 0);

    _debug("World time tick, dt:", dt, "seconds");

    await _dispatchTick({
      trigger: "worldTime",
      actor: null,
      round: 0,
      turn: 0,
      worldTime: nowTime,
      dtSeconds: dt,
      combat: null
    });
  });

  _debug("Spell tick engine initialized");
}

// ─── Built-in Zone Tick Handler ──────────────────────────────────────────────

/**
 * Register the built-in zone damage tick handler.
 * This handler iterates all active spell zones and collects tokens within linked areas.
 * It emits `uesrpg.spell.zoneTick` for each zone, allowing other subsystems
 * to react (e.g., applying damage, conditions, etc.).
 *
 * Called during system init, after initializeSpellTickEngine().
 */
export function registerZoneTickHandler() {
  registerSpellTickHandler({
    id: "zone-tick",
    label: "Spell Zone Tick",
    // hasWork: skip the handler entirely on non-turnEnd triggers or when no zones exist.
    hasWork: (ctx) => ctx.trigger === "turnEnd" && hasActiveZones(),
    fn: async (ctx) => {
      // Only tick zones on turnEnd (per RAW: targets ending turn in zone take damage)
      if (ctx.trigger !== "turnEnd") return;

      const zones = getActiveSpellZones();
      if (!zones.length) return;

      for (const zone of zones) {
        for (const areaUuid of (zone.areaUuids ?? [])) {
          const tokens = getTokensInArea(areaUuid);
          if (!tokens.length) continue;

          _debug("Zone tick:", zone.spellName, "tokens:", tokens.map(t => t.name));

          // Emit hook for each zone — subsystems can react
          try {
            Hooks.callAll("uesrpg.spell.zoneTick", {
              originAE: zone.originAE,
              spellName: zone.spellName,
              spellUuid: zone.spellUuid,
              casterUuid: zone.casterUuid,
              areaUuid,
              regionUuid: zone.regionUuids?.includes?.(areaUuid) ? areaUuid : null,
              tokens,
              trigger: ctx.trigger,
              round: ctx.round,
              turn: ctx.turn,
              worldTime: ctx.worldTime
            });
          } catch (err) {
            console.warn("UESRPG | spell-tick-engine | zoneTick hook error", err);
          }
        }
      }
    }
  });
}

// ─── Internal — Boundary Paths ───────────────────────────────────────────────

/**
 * Legacy boundary path: four sequential _dispatchTick calls.
 * Behavior is identical to the original hook body.
 *
 * @param {Combat} combat
 * @param {{round: number, turn: number, combatantId: string|null}} prev
 * @param {{round: number, turn: number, combatantId: string|null}} next
 * @param {number} nowTime
 */
async function _handleBoundaryLegacy(combat, prev, next, nowTime) {
  // Start-of-turn tick for the combatant whose turn is starting
  if (next.combatantId) {
    const currCombatant = combat.combatants?.get?.(next.combatantId) ?? null;
    const actor = currCombatant?.actor ?? null;

    _debug("Turn started for", actor?.name ?? next.combatantId, "round:", next.round, "turn:", next.turn);

    await _dispatchTick({
      trigger: "turnStart",
      actor,
      round: next.round,
      turn: next.turn,
      worldTime: nowTime,
      dtSeconds: 0,
      combat
    });
  }

  // End-of-turn tick for the combatant whose turn just ended
  if (prev.combatantId) {
    const prevCombatant = combat.combatants?.get?.(prev.combatantId) ?? null;
    const actor = prevCombatant?.actor ?? null;

    _debug("Turn ended for", actor?.name ?? prev.combatantId, "round:", next.round, "turn:", next.turn);

    await _dispatchTick({
      trigger: "turnEnd",
      actor,
      round: next.round,
      turn: next.turn,
      worldTime: nowTime,
      dtSeconds: 0,
      combat
    });
  }

  // Round boundary ticks (when round number changes)
  if (next.round !== prev.round) {
    _debug("Round started:", next.round);

    await _dispatchTick({
      trigger: "roundStart",
      actor: null,
      round: next.round,
      turn: next.turn,
      worldTime: nowTime,
      dtSeconds: 0,
      combat
    });

    _debug("Round ended:", prev.round, "→", next.round);

    await _dispatchTick({
      trigger: "roundEnd",
      actor: null,
      round: next.round,
      turn: next.turn,
      worldTime: nowTime,
      dtSeconds: 0,
      combat
    });
  }
}

/**
 * Composite boundary path: build a SpellTickBoundaryContext carrying all
 * active phases and their per-phase SpellTickContexts, then dispatch once.
 *
 * @param {Combat} combat
 * @param {{round: number, turn: number, combatantId: string|null}} prev
 * @param {{round: number, turn: number, combatantId: string|null}} next
 * @param {number} nowTime
 */
async function _handleBoundaryComposite(combat, prev, next, nowTime) {
  const roundChanged = next.round !== prev.round;
  const turnChanged = next.turn !== prev.turn || next.combatantId !== prev.combatantId;

  /** @type {string[]} */
  const phases = [];
  /** @type {Map<string, SpellTickContext>} */
  const phaseContexts = new Map();

  // Phase: turnStart — combatant whose turn is now starting
  if (next.combatantId) {
    const currCombatant = combat.combatants?.get?.(next.combatantId) ?? null;
    const actor = currCombatant?.actor ?? null;
    const ctx = { trigger: "turnStart", actor, round: next.round, turn: next.turn, worldTime: nowTime, dtSeconds: 0, combat };
    phases.push("turnStart");
    phaseContexts.set("turnStart", ctx);
  }

  // Phase: turnEnd — combatant whose turn just ended
  if (prev.combatantId) {
    const prevCombatant = combat.combatants?.get?.(prev.combatantId) ?? null;
    const actor = prevCombatant?.actor ?? null;
    const ctx = { trigger: "turnEnd", actor, round: next.round, turn: next.turn, worldTime: nowTime, dtSeconds: 0, combat };
    phases.push("turnEnd");
    phaseContexts.set("turnEnd", ctx);
  }

  // Phases: roundStart + roundEnd (only on round boundary)
  if (roundChanged) {
    const roundStartCtx = { trigger: "roundStart", actor: null, round: next.round, turn: next.turn, worldTime: nowTime, dtSeconds: 0, combat };
    const roundEndCtx   = { trigger: "roundEnd",   actor: null, round: next.round, turn: next.turn, worldTime: nowTime, dtSeconds: 0, combat };
    phases.push("roundStart", "roundEnd");
    phaseContexts.set("roundStart", roundStartCtx);
    phaseContexts.set("roundEnd",   roundEndCtx);
  }

  if (!phases.length) return;

  // Guardrail: detect duplicate composite boundary dispatch.
  // Gated by timePerformanceDebug (isPerfEnabled) — no overhead in normal play.
  if (isPerfEnabled()) {
    const _bKey = `${String(combat.id)}:${prev.round}.${prev.turn}->${next.round}.${next.turn}`;
    if (_seenBoundaryKeys.has(_bKey)) {
      console.warn(
        `UESRPG | spell-tick-engine | GUARDRAIL: Duplicate composite boundary dispatch: "${_bKey}". ` +
        `This suggests the uesrpg.combatTimeChanged hook fired twice for the same combat advance. Proceeding.`
      );
    }
    _seenBoundaryKeys.add(_bKey);
  }

  /** @type {SpellTickBoundaryContext} */
  const boundaryCtx = {
    combat,
    combatId: String(combat.id),
    previousRound: prev.round,
    previousTurn: prev.turn,
    previousCombatantId: prev.combatantId,
    currentRound: next.round,
    currentTurn: next.turn,
    currentCombatantId: next.combatantId,
    roundChanged,
    turnChanged,
    phases,
    phaseContexts,
    worldTime: nowTime
  };

  _debug(`══════ Composite boundary dispatch: [${phases.join(", ")}] ══════`, {
    round: next.round, roundChanged, turnChanged
  });

  await _dispatchTickComposite(boundaryCtx);
}

// ─── Internal — Dispatch ─────────────────────────────────────────────────────

/**
 * Dispatch a single-phase tick to all registered handlers.
 * @param {SpellTickContext} ctx
 */
async function _dispatchTick(ctx) {
  const _perf = isPerfEnabled();
  const _t0 = _perf ? monoMs() : 0;
  const _combatId = ctx.combat?.id ?? null;

  _debug(`══════ Dispatching tick: ${ctx.trigger} ══════`, {
    actor: ctx.actor?.name,
    round: ctx.round,
    turn: ctx.turn,
    worldTime: ctx.worldTime,
    handlers: _handlers.length
  });

  if (!_handlers.length) {
    _debug("  ⚠ No handlers registered");
    return;
  }

  for (const handler of _handlers) {
    if (handler.hasWork && !handler.hasWork(ctx)) {
      _debug(`  ⟳ Handler "${handler.id}" skipped (hasWork=false for ${ctx.trigger})`);
      continue;
    }
    const _th0 = _perf ? monoMs() : 0;
    try {
      _debug(`  ► Calling handler: "${handler.id}"`);
      await handler.fn(ctx);
      _debug(`  ✓ Handler "${handler.id}" completed`);
    } catch (err) {
      console.error(`UESRPG | spell-tick-engine | Handler "${handler.id}" failed`, err);
    }
    if (_perf) {
      perfRecord({
        event: "spellTick.handler",
        trigger: ctx.trigger,
        handlerId: handler.id,
        combatId: _combatId,
        round: ctx.round,
        turn: ctx.turn,
        actorId: ctx.actor?.id ?? null,
        durationMs: monoMs() - _th0,
      });
    }
  }

  _debug(`══════ Dispatch complete ══════`);

  if (_perf) {
    perfRecord({
      event: "spellTick.dispatch",
      trigger: ctx.trigger,
      combatId: _combatId,
      round: ctx.round,
      turn: ctx.turn,
      actorId: ctx.actor?.id ?? null,
      handlerCount: _handlers.length,
      durationMs: monoMs() - _t0,
    });
  }
}

/**
 * Dispatch a composite boundary tick to all registered handlers.
 *
 * - Handlers with `fnBoundary` receive the full `SpellTickBoundaryContext` once.
 * - Handlers without `fnBoundary` are shim-called once per phase using the
 *   individual `SpellTickContext` from `phaseContexts` (backward compat).
 *
 * @param {SpellTickBoundaryContext} boundaryCtx
 */
async function _dispatchTickComposite(boundaryCtx) {
  const _perf = isPerfEnabled();
  const _t0 = _perf ? monoMs() : 0;
  const _combatId = boundaryCtx.combatId ?? null;

  if (!_handlers.length) {
    _debug("  ⚠ No handlers registered (composite)");
    return;
  }

  for (const handler of _handlers) {
    const _th0 = _perf ? monoMs() : 0;

    if (handler.fnBoundary) {
      // Composite-aware handler: one call with full boundary context
      try {
        _debug(`  ► Composite boundary call: "${handler.id}"`);
        await handler.fnBoundary(boundaryCtx);
        _debug(`  ✓ Composite handler "${handler.id}" completed`);
      } catch (err) {
        console.error(`UESRPG | spell-tick-engine | Composite handler "${handler.id}" failed`, err);
      }
      if (_perf) {
        perfRecord({
          event: "spellTick.compositeBoundaryHandler",
          handlerId: handler.id,
          combatId: _combatId,
          round: boundaryCtx.currentRound,
          phases: boundaryCtx.phases.join(","),
          durationMs: monoMs() - _th0,
        });
      }
    } else {
      // Legacy shim: call fn once per phase (skipping phases where hasWork returns false)
      for (const phase of boundaryCtx.phases) {
        const phaseCtx = boundaryCtx.phaseContexts.get(phase);
        if (!phaseCtx) continue;
        if (handler.hasWork && !handler.hasWork(phaseCtx)) {
          _debug(`  ⟳ Shim skip: "${handler.id}" for phase "${phase}" (hasWork=false)`);
          continue;
        }
        const _tph = _perf ? monoMs() : 0;
        try {
          _debug(`  ► Shim call: "${handler.id}" for phase "${phase}"`);
          await handler.fn(phaseCtx);
          _debug(`  ✓ Shim handler "${handler.id}" / "${phase}" completed`);
        } catch (err) {
          console.error(`UESRPG | spell-tick-engine | Shim handler "${handler.id}" / "${phase}" failed`, err);
        }
        if (_perf) {
          perfRecord({
            event: "spellTick.compositeShimHandler",
            trigger: phase,
            handlerId: handler.id,
            combatId: _combatId,
            round: boundaryCtx.currentRound,
            actorId: phaseCtx.actor?.id ?? null,
            durationMs: monoMs() - _tph,
          });
        }
      }
      if (_perf) {
        perfRecord({
          event: "spellTick.compositeShimTotal",
          handlerId: handler.id,
          combatId: _combatId,
          round: boundaryCtx.currentRound,
          phaseCount: boundaryCtx.phases.length,
          durationMs: monoMs() - _th0,
        });
      }
    }
  }

  _debug(`══════ Composite dispatch complete ══════`);

  if (_perf) {
    perfRecord({
      event: "spellTick.compositeDispatch",
      combatId: _combatId,
      round: boundaryCtx.currentRound,
      phases: boundaryCtx.phases.join(","),
      roundChanged: boundaryCtx.roundChanged,
      handlerCount: _handlers.length,
      durationMs: monoMs() - _t0,
    });
  }
}
