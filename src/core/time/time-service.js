/**
 * src/core/time/time-service.js
 *
 * System-wide timekeeping service.
 *
 * Goals:
 *  - Provide a canonical, calendar-module-agnostic API anchored to Foundry world time.
 *  - Optionally expose calendar adapters (Calendaria first) for conversions & formatting.
 *  - Centralize time-change ingress into a single dispatcher and stable system hook.
 */

import { FoundryCoreProvider } from "./providers/foundry-core-provider.js";
import { CalendariaProvider } from "./providers/calendaria-provider.js";
import { _num } from "../../utils/coerce.js";

// Reserved for future use (settings, flags, etc).
const NAMESPACE = "uesrpg-3ev4";

function _nowMs() {
  return Date.now();
}

function _safeCallAll(hookName, payload) {
  try {
    Hooks.callAll(hookName, payload);
  } catch (err) {
    console.error(`UESRPG | time-service | Hooks.callAll failed for ${hookName}`, err);
  }
}

function _combatSnapshot(combat) {
  const c = combat ?? game?.combat ?? null;
  if (!c) return null;
  return {
    id: c.id ?? null,
    started: Boolean(c.started),
    round: _num(c.round, 0),
    turn: _num(c.turn, 0)
  };
}

function _isCombatLikeSource(source) {
  const s = String(source ?? "");
  return s === "combat" || s.startsWith("combat");
}

class TimeServiceImpl {
  constructor() {
    this._core = new FoundryCoreProvider();
    this._calendaria = new CalendariaProvider();

    /** @type {Map<string, any>} */
    this._adapters = new Map();
    this._adapters.set(FoundryCoreProvider.id, this._core);

    /** @type {Set<Function>} */
    this._listeners = new Set();

    this._hooksInstalled = false;

    this._lastWorldTimeSeconds = null;
    this._lastEmit = {
      worldTimeSeconds: null,
      atMs: 0,
      source: null
    };

    this._lastCombatIntent = {
      key: null,
      atMs: 0
    };

    /** @type {object|null} */
    this._publicApi = null;

    // Stable Calendaria surface (only returned when Calendaria is actually available).
    this._calendariaNamespace = Object.freeze({
      timestampToDate: (...args) => this._calendaria.timestampToDate(...args),
      dateToTimestamp: (...args) => this._calendaria.dateToTimestamp(...args),
      formatDateTime: (...args) => this._calendaria.formatDateTime(...args),
      api: () => this.getCalendariaApi()
    });
  }

  /**
   * Initialize the service.
   * Safe to call multiple times.
   */
  initialize() {
    if (this._hooksInstalled) return;

    // Guard against multi-registration on hot reload.
    if (globalThis.__UESRPG_TIME_SERVICE_HOOKS_INSTALLED__) {
      this._hooksInstalled = true;
      return;
    }

    globalThis.__UESRPG_TIME_SERVICE_HOOKS_INSTALLED__ = true;
    this._hooksInstalled = true;

    // Fires after world time is updated (all clients). Signature: (worldTime, dt, options, userId)
    Hooks.on("updateWorldTime", (worldTime, dtSeconds, options, userId) => {
      this._handleWorldTimeUpdate(worldTime, dtSeconds, options, userId);
    });

    // Combat ingress (pre-update on initiating client, includes advanceTime/direction).
    Hooks.on("combatTurn", (combat, updateData, updateOptions) => {
      this._handleCombatIntent(combat, updateData, updateOptions, "turn");
    });

    Hooks.on("combatRound", (combat, updateData, updateOptions) => {
      this._handleCombatIntent(combat, updateData, updateOptions, "round");
    });

    // Combat ingress (post-update on all clients).
    Hooks.on("combatTurnChange", (combat, prior, current) => {
      this._handleCombatTurnChange(combat, prior, current);
    });

    // Optional calendar adapters are only safe to probe once modules are ready.
    Hooks.once("ready", () => {
      this.refreshAdapters();
      this._installCalendariaIngress();
    });
  }

  /**
   * Re-check optional adapters.
   */
  refreshAdapters() {
    if (this._calendaria.isAvailable()) {
      this._adapters.set(CalendariaProvider.id, this._calendaria);
    } else {
      this._adapters.delete(CalendariaProvider.id);
    }
  }

  /**
   * Register an external calendar adapter (for other modules).
   *
   * The adapter is never considered authoritative for world time.
   * It may provide formatting and conversions.
   *
   * @param {string} id
   * @param {object} adapter
   */
  registerAdapter(id, adapter) {
    this.initialize();
    const key = String(id ?? "").trim();
    if (!key) throw new Error("TimeService.registerAdapter requires a non-empty id");
    if (!adapter || typeof adapter !== "object") throw new Error("TimeService.registerAdapter requires an adapter object");

    // Protect core provider.
    if (key === FoundryCoreProvider.id) return;

    this._adapters.set(key, adapter);
  }

  /**
   * @param {string} id
   */
  unregisterAdapter(id) {
    const key = String(id ?? "").trim();
    if (!key) return;
    if (key === FoundryCoreProvider.id) return;
    this._adapters.delete(key);
  }

  /**
   * @returns {number}
   */
  getWorldTimeSeconds() {
    this.initialize();
    const wt = this._core.getWorldTimeSeconds();
    this._lastWorldTimeSeconds = wt;
    return wt;
  }

  /**
   * @returns {number}
   */
  getRoundTimeSeconds() {
    this.initialize();
    return this._core.getRoundTimeSeconds();
  }

  /**
   * @returns {object|null}
   */
  toCalendarComponents(worldTimeSeconds = null) {
    const t = worldTimeSeconds == null ? this.getWorldTimeSeconds() : _num(worldTimeSeconds, this.getWorldTimeSeconds());
    return this._core.timeToComponents(t);
  }

  /**
   * Alias for backwards/interop friendliness.
   * @returns {object|null}
   */
  worldTimeSecondsToComponents(worldTimeSeconds = null) {
    return this.toCalendarComponents(worldTimeSeconds);
  }

  /**
   * @param {object} components
   * @returns {number|null}
   */
  componentsToWorldTimeSeconds(components) {
    this.initialize();
    return this._core.componentsToTime(components);
  }

  /**
   * Format world time using Foundry's configured calendar.
   * @param {number|object|null} time
   * @param {string|Function|null} formatter
   * @param {object} options
   * @returns {string}
   */
  format(time = null, formatter = "timestamp", options = {}) {
    return this._core.format(time, formatter, options);
  }

  /**
   * Alias for backwards/interop friendliness.
   * @param {number|object|null} time
   * @param {string|Function|null} formatter
   * @param {object} options
   * @returns {string}
   */
  formatWorldTime(time = null, formatter = "timestamp", options = {}) {
    return this.format(time, formatter, options);
  }

  /**
   * @returns {boolean}
   */
  isCalendariaActive() {
    this.initialize();
    return this._calendaria.isAvailable();
  }

  /**
   * @returns {object|null}
   */
  getCalendariaApi() {
    return this._calendaria.getApi();
  }

  /**
   * Subscribe to normalized time change events.
   * @param {(payload: object) => void|Promise<void>} cb
   */
  onTimeChange(cb) {
    this.initialize();
    if (typeof cb !== "function") return;
    this._listeners.add(cb);
  }

  /**
   * Unsubscribe from normalized time change events.
   * @param {Function} cb
   */
  offTimeChange(cb) {
    this.initialize();
    this._listeners.delete(cb);
  }

  /**
   * @returns {object} A stable API surface for external consumers.
   */
  getPublicApi() {
    if (this._publicApi) return this._publicApi;

    // Bind methods once for stable references.
    const api = {
      // Canonical API
      getWorldTimeSeconds: this.getWorldTimeSeconds.bind(this),
      getRoundTimeSeconds: this.getRoundTimeSeconds.bind(this),
      toCalendarComponents: this.toCalendarComponents.bind(this),
      componentsToWorldTimeSeconds: this.componentsToWorldTimeSeconds.bind(this),
      format: this.format.bind(this),

      // Interop aliases
      worldTimeSecondsToComponents: this.worldTimeSecondsToComponents.bind(this),
      formatWorldTime: this.formatWorldTime.bind(this),

      isCalendariaActive: this.isCalendariaActive.bind(this),
      getCalendariaApi: this.getCalendariaApi.bind(this),

      onTimeChange: this.onTimeChange.bind(this),
      offTimeChange: this.offTimeChange.bind(this),

      // Adapter registration for other calendar modules.
      registerAdapter: this.registerAdapter.bind(this),
      unregisterAdapter: this.unregisterAdapter.bind(this)
    };

    // Only expose the Calendaria namespace when Calendaria is active and API is present.
    // This is a getter so that late module init does not permanently lock it to null.
    Object.defineProperty(api, "calendaria", {
      enumerable: true,
      configurable: false,
      get: () => (this._calendaria.isAvailable() ? this._calendariaNamespace : null)
    });

    this._publicApi = api;
    return this._publicApi;
  }

  _emit(payload) {
    const p = payload ?? {};

    // Fire system-level hook first for interop.
    _safeCallAll("uesrpg.timeChanged", p);

    if (_isCombatLikeSource(p?.source)) {
      _safeCallAll("uesrpg.combatTimeChanged", p);
    }

    for (const cb of Array.from(this._listeners)) {
      try {
        void cb(p);
      } catch (err) {
        console.error("UESRPG | time-service | Listener threw", err);
      }
    }
  }

  _shouldDedupe(worldTimeSeconds, source) {
    const wt = _num(worldTimeSeconds, null);
    if (wt == null) return false;

    const now = _nowMs();
    const last = this._lastEmit;

    // Only dedupe identical worldTime within a short window.
    if (last.worldTimeSeconds === wt && (now - _num(last.atMs, 0)) <= 250) {
      // Always allow combat-like sources to be emitted separately.
      if (_isCombatLikeSource(source) || _isCombatLikeSource(last.source)) return false;
      return true;
    }

    return false;
  }

  _noteEmit(worldTimeSeconds, source) {
    this._lastEmit = {
      worldTimeSeconds: _num(worldTimeSeconds, null),
      atMs: _nowMs(),
      source: String(source ?? "") || null
    };
  }

  _handleWorldTimeUpdate(worldTime, dtSeconds, options, userId) {
    const wt = _num(worldTime, this.getWorldTimeSeconds());
    const dt = _num(dtSeconds, 0);

    if (this._shouldDedupe(wt, "worldTime")) return;

    this._lastWorldTimeSeconds = wt;
    const payload = {
      worldTime: wt,
      dtSeconds: dt,
      source: "worldTime",
      userId: userId ?? null,
      options: options ?? null,
      combat: _combatSnapshot()
    };

    this._noteEmit(wt, "worldTime");
    this._emit(payload);
  }

  _handleCalendariaDateTimeChange(data) {
    const wt = _num(data?.worldTime, this.getWorldTimeSeconds());
    const dt = this._lastWorldTimeSeconds == null ? 0 : (wt - _num(this._lastWorldTimeSeconds, wt));

    if (this._shouldDedupe(wt, "calendaria")) return;

    this._lastWorldTimeSeconds = wt;
    const payload = {
      worldTime: wt,
      dtSeconds: _num(dt, 0),
      source: "calendaria",
      userId: data?.userId ?? null,
      options: data ?? null,
      combat: _combatSnapshot()
    };

    this._noteEmit(wt, "calendaria");
    this._emit(payload);
  }

  _installCalendariaIngress() {
    if (!this._calendaria.isAvailable()) return;

    const hookName = this._calendaria.getDateTimeChangeHookName();
    if (!hookName) return;

    Hooks.on(hookName, (data) => {
      this._handleCalendariaDateTimeChange(data);
    });
  }

  _handleCombatIntent(combat, updateData, updateOptions, kind) {
    const c = combat ?? null;
    if (!c) return;

    // Deduplicate cases where both combatTurn and combatRound can fire for the same advancement.
    const nextRound = Object.prototype.hasOwnProperty.call(updateData ?? {}, "round")
      ? _num(updateData.round, _num(c.round, 0))
      : _num(c.round, 0);

    const nextTurn = Object.prototype.hasOwnProperty.call(updateData ?? {}, "turn")
      ? _num(updateData.turn, _num(c.turn, 0))
      : _num(c.turn, 0);

    const key = `${c.id ?? ""}::${nextRound}::${nextTurn}`;
    const now = _nowMs();
    if (this._lastCombatIntent.key === key && (now - _num(this._lastCombatIntent.atMs, 0)) <= 50) return;
    this._lastCombatIntent = { key, atMs: now };

    const advanceTime = _num(updateOptions?.advanceTime, 0);
    const direction = _num(updateOptions?.direction, 1);

    const currentWorld = this.getWorldTimeSeconds();
    const predicted = currentWorld + (direction >= 0 ? advanceTime : -advanceTime);

    const src = String(kind ?? "") === "round" ? "combatRound" : "combatTurn";

    const payload = {
      worldTime: _num(predicted, currentWorld),
      dtSeconds: _num(advanceTime, 0),
      source: src,
      userId: null,
      options: updateOptions ?? null,
      combat: {
        id: c.id ?? null,
        started: Boolean(c.started),
        phase: "pre",
        round: nextRound,
        turn: nextTurn,
        priorRound: _num(c.round, 0),
        priorTurn: _num(c.turn, 0),
        advanceTime: _num(advanceTime, 0),
        direction: _num(direction, 1),
        kind: String(kind ?? "") || null
      }
    };

    // Combat intent should not be deduped against worldTime; it is semantically distinct.
    this._emit(payload);
  }

  _handleCombatTurnChange(combat, prior, current) {
    const c = combat ?? null;
    if (!c) return;

    const worldTime = this.getWorldTimeSeconds();
    const last = this._lastWorldTimeSeconds;
    const dt = last == null ? 0 : (worldTime - _num(last, worldTime));
    this._lastWorldTimeSeconds = worldTime;

    const payload = {
      worldTime,
      dtSeconds: _num(dt, 0),
      source: "combat",
      userId: null,
      options: null,
      combat: {
        id: c.id ?? null,
        started: Boolean(c.started),
        phase: "post",
        round: _num(current?.round, _num(c.round, 0)),
        turn: _num(current?.turn, _num(c.turn, 0)),
        advanceTime: null,
        direction: null,
        prior: prior ?? null,
        current: current ?? null
      }
    };

    this._emit(payload);
  }
}

export const TimeService = new TimeServiceImpl();

/**
 * Initialize and expose the time API at game.uesrpg.time.
 * @returns {object} The public API object.
 */
export function initializeTimeService() {
  TimeService.initialize();

  // Attach to system namespace for external consumers.
  if (game?.uesrpg) {
    game.uesrpg.time = TimeService.getPublicApi();
  } else {
    game.uesrpg = game.uesrpg ?? {};
    game.uesrpg.time = TimeService.getPublicApi();
  }

  return game.uesrpg.time;
}
