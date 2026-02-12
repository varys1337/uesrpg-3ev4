/**
 * @module magic/timekeeping-helper
 *
 * src/core/magic/timekeeping-helper.js
 *
 * Compatibility shim for legacy magic timekeeping.
 *
 * New source of truth: src/core/time/time-service.js (TimeService)
 *
 * This file intentionally preserves the old import path and most of the historical API
 * used by magic workflows. Time ingress and cross-module integration are now provided
 * by TimeService.
 */

import { TimeService } from "../time/time-service.js";
import { _num } from "./_primitives.js";

const _LEGACY_LISTENER_MAP = new WeakMap();

/**
 * MagicTimekeeping (legacy) API.
 */
export const MagicTimekeeping = {
  /**
   * Register an additional calendar adapter/provider.
   *
   * This is retained for backwards compatibility. Prefer TimeService.registerAdapter.
   *
   * @param {object} provider
   */
  registerProvider(provider) {
    const id = String(provider?.id ?? "").trim();
    if (!id) throw new Error("MagicTimekeeping.registerProvider requires provider.id");

    // Store in the TimeService adapter registry for broader interop.
    // The adapter never becomes authoritative for world time.
    TimeService.registerAdapter(id, provider);
  },

  /**
   * @returns {number}
   */
  nowWorldTimeSeconds() {
    return TimeService.getWorldTimeSeconds();
  },

  /**
   * @returns {number}
   */
  roundTimeSeconds() {
    return TimeService.getRoundTimeSeconds();
  },

  /**
   * @returns {boolean}
   */
  isCombatActive() {
    return Boolean(game?.combat);
  },

  /**
   * @returns {number}
   */
  combatRound() {
    return _num(game?.combat?.round, 0);
  },

  /**
   * @returns {number}
   */
  combatTurn() {
    return _num(game?.combat?.turn, 0);
  },

  /**
   * Get current calendar components (from Foundry's configured calendar).
   * @returns {object|null}
   */
  components() {
    return TimeService.toCalendarComponents();
  },

  /**
   * Convert calendar components to world time seconds.
   * @param {object} components
   * @returns {number}
   */
  componentsToWorldTimeSeconds(components) {
    const ts = TimeService.componentsToWorldTimeSeconds(components);
    return _num(ts, 0);
  },

  /**
   * Convert world time seconds to calendar components.
   * @param {number} worldTimeSeconds
   * @returns {object|null}
   */
  worldTimeSecondsToComponents(worldTimeSeconds) {
    return TimeService.toCalendarComponents(worldTimeSeconds);
  },

  /**
   * Format world time using Foundry's configured calendar.
   * @param {number} worldTimeSeconds
   * @returns {string}
   */
  formatWorldTime(worldTimeSeconds) {
    return String(TimeService.format(worldTimeSeconds));
  },

  /**
   * @returns {boolean}
   */
  isCalendariaAvailable() {
    return TimeService.isCalendariaActive();
  },

  /**
   * @returns {string}
   */
  getCalendariaHookName() {
    return "calendaria.dateTimeChange";
  },

  /**
   * Subscribe to time changes.
   *
   * Legacy callback signature: (worldTimeSeconds, dtSeconds, source, payload)
   *
   * @param {Function} cb
   */
  onTimeChange(cb) {
    if (typeof cb !== "function") return;
    if (!_LEGACY_LISTENER_MAP.has(cb)) {
      _LEGACY_LISTENER_MAP.set(cb, (payload) => {
        const wt = _num(payload?.worldTime, TimeService.getWorldTimeSeconds());
        const dt = _num(payload?.dtSeconds, 0);
        const source = String(payload?.source ?? "") || "unknown";
        return cb(wt, dt, source, payload);
      });
    }

    TimeService.onTimeChange(_LEGACY_LISTENER_MAP.get(cb));
  },

  /**
   * Unsubscribe from time changes.
   * @param {Function} cb
   */
  offTimeChange(cb) {
    const wrapped = _LEGACY_LISTENER_MAP.get(cb);
    if (!wrapped) return;
    TimeService.offTimeChange(wrapped);
    _LEGACY_LISTENER_MAP.delete(cb);
  },

  /**
   * Ensure any existing magic spell effects with combat durations are anchored to the current combat.
   *
   * This is magic-domain behavior and remains in the magic subsystem.
   *
   * Note: ensureSpellEffectCombatDurations was removed as dead code. The spell
   * effect expiration system (spell-effect-expiration.js) handles combat-based
   * duration anchoring via its own hooks.  This method is retained as a no-op
   * for backward compatibility.
   */
  async ensureAllCombatDurations() {
    if (!game?.combat || !game.user?.isGM) return;
    // No-op: combat duration anchoring handled by spell-effect-expiration system.
  },

  /**
   * @returns {Set<Actor>}
   */
  collectRelevantActors() {
    const out = new Set();
    try {
      for (const a of (game.actors ?? [])) {
        if (a) out.add(a);
      }
    } catch (_e) {
      /* no-op */
    }

    // Include token actors to cover unlinked tokens and scene-only actors.
    try {
      const placeables = canvas?.tokens?.placeables;
      if (Array.isArray(placeables)) {
        for (const t of placeables) {
          const a = t?.actor;
          if (a) out.add(a);
        }
      }
    } catch (_e) {
      /* no-op */
    }

    return out;
  },

  /**
   * @returns {Actor[]}
   */
  relevantActorsArray() {
    return Array.from(MagicTimekeeping.collectRelevantActors());
  },

};
