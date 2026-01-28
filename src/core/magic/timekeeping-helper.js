/**
 * src/core/magic/timekeeping-helper.js
 *
 * A small, system-owned integration surface for timekeeping.
 *
 * Goals:
 * - Centralize access to Foundry's time/calendar APIs (game.time, CONFIG.time).
 * - Provide an opt-in hook for external timekeeping/calendar modules.
 * - Keep spell duration tracking deterministic (combat rounds vs world-time seconds).
 *
 * External modules (or your own integration layer) can register a provider:
 *   MagicTimekeeping.registerProvider({ id, nowWorldTimeSeconds, roundTimeSeconds?, components?, componentsToWorldTimeSeconds?, worldTimeSecondsToComponents?, formatWorldTime? })
 *
 * The provider MUST be pure (no side effects) and return numbers/objects.
 */

const _providers = [];
const _listeners = new Set();
let _hooksInstalled = false;

function _num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function _getProvider() {
  return _providers.length ? _providers[_providers.length - 1] : null;
}

function _hasCalendaria() {
  return Boolean(game?.modules?.get?.("calendaria")?.active) && typeof globalThis.CALENDARIA?.api === "object";
}

function _calendariaApi() {
  return _hasCalendaria() ? globalThis.CALENDARIA.api : null;
}

function _normalizeDayComponent(components) {
  if (!components) return null;
  const c = { ...components };
  if (c.day === undefined && c.dayOfMonth !== undefined) c.day = c.dayOfMonth;
  if (c.dayOfMonth === undefined && c.day !== undefined) c.dayOfMonth = c.day;
  return c;
}

function _detectAndRegisterModuleProviders() {
  // Calendaria: documented API surface and hooks.
  if (_hasCalendaria()) {
    const api = _calendariaApi();
    // Avoid duplicate registration if the user already registered their own provider.
    const current = _getProvider();
    if (current?.id !== "calendaria") {
      try {
        MagicTimekeeping.registerProvider({
          id: "calendaria",
          nowWorldTimeSeconds: () => {
            const dt = api.getCurrentDateTime?.();
            if (!dt) return _num(game?.time?.worldTime, 0);
            const comp = _normalizeDayComponent(dt);
            const ts = api.dateToTimestamp?.(comp);
            return _num(ts, _num(game?.time?.worldTime, 0));
          },
          roundTimeSeconds: () => Math.max(1, _num(CONFIG?.time?.roundTime, 6)),
          components: () => _normalizeDayComponent(api.getCurrentDateTime?.()) ?? null,
          componentsToWorldTimeSeconds: (components) => {
            const comp = _normalizeDayComponent(components);
            const ts = api.dateToTimestamp?.(comp);
            return _num(ts, 0);
          },
          worldTimeSecondsToComponents: (worldTimeSeconds) => {
            const comp = api.timestampToDate?.(_num(worldTimeSeconds, 0));
            return _normalizeDayComponent(comp) ?? null;
          },
          formatWorldTime: (worldTimeSeconds) => {
            const comp = api.timestampToDate?.(_num(worldTimeSeconds, 0));
            if (!comp) return String(_num(worldTimeSeconds, 0));
            return api.formatDateTime?.(_normalizeDayComponent(comp)) ?? String(_num(worldTimeSeconds, 0));
          }
        });
      } catch (err) {
        console.warn("UESRPG | MagicTimekeeping | Failed to register Calendaria provider", err);
      }
    }
  }
}

function _installHooksOnce() {
  if (_hooksInstalled) return;
  _hooksInstalled = true;

  Hooks.on("updateWorldTime", (worldTime, dt, options, userId) => {
    const payload = {
      worldTime: _num(worldTime, 0),
      dt: _num(dt, 0),
      source: "foundry",
      options,
      userId
    };
    for (const fn of _listeners) {
      try { fn(payload); } catch (err) { console.error("UESRPG | MagicTimekeeping | listener failed", err); }
    }
  });

  // Calendaria time hook is the best integration point when world time is advanced via its UI.
  Hooks.on("calendaria.dateTimeChange", (data) => {
    const payload = {
      worldTime: _num(data?.worldTime, _num(game?.time?.worldTime, 0)),
      dt: _num(data?.diff, 0),
      source: "calendaria",
      data
    };
    for (const fn of _listeners) {
      try { fn(payload); } catch (err) { console.error("UESRPG | MagicTimekeeping | listener failed", err); }
    }
  });
}

export const MagicTimekeeping = {
  /**
   * Register an external timekeeping provider.
   * The last registered provider wins.
   *
   * @param {{id: string, nowWorldTimeSeconds: () => number, roundTimeSeconds?: () => number, components?: () => object|null,
   *          componentsToWorldTimeSeconds?: (components: object) => number, worldTimeSecondsToComponents?: (seconds: number) => object|null,
   *          formatWorldTime?: (seconds: number) => string}} provider
   */
  registerProvider(provider) {
    const id = String(provider?.id ?? "").trim();
    if (!id) throw new Error("MagicTimekeeping.registerProvider requires provider.id");
    if (typeof provider?.nowWorldTimeSeconds !== "function") {
      throw new Error("MagicTimekeeping.registerProvider requires provider.nowWorldTimeSeconds()");
    }
    if (provider?.roundTimeSeconds && typeof provider.roundTimeSeconds !== "function") {
      throw new Error("MagicTimekeeping.registerProvider roundTimeSeconds must be a function");
    }
    if (provider?.components && typeof provider.components !== "function") {
      throw new Error("MagicTimekeeping.registerProvider components must be a function");
    }
    if (provider?.componentsToWorldTimeSeconds && typeof provider.componentsToWorldTimeSeconds !== "function") {
      throw new Error("MagicTimekeeping.registerProvider componentsToWorldTimeSeconds must be a function");
    }
    if (provider?.worldTimeSecondsToComponents && typeof provider.worldTimeSecondsToComponents !== "function") {
      throw new Error("MagicTimekeeping.registerProvider worldTimeSecondsToComponents must be a function");
    }
    if (provider?.formatWorldTime && typeof provider.formatWorldTime !== "function") {
      throw new Error("MagicTimekeeping.registerProvider formatWorldTime must be a function");
    }
    _providers.push({
      id,
      nowWorldTimeSeconds: provider.nowWorldTimeSeconds,
      roundTimeSeconds: provider.roundTimeSeconds,
      components: provider.components,
      componentsToWorldTimeSeconds: provider.componentsToWorldTimeSeconds,
      worldTimeSecondsToComponents: provider.worldTimeSecondsToComponents,
      formatWorldTime: provider.formatWorldTime
    });
  },

  /** Clear all providers (primarily for tests/dev). */
  clearProviders() {
    _providers.length = 0;
  },

  /** @returns {string} */
  providerId() {
    return String(_getProvider()?.id ?? "");
  },

  /**
   * Subscribe to time changes (Foundry + supported calendar modules).
   * @param {(payload: {worldTime:number, dt:number, source:string}) => void} fn
   */
  onTimeChange(fn) {
    if (typeof fn !== "function") return;
    _listeners.add(fn);
  },

  /**
   * Current World Time in seconds (provider-aware).
   * @returns {number}
   */
  nowWorldTimeSeconds() {
    const p = _getProvider();
    if (p) return _num(p.nowWorldTimeSeconds(), 0);

    // If no provider is registered, opportunistically use Calendaria if present.
    if (_hasCalendaria()) {
      const api = _calendariaApi();
      const dt = api?.getCurrentDateTime?.();
      const comp = _normalizeDayComponent(dt);
      const ts = api?.dateToTimestamp?.(comp);
      if (Number.isFinite(ts)) return _num(ts, 0);
    }
    return _num(game?.time?.worldTime, 0);
  },

  /**
   * Round length in seconds.
   * @returns {number}
   */
  roundTimeSeconds() {
    const p = _getProvider();
    if (p?.roundTimeSeconds) return Math.max(1, _num(p.roundTimeSeconds(), 6));
    return Math.max(1, _num(CONFIG?.time?.roundTime, 6));
  },

  /** @returns {boolean} */
  isCombatActive() {
    return Boolean(game?.combat);
  },

  /** @returns {number} */
  combatRound() {
    return _num(game?.combat?.round, 0);
  },

  /** @returns {number} */
  combatTurn() {
    return _num(game?.combat?.turn, 0);
  },

  /**
   * Expose Foundry's CalendarData instance (if configured).
   * This is the cleanest long-term integration point for calendaring modules.
   */
  calendar() {
    // Calendaria has its own calendar definition; expose it if active.
    const api = _calendariaApi();
    const cal = api?.getActiveCalendar?.();
    if (cal) return cal;
    return game?.time?.calendar ?? null;
  },

  /**
   * Return time components (year/month/day/hour/minute/second) if available.
   */
  components() {
    const p = _getProvider();
    if (p?.components) return p.components();

    const api = _calendariaApi();
    const c = api?.getCurrentDateTime?.();
    if (c) return _normalizeDayComponent(c);

    return game?.time?.components ?? null;
  },

  /**
   * Convert time components to world time seconds, if supported by the active provider.
   * @param {object} components
   * @returns {number|null}
   */
  componentsToWorldTimeSeconds(components) {
    const p = _getProvider();
    if (p?.componentsToWorldTimeSeconds) return _num(p.componentsToWorldTimeSeconds(components), 0);

    const api = _calendariaApi();
    const comp = _normalizeDayComponent(components);
    const ts = api?.dateToTimestamp?.(comp);
    return Number.isFinite(ts) ? _num(ts, 0) : null;
  },

  /**
   * Convert world time seconds to time components, if supported by the active provider.
   * @param {number} worldTimeSeconds
   * @returns {object|null}
   */
  worldTimeSecondsToComponents(worldTimeSeconds) {
    const p = _getProvider();
    if (p?.worldTimeSecondsToComponents) return p.worldTimeSecondsToComponents(worldTimeSeconds);

    const api = _calendariaApi();
    const comp = api?.timestampToDate?.(_num(worldTimeSeconds, 0));
    return comp ? _normalizeDayComponent(comp) : null;
  },

  /**
   * Format world time seconds to a human-readable string, if supported.
   * @param {number} worldTimeSeconds
   * @returns {string}
   */
  formatWorldTime(worldTimeSeconds) {
    const p = _getProvider();
    if (p?.formatWorldTime) return String(p.formatWorldTime(worldTimeSeconds));

    const api = _calendariaApi();
    const comp = api?.timestampToDate?.(_num(worldTimeSeconds, 0));
    if (comp && api?.formatDateTime) return String(api.formatDateTime(_normalizeDayComponent(comp)));

    return String(_num(worldTimeSeconds, 0));
  },


/**
 * Collect a best-effort set of Actors that may hold active spell effects.
 * Includes world actors and (when available) token actors on active scenes.
 *
 * This is the cleanest long-term integration point for calendaring/timekeeping modules
 * because it avoids assumptions about where effects live (world actor vs unlinked token actor).
 *
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

// Ensure hooks are installed once the game is ready, and opportunistically register module providers.
Hooks.once("ready", () => {
  try {
    _detectAndRegisterModuleProviders();
    _installHooksOnce();
  } catch (err) {
    console.error("UESRPG | MagicTimekeeping | initialization failed", err);
  }
});
