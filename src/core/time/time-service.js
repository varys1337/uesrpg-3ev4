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
import { isPerfEnabled, monoMs, perfRecord } from "../../utils/perf-tracker.js";
import {
  buildTimePublicApi,
  combatSnapshot,
  isCombatLikeSource,
  noteEmit,
  nowMs,
  safeCallAll,
  shouldDedupe,
} from "./service-helpers.js";

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
      advanceTimeSeconds: (...args) => this._calendaria.advanceTimeSeconds(...args),
      advanceToPreset: (...args) => this._calendaria.advanceToPreset(...args),
      getSettings: () => this._calendaria.getSettings(),
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
   * Advance world time by a number of seconds.
   * Prefers Calendaria when active, falls back to Foundry core.
   *
   * @param {number} deltaSeconds
   * @param {object} _options
   * @returns {Promise<number>} resulting world time in seconds
   */
  async advanceWorldTimeSeconds(deltaSeconds, _options = {}) {
    this.initialize();
    const delta = _num(deltaSeconds, 0);
    if (delta === 0) return this.getWorldTimeSeconds();

    if (this._calendaria.isAvailable()) {
      const out = await this._calendaria.advanceTimeSeconds(delta);
      const n = _num(out, null);
      if (n != null) return n;
    }

    try {
      const out = await game.time.advance(delta);
      return _num(out, this.getWorldTimeSeconds());
    } catch (err) {
      console.warn("UESRPG | time-service | Failed to advance world time", err);
      return this.getWorldTimeSeconds();
    }
  }

  /**
   * Advance world time to a named preset.
   * Currently relies on Calendaria when available.
   *
   * @param {string} preset
   * @param {object} _options
   * @returns {Promise<number>} resulting world time in seconds
   */
  async advanceWorldTimeToPreset(preset, _options = {}) {
    this.initialize();
    const key = String(preset ?? "").trim().toLowerCase();
    if (!key) return this.getWorldTimeSeconds();

    if (this._calendaria.isAvailable()) {
      const out = await this._calendaria.advanceToPreset(key);
      const n = _num(out, null);
      if (n != null) return n;
      console.warn(`UESRPG | time-service | Calendaria could not advance to preset "${key}"`);
      return this.getWorldTimeSeconds();
    }

    console.warn(`UESRPG | time-service | Preset advancement "${key}" requested without Calendaria`);
    return this.getWorldTimeSeconds();
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
    this._publicApi = buildTimePublicApi(this, this._calendariaNamespace);
    return this._publicApi;
  }

  _emit(payload) {
    const p = payload ?? {};
    const _t0 = isPerfEnabled() ? monoMs() : 0;

    // Fire system-level hook first for interop.
    safeCallAll("uesrpg.timeChanged", p);

    if (isCombatLikeSource(p?.source)) {
      safeCallAll("uesrpg.combatTimeChanged", p);
    }

    for (const cb of Array.from(this._listeners)) {
      try {
        void cb(p);
      } catch (err) {
        console.error("UESRPG | time-service | Listener threw", err);
      }
    }

    if (isPerfEnabled()) {
      perfRecord({
        event: "timeService.emit",
        source: p?.source ?? null,
        combatId: p?.combat?.id ?? null,
        round: p?.combat?.round ?? null,
        turn: p?.combat?.turn ?? null,
        phase: p?.combat?.phase ?? null,
        worldTime: p?.worldTime ?? null,
        dtSeconds: p?.dtSeconds ?? null,
        listenerCount: this._listeners.size,
        durationMs: monoMs() - _t0,
      });
    }
  }

  _shouldDedupe(worldTimeSeconds, source) {
    const wt = _num(worldTimeSeconds, null);
    if (wt == null) return false;

    return shouldDedupe(this._lastEmit, wt, source);
  }

  _noteEmit(worldTimeSeconds, source) {
    this._lastEmit = noteEmit(worldTimeSeconds, source);
  }

  _handleWorldTimeUpdate(worldTime, dtSeconds, options, userId) {
    const _perf = isPerfEnabled();
    const _t0 = _perf ? monoMs() : 0;
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
      combat: combatSnapshot(null, _num)
    };

    this._noteEmit(wt, "worldTime");
    this._emit(payload);

    if (_perf) {
      perfRecord({
        event: "timeService.worldTimeUpdate",
        source: "worldTime",
        worldTime: wt,
        dtSeconds: dt,
        combatId: payload.combat?.id ?? null,
        round: payload.combat?.round ?? null,
        durationMs: monoMs() - _t0,
      });
    }
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
      combat: combatSnapshot(null, _num)
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
    const _perf = isPerfEnabled();
    const _t0 = _perf ? monoMs() : 0;
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
    const now = nowMs();
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
        initiativeProvisional: true,
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

    if (_perf) {
      perfRecord({
        event: "timeService.combatIntent",
        source: src,
        combatId: c.id ?? null,
        round: nextRound,
        turn: nextTurn,
        priorRound: _num(c.round, 0),
        priorTurn: _num(c.turn, 0),
        kind: String(kind ?? "") || null,
        dtSeconds: _num(advanceTime, 0),
        durationMs: monoMs() - _t0,
      });
    }
  }

  _handleCombatTurnChange(combat, prior, current) {
    const _perf = isPerfEnabled();
    const _t0 = _perf ? monoMs() : 0;
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

    if (_perf) {
      perfRecord({
        event: "timeService.combatTurnChange",
        source: "combat",
        combatId: c.id ?? null,
        round: _num(current?.round, _num(c.round, 0)),
        turn: _num(current?.turn, _num(c.turn, 0)),
        priorRound: _num(prior?.round, null),
        priorTurn: _num(prior?.turn, null),
        worldTime,
        dtSeconds: _num(dt, 0),
        listenerCount: this._listeners.size,
        durationMs: monoMs() - _t0,
      });
    }
  }
}

export const TimeService = new TimeServiceImpl();

/**
 * Initialize and return the public time API.
 * @returns {object} The public API object.
 */
export function initializeTimeService() {
  TimeService.initialize();
  return TimeService.getPublicApi();
}
