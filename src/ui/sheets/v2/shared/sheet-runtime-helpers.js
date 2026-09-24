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
const formUpdateStates = new WeakMap();

function getFormUpdateState(sheet) {
  let state = formUpdateStates.get(sheet);
  if (!state) {
    state = {
      pending: Promise.resolve(true),
      lastError: null,
      notifiedError: null,
    };
    formUpdateStates.set(sheet, state);
  }
  return state;
}

function reportFormUpdateFailure(state, error) {
  state.lastError = error;
  if (state.notifiedError === error) return;
  state.notifiedError = error;
  console.error("UESRPG | ApplicationV2 form update failed", error);
  ui.notifications?.error?.(t(
    "UESRPG.Notifications.Sheets.FormSaveFailed",
    "The document could not be saved. Review the entered values and try again."
  ));
}

/**
 * Serialize an ApplicationV2 document write with any form writes already in
 * flight for the same sheet. A rejected write is reported once and remains
 * observable to callers through {@link flushSheetFormUpdates}.
 *
 * @param {object} sheet ApplicationV2 sheet instance.
 * @param {Function} operation Async write operation.
 * @returns {Promise<*>} The operation result.
 */
export function queueSheetFormUpdate(sheet, operation) {
  if (!sheet || typeof operation !== "function") return Promise.resolve(false);
  const state = getFormUpdateState(sheet);
  const run = async () => {
    state.lastError = null;
    state.notifiedError = null;
    try {
      const result = await operation();
      if (result === false || result?.ok === false) {
        throw new Error(t(
          "UESRPG.Notifications.Sheets.FormSaveFailed",
          "The document could not be saved. Review the entered values and try again."
        ));
      }
      return result;
    } catch (error) {
      reportFormUpdateFailure(state, error);
      throw error;
    }
  };
  state.pending = state.pending.catch(() => false).then(run);
  return state.pending;
}

/** Await every queued form update for a sheet without starting a new write. */
export async function flushSheetFormUpdates(sheet) {
  const state = formUpdateStates.get(sheet);
  if (!state) return true;
  try {
    await state.pending;
    return state.lastError == null;
  } catch (error) {
    reportFormUpdateFailure(state, error);
    return false;
  }
}

/**
 * Flush queued changes and submit the current documented top-level AppV2 form.
 * The caller supplies its existing normalized submit handler so schema and
 * allow-list behavior remain owned by the sheet.
 */
export async function flushCurrentSheetForm(sheet, submitHandler, event = null) {
  if (!await flushSheetFormUpdates(sheet)) return false;
  if (!sheet?.isEditable || !sheet?.document?.isOwner) return true;
  const form = sheet.form;
  if (!(form instanceof HTMLFormElement) || !form.isConnected) return true;
  const FormDataExtended = foundry.applications?.ux?.FormDataExtended;
  if (typeof FormDataExtended !== "function" || typeof submitHandler !== "function") return false;

  try {
    const formData = new FormDataExtended(form);
    const result = await queueSheetFormUpdate(sheet, () => submitHandler.call(sheet, event, form, formData));
    return result !== false && result?.ok !== false;
  } catch (_error) {
    return false;
  }
}

export function clearSheetFormUpdateState(sheet) {
  formUpdateStates.delete(sheet);
}

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

function getRenderRoot(sheet) {
  if (sheet?.element instanceof HTMLElement) return sheet.element;
  if (sheet?.form instanceof HTMLElement) return sheet.form.closest(".application") ?? sheet.form;
  return null;
}

function escapeSelectorValue(value) {
  const textValue = String(value ?? "");
  return globalThis.CSS?.escape ? CSS.escape(textValue) : textValue.replaceAll('"', '\\"');
}

function describeElement(root, element) {
  if (!(root instanceof HTMLElement) || !(element instanceof HTMLElement) || !root.contains(element)) return null;
  const attributes = ["name", "data-role", "data-action", "data-tab", "data-item-id", "data-effect-id"];
  const selectors = [];
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute);
    if (value) selectors.push(`[${attribute}="${escapeSelectorValue(value)}"]`);
  }
  const selector = `${element.tagName.toLowerCase()}${selectors.join("")}`;
  const matches = Array.from(root.querySelectorAll(selector));
  const index = matches.indexOf(element);
  return index >= 0 ? { selector, index } : null;
}

function resolveElement(root, descriptor) {
  if (!(root instanceof HTMLElement) || !descriptor?.selector) return null;
  return root.querySelectorAll(descriptor.selector)?.[descriptor.index] ?? null;
}

function captureRenderUiState(sheet) {
  const root = getRenderRoot(sheet);
  if (!root) return null;
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const focus = describeElement(root, active);
  if (focus && active instanceof HTMLInputElement) {
    focus.selectionStart = active.selectionStart;
    focus.selectionEnd = active.selectionEnd;
  }

  const scrollSelector = [
    ".window-content",
    ".sheet-body",
    ".tab.active",
    "[data-role]",
    "[class*='__scroll']",
  ].join(",");
  const scroll = Array.from(root.querySelectorAll(scrollSelector))
    .map((element) => ({
      descriptor: describeElement(root, element),
      left: element.scrollLeft,
      top: element.scrollTop,
    }))
    .filter((entry) => entry.descriptor && (entry.left || entry.top));
  const disclosures = Array.from(root.querySelectorAll("details"))
    .map((element) => ({ descriptor: describeElement(root, element), open: element.open }))
    .filter((entry) => entry.descriptor);
  return { focus, scroll, disclosures };
}

function restoreRenderUiState(sheet, state) {
  if (!state) return;
  const root = getRenderRoot(sheet);
  if (!root) return;
  for (const entry of state.scroll ?? []) {
    const element = resolveElement(root, entry.descriptor);
    if (!(element instanceof HTMLElement)) continue;
    element.scrollLeft = entry.left;
    element.scrollTop = entry.top;
  }
  for (const entry of state.disclosures ?? []) {
    const element = resolveElement(root, entry.descriptor);
    if (element instanceof HTMLDetailsElement) element.open = entry.open;
  }
  const active = resolveElement(root, state.focus);
  if (!(active instanceof HTMLElement) || active.matches(":disabled")) return;
  active.focus({ preventScroll: true });
  if (active instanceof HTMLInputElement && Number.isInteger(state.focus?.selectionStart)) {
    active.setSelectionRange(state.focus.selectionStart, state.focus.selectionEnd);
  }
}

async function renderQueuedParts(sheet, state, queued) {
  if (state.cancelled || closedRenderQueues.has(sheet)) return;
  const uiState = captureRenderUiState(sheet);
  try {
    if (queued === null) await sheet.render(true);
    else if (queued.length) await sheet.render({ parts: queued });
    restoreRenderUiState(sheet, uiState);
    return;
  } catch (partialError) {
    if (state.cancelled || closedRenderQueues.has(sheet)) return;
    try {
      await sheet.render(true);
      restoreRenderUiState(sheet, uiState);
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
