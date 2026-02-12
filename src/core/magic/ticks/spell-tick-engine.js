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
 * Target: Foundry VTT v13.351
 */

import { getOriginAEs } from "../effects/origin-effect.js";
import { getActiveSpellZones, getTokensInTemplate } from "../spell-runtime.js";
import { createDebugLogger } from "../_primitives.js";

const _FLAG_NS = "uesrpg-3ev4";

let _registered = false;

/** @type {Map<string, {round: number, turn: number, combatantId: string|null}>} */
const _combatState = new Map();

/** @type {Array<SpellTickHandler>} */
const _handlers = [];

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
 * @typedef {object} SpellTickHandler
 * @property {string} id - Unique handler id
 * @property {string} label - Human-readable label
 * @property {(ctx: SpellTickContext) => Promise<void>} fn - Tick handler function
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

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a tick handler.
 * Handlers are called in registration order at each tick point.
 *
 * @param {object} handler
 * @param {string} handler.id - Unique handler id (used for dedup)
 * @param {string} handler.label - Human-readable label
 * @param {(ctx: SpellTickContext) => Promise<void>} handler.fn - Tick function
 */
export function registerSpellTickHandler(handler) {
  if (!handler?.id || typeof handler.fn !== "function") return;
  // Prevent duplicate registration by id
  if (_handlers.some(h => h.id === handler.id)) return;
  _handlers.push({ id: handler.id, label: handler.label || handler.id, fn: handler.fn });
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
  });

  // Combat tick: end-of-turn and end-of-round
  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
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

    // Round boundary tick (when round number changes)
    if (next.round !== prev.round) {
      _debug("Round started:", next.round);

      // Round start tick
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

      // Round end tick
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
 * This handler iterates all active spell zones and collects tokens within templates.
 * It emits `uesrpg.spell.zoneTick` for each zone, allowing other subsystems
 * to react (e.g., applying damage, conditions, etc.).
 *
 * Called during system init, after initializeSpellTickEngine().
 */
export function registerZoneTickHandler() {
  registerSpellTickHandler({
    id: "zone-tick",
    label: "Spell Zone Tick",
    fn: async (ctx) => {
      // Only tick zones on turnEnd (per RAW: targets ending turn in zone take damage)
      if (ctx.trigger !== "turnEnd") return;

      const zones = getActiveSpellZones();
      if (!zones.length) return;

      for (const zone of zones) {
        for (const tplUuid of zone.templateUuids) {
          const tokens = getTokensInTemplate(tplUuid);
          if (!tokens.length) continue;

          _debug("Zone tick:", zone.spellName, "tokens:", tokens.map(t => t.name));

          // Emit hook for each zone — subsystems can react
          try {
            Hooks.callAll("uesrpg.spell.zoneTick", {
              originAE: zone.originAE,
              spellName: zone.spellName,
              spellUuid: zone.spellUuid,
              casterUuid: zone.casterUuid,
              templateUuid: tplUuid,
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

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Dispatch a tick to all registered handlers.
 * @param {SpellTickContext} ctx
 */
async function _dispatchTick(ctx) {
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
    try {
      _debug(`  ► Calling handler: "${handler.id}"`);
      await handler.fn(ctx);
      _debug(`  ✓ Handler "${handler.id}" completed`);
    } catch (err) {
      console.error(`UESRPG | spell-tick-engine | Handler "${handler.id}" failed`, err);
    }
  }

  _debug(`══════ Dispatch complete ══════`);
}
