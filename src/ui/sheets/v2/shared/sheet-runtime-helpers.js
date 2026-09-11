import { isPerfEnabled, perfRecord } from "../../../../utils/perf-tracker.js";
import { localizeChoiceObject, t } from "../../../../utils/i18n.js";

export function localizeSheetChoiceLabels(source, prefix) {
  return localizeChoiceObject(source, prefix);
}

export function resolveCarryRatingDisplayLabel(carryRating) {
  const fallback = String(carryRating?.label ?? "").trim();
  const key = fallback.toLowerCase();
  const normalizedKey = {
    minimal: "minimal",
    moderate: "moderate",
    severe: "severe",
    crushing: "crushing",
  }[key];
  if (!normalizedKey) return fallback;
  return t(`UESRPG.Choices.CarryRating.${normalizedKey}`, fallback);
}

export function resolveWeaponDistanceHeaderLabel(weaponBuckets) {
  const equipped = Array.isArray(weaponBuckets?.equipped) ? weaponBuckets.equipped : [];
  const unequipped = Array.isArray(weaponBuckets?.unequipped) ? weaponBuckets.unequipped : [];
  const weapons = [...equipped, ...unequipped];
  if (!weapons.length) return t("UESRPG.Sheets.Equipment.Distance", "Distance");

  let hasRanged = false;
  let hasMelee = false;
  for (const weapon of weapons) {
    const mode = String(weapon?.system?.attackMode ?? "").toLowerCase();
    if (mode === "ranged") hasRanged = true;
    else hasMelee = true;
    if (hasRanged && hasMelee) return t("UESRPG.Sheets.Equipment.Distance", "Distance");
  }

  if (hasRanged) return t("UESRPG.Sheets.Equipment.Range", "Range");
  if (hasMelee) return t("UESRPG.Sheets.Equipment.Reach", "Reach");
  return t("UESRPG.Sheets.Equipment.Distance", "Distance");
}

export function renderedPartsSet(options) {
  const parts = options?.parts;
  return Array.isArray(parts) && parts.length ? new Set(parts) : null;
}

export function partRendered(options, part) {
  const rendered = renderedPartsSet(options);
  if (!rendered) return true;
  return rendered.has(part);
}

function normalizeRenderParts(sheet, parts = []) {
  const validParts = sheet?.constructor?.PARTS ? new Set(Object.keys(sheet.constructor.PARTS)) : null;
  const out = [];
  for (const part of parts) {
    const key = String(part ?? "").trim();
    if (!key) continue;
    if (validParts && !validParts.has(key)) return null;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

const renderQueueStates = new WeakMap();
const closedRenderQueues = new WeakSet();

function createRenderQueueState() {
  return {
    activeResolvers: [],
    cancelled: false,
    draining: false,
    queuedParts: new Set(),
    queuedResolvers: [],
    rafId: null,
  };
}

function getRenderQueueState(sheet) {
  if (closedRenderQueues.has(sheet)) return null;
  let state = renderQueueStates.get(sheet);
  if (!state) {
    state = createRenderQueueState();
    renderQueueStates.set(sheet, state);
  }
  return state;
}

function settleResolvers(resolvers = []) {
  for (const resolve of resolvers.splice(0)) {
    try {
      resolve();
    } catch (_err) {
      // Promise resolvers are expected to be inert, but one must not block the rest.
    }
  }
}

async function renderQueuedParts(sheet, state, queued) {
  if (state.cancelled || closedRenderQueues.has(sheet)) return;
  try {
    if (queued === null) await sheet.render(true);
    else if (queued.length) await sheet.render({ parts: queued });
    return;
  } catch (partialError) {
    if (state.cancelled || closedRenderQueues.has(sheet)) return;
    try {
      await sheet.render(true);
      console.warn("UESRPG | Partial sheet render failed; full render fallback succeeded.", partialError);
      return;
    } catch (fullError) {
      console.error("UESRPG | Partial and full sheet renders failed.", { partialError, fullError });
    }
  }
}

function scheduleRenderQueueDrain(sheet, state) {
  if (state.cancelled || state.draining || state.rafId != null || !state.queuedResolvers.length) return;

  state.rafId = requestAnimationFrame(async () => {
    state.rafId = null;
    if (state.cancelled) {
      settleResolvers(state.queuedResolvers);
      state.queuedParts.clear();
      return;
    }

    const queued = normalizeRenderParts(sheet, Array.from(state.queuedParts));
    state.queuedParts.clear();
    state.activeResolvers = state.queuedResolvers.splice(0);
    state.draining = true;

    try {
      await renderQueuedParts(sheet, state, queued);
    } finally {
      settleResolvers(state.activeResolvers);
      state.draining = false;
      if (!state.cancelled && state.queuedResolvers.length) scheduleRenderQueueDrain(sheet, state);
    }
  });
}

export async function queueRenderParts(sheet, parts = []) {
  if (!Array.isArray(parts) || !parts.length) return;
  const state = getRenderQueueState(sheet);
  if (!state) return;
  for (const part of parts) state.queuedParts.add(part);

  const promise = new Promise((resolve) => state.queuedResolvers.push(resolve));
  scheduleRenderQueueDrain(sheet, state);
  return promise;
}

export function clearQueuedRenderPartsState(sheet) {
  closedRenderQueues.add(sheet);
  const state = renderQueueStates.get(sheet);
  if (!state) return;

  state.cancelled = true;
  if (state.rafId != null) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  state.queuedParts.clear();
  settleResolvers(state.queuedResolvers);
  settleResolvers(state.activeResolvers);
  renderQueueStates.delete(sheet);
}

export function isSheetPerfTraceEnabled(systemId) {
  try {
    return Boolean(game?.settings?.get?.(systemId, "sheetPerfTrace"));
  } catch (_e) {
    return false;
  }
}

export function traceSheetPerf(sheet, { systemId, sheetName, stage, startedAtMs, details = {} } = {}) {
  const traceEnabled = isSheetPerfTraceEnabled(systemId);
  const perfEnabled = isPerfEnabled();
  if (!traceEnabled && !perfEnabled) return;

  const elapsedMs = Number((performance.now() - startedAtMs).toFixed(2));
  const payload = {
    sheet: sheetName,
    actorId: sheet?.document?.id ?? null,
    actorName: sheet?.document?.name ?? null,
    tab: sheet?.tabGroups?.primary ?? "core",
    stage,
    elapsedMs,
    ...details,
  };

  if (perfEnabled) {
    perfRecord({
      event: `sheet.render.${sheetName}.${stage}`,
      ...payload,
      durationMs: elapsedMs,
    });
  }

  if (!traceEnabled) return;

  const warnThresholdMs = stage === "_onClose"
    ? 24
    : stage === "_onRender"
      ? 32
      : stage === "_prepareContext"
        ? 40
        : null;
  const line = `UESRPG | sheetPerfTrace ${JSON.stringify(payload)}`;
  if (warnThresholdMs !== null && elapsedMs > warnThresholdMs) console.warn(line);
  else console.log(line);
}

export function traceSheetPerfPhase(sheet, { systemId, sheetName, phase, startedAtMs, details = {} } = {}) {
  traceSheetPerf(sheet, {
    systemId,
    sheetName,
    stage: `phase:${phase}`,
    startedAtMs,
    details,
  });
}
