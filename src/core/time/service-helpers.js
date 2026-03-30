export function nowMs() {
  return Date.now();
}

export function safeCallAll(hookName, payload) {
  try {
    Hooks.callAll(hookName, payload);
  } catch (err) {
    console.error(`UESRPG | time-service | Hooks.callAll failed for ${hookName}`, err);
  }
}

export function combatSnapshot(combat, num) {
  const c = combat ?? game?.combat ?? null;
  if (!c) return null;
  return {
    id: c.id ?? null,
    started: Boolean(c.started),
    round: num(c.round, 0),
    turn: num(c.turn, 0),
  };
}

export function isCombatLikeSource(source) {
  const s = String(source ?? "");
  return s === "combat" || s.startsWith("combat");
}

export function shouldDedupe(lastEmit, worldTimeSeconds, source, { now = nowMs() } = {}) {
  const wt = Number(worldTimeSeconds);
  if (!Number.isFinite(wt)) return false;

  const last = lastEmit ?? {};
  if (last.worldTimeSeconds === wt && (now - Number(last.atMs ?? 0)) <= 250) {
    if (isCombatLikeSource(source) || isCombatLikeSource(last.source)) return false;
    return true;
  }
  return false;
}

export function noteEmit(worldTimeSeconds, source, { now = nowMs() } = {}) {
  const wt = Number(worldTimeSeconds);
  return {
    worldTimeSeconds: Number.isFinite(wt) ? wt : null,
    atMs: now,
    source: String(source ?? "") || null,
  };
}

export function buildTimePublicApi(service, calendariaNamespace) {
  const api = {
    getWorldTimeSeconds: service.getWorldTimeSeconds.bind(service),
    getRoundTimeSeconds: service.getRoundTimeSeconds.bind(service),
    toCalendarComponents: service.toCalendarComponents.bind(service),
    componentsToWorldTimeSeconds: service.componentsToWorldTimeSeconds.bind(service),
    format: service.format.bind(service),
    advanceWorldTimeSeconds: service.advanceWorldTimeSeconds.bind(service),
    advanceWorldTimeToPreset: service.advanceWorldTimeToPreset.bind(service),
    worldTimeSecondsToComponents: service.worldTimeSecondsToComponents.bind(service),
    formatWorldTime: service.formatWorldTime.bind(service),
    isCalendariaActive: service.isCalendariaActive.bind(service),
    getCalendariaApi: service.getCalendariaApi.bind(service),
    onTimeChange: service.onTimeChange.bind(service),
    offTimeChange: service.offTimeChange.bind(service),
    registerAdapter: service.registerAdapter.bind(service),
    unregisterAdapter: service.unregisterAdapter.bind(service),
  };

  Object.defineProperty(api, "calendaria", {
    enumerable: true,
    configurable: false,
    get: () => (service.isCalendariaActive() ? calendariaNamespace : null),
  });

  return api;
}
