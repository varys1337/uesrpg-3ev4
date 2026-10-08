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
import { dispatchCombatBoundary } from "./combat-boundary-orchestrator.js";
import { CalendariaProvider } from "./providers/calendaria-provider.js";
import { _num } from "../../utils/coerce.js";
import { isPerfEnabled, monoMs, perfRecord, measurePerfStage } from "../../utils/perf-tracker.js";
import {
  buildTimePublicApi,
  combatSnapshot,
  isCombatLikeSource,
  noteEmit,
  nowMs,
  safeCallAll,
  shouldDedupe,
} from "./service-helpers.js";

import { createMessageQueue } from "../opposed/shared/message-queue.js";
import { isActiveGMUser } from "../../utils/users.js";
import { AUTHORITY_RESULT_CODES, registerAuthorityIntentCommand, registerAuthorityIntentService, requestAuthorityIntent } from "../../utils/authority-intents.js";

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
    this._ownedWorldStages = new Map();
    this._worldQueue = createMessageQueue();
    this._worldSettlements = new Map();
    this._worldWaiters = new Map();

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
    registerAuthorityIntentService();
    registerAuthorityIntentCommand("time.settle", async ({ data }) => {
      if (Object.keys(data ?? {}).some(key => !["before", "after"].includes(key)) || !Number.isFinite(data?.before) || !Number.isFinite(data?.after)) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
      const settlement = await this._waitForWorldSettlement(data.before, data.after);
      return { ok: settlement?.ok === true, data: settlement };
    });

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
  async advanceWorldTimeSeconds(deltaSeconds, options = {}) {
    this.initialize();
    const delta = _num(deltaSeconds, 0);
    const before = this.getWorldTimeSeconds();
    if (delta === 0) return before;
    try {
      let out = null;
      if (this._calendaria.isAvailable()) out = await this._calendaria.advanceTimeSeconds(delta);
      // A calendar may advance successfully without returning a timestamp.
      // Never advance twice if the confirmed clock already moved.
      if (out == null && this.getWorldTimeSeconds() === before) out = await game.time.advance(delta);
      const after = this.getWorldTimeSeconds();
      if (options.settleOwned && after !== before) await this._settleAdvancement(before, after);
      return _num(out, after);
    } catch (error) {
      const after = this.getWorldTimeSeconds();
      error.advanced = after !== before;
      error.worldTime = after;
      if (options.settleOwned) throw error;
      console.warn("UESRPG | time-service | Failed to advance world time", error);
      return after;
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
  async advanceWorldTimeToPreset(preset, options = {}) {
    this.initialize();
    const key = String(preset ?? "").trim().toLowerCase();
    const before = this.getWorldTimeSeconds();
    if (!key) return before;
    if (!this._calendaria.isAvailable()) {
      console.warn(`UESRPG | time-service | Preset advancement "${key}" requested without Calendaria`);
      return before;
    }
    try {
      const out = await this._calendaria.advanceToPreset(key);
      const after = this.getWorldTimeSeconds();
      if (options.settleOwned && after !== before) await this._settleAdvancement(before, after);
      return _num(out, after);
    } catch (error) {
      const after = this.getWorldTimeSeconds();
      error.advanced = after !== before;
      error.worldTime = after;
      if (options.settleOwned) throw error;
      console.warn("UESRPG | time-service | Preset advancement failed", error);
      return after;
    }
  }

  /** Internal ordered stages; public observation subscriptions remain separate. */
  registerOwnedWorldTimeStage({ id, order, handle }) {
    if (!id || typeof handle !== "function" || this._ownedWorldStages.has(id)) return false;
    this._ownedWorldStages.set(id, { id, order: Number(order) || 0, handle });
    return true;
  }

  async _dispatchOwnedWorldTime(payload) {
    if (!isActiveGMUser(game.user)) return { ok: true, failed: [], handledDomains: [] };
    const queuedAt = monoMs();
    return this._worldQueue("worldTime", () => measurePerfStage("worldTime", "settlement", { worldTime: payload.worldTime }, async () => {
      if (isPerfEnabled()) perfRecord({ event: "worldTime.queueWait", kind: "worldTime", worldTime: payload.worldTime, durationMs: monoMs() - queuedAt });
      const failed = [];
      const handledDomains = [];
      for (const stage of [...this._ownedWorldStages.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
        handledDomains.push(stage.id);
        try {
          const result = await measurePerfStage("worldTime", stage.id, { worldTime: payload.worldTime }, () => stage.handle(payload));
          if (result === false || result?.failed === true || result?.ok === false) throw new Error("Owned time stage reported incomplete settlement.");
        } catch (error) {
          failed.push({ id: stage.id, message: String(error.message ?? error) });
          console.error(`UESRPG | World-time stage ${stage.id} failed`, error);
        }
      }
      return { ok: failed.length === 0, failed, handledDomains };
    }));
  }

  _observeWorldChange(payload) {
    const key = `${payload.worldTime - payload.dtSeconds}->${payload.worldTime}`;
    const promise = this._emit(payload);
    this._worldSettlements.delete(key);
    this._worldSettlements.set(key, promise);
    while (this._worldSettlements.size > 100) this._worldSettlements.delete(this._worldSettlements.keys().next().value);
    for (const resolve of (this._worldWaiters.get(key) ?? [])) resolve(promise);
    this._worldWaiters.delete(key);
    void promise.catch(error => console.error("UESRPG | time dispatch failed", error));
  }

  async _waitForWorldSettlement(before, after) {
    const key = `${before}->${after}`;
    if (this._worldSettlements.has(key)) return this._worldSettlements.get(key);
    // Join an ingress which is still travelling to this client; never fabricate a tick.
    return new Promise(resolve => {
      const waiters = this._worldWaiters.get(key) ?? new Set();
      const finish = value => { clearTimeout(timer); waiters.delete(finish); if (!waiters.size) this._worldWaiters.delete(key); resolve(value); };
      const timer = setTimeout(() => finish({ ok: false, failed: [{ id: "ingress", message: "Confirmed time boundary was not observed." }] }), 5000);
      waiters.add(finish);
      this._worldWaiters.set(key, waiters);
    });
  }

  async _settleAdvancement(before, after) {
    const result = isActiveGMUser(game.user)
      ? await this._waitForWorldSettlement(before, after)
      : await requestAuthorityIntent("time.settle", { before, after }, { timeout: 60_000 });
    if (result?.ok !== true) {
      const error = new Error("World time advanced, but owned automation did not completely settle. Do not advance it again to retry cleanup.");
      error.advanced = true;
      error.worldTime = after;
      throw error;
    }
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

  async _emit(payload) {
    const p = payload ?? {};
    const _t0 = isPerfEnabled() ? monoMs() : 0;

    await dispatchCombatBoundary(p);
    const settlement = ["worldTime", "calendaria"].includes(p.source)
      ? await this._dispatchOwnedWorldTime(p) : null;
    if (settlement) { p.completion = settlement; p.handledDomains = settlement.handledDomains; }
    // Public observation follows the ordered internal consumers.
    safeCallAll("uesrpg.timeChanged", p);

    if (isCombatLikeSource(p?.source)) {
      safeCallAll("uesrpg.combatTimeChanged", p);
    }

    for (const cb of Array.from(this._listeners)) {
      try {
        Promise.resolve(cb(p)).catch((err) => console.error("UESRPG | time-service | Listener rejected", err));
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
    return settlement ?? { ok: true };
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
    this._observeWorldChange(payload);

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
    const wt = _num(data?.worldTime, this._core.getWorldTimeSeconds());
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
    this._observeWorldChange(payload);
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
    void this._emit(payload).catch((error) => console.error("UESRPG | time dispatch failed", error));

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
        prior: prior ? { ...prior } : null,
        current: current ? { ...current } : null
      }
    };

    void this._emit(payload).catch((error) => console.error("UESRPG | time dispatch failed", error));

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
