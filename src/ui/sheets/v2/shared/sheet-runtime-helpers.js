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

export async function queueRenderParts(sheet, parts = []) {
  if (!Array.isArray(parts) || !parts.length) return;
  if (!sheet._uesrpgQueuedParts) sheet._uesrpgQueuedParts = new Set();
  for (const part of parts) sheet._uesrpgQueuedParts.add(part);

  if (!sheet._uesrpgRenderPartsPromise) {
    sheet._uesrpgRenderPartsPromise = new Promise((resolve) => {
      sheet._uesrpgRenderPartsResolvers.push(resolve);
    });
    sheet._uesrpgRenderPartsRafId = requestAnimationFrame(async () => {
      const queued = normalizeRenderParts(sheet, Array.from(sheet._uesrpgQueuedParts ?? []));
      sheet._uesrpgQueuedParts = new Set();
      try {
        if (queued === null) await sheet.render(true);
        else if (queued.length) await sheet.render({ parts: queued });
      } catch (err) {
        console.warn("UESRPG | Partial sheet render failed; falling back to full render.", err);
        await sheet.render(true);
      } finally {
        const resolvers = sheet._uesrpgRenderPartsResolvers.splice(0);
        for (const resolve of resolvers) resolve();
        sheet._uesrpgRenderPartsPromise = null;
        sheet._uesrpgRenderPartsRafId = null;
      }
    });
  }

  return sheet._uesrpgRenderPartsPromise;
}

export function clearQueuedRenderPartsState(sheet) {
  if (sheet._uesrpgRenderPartsRafId != null) {
    cancelAnimationFrame(sheet._uesrpgRenderPartsRafId);
  }
  sheet._uesrpgRenderPartsRafId = null;
  sheet._uesrpgRenderPartsPromise = null;
  sheet._uesrpgRenderPartsResolvers = [];
  sheet._uesrpgQueuedParts = null;
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
      event: "sheet.render",
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
