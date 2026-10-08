import { isEffectCurrentlyApplicable } from "../../../../core/active-effects/collect.js";
import { SYSTEM_ID } from "../../../../core/system/namespace.js";

/**
 * Build a normalized AppV2 part-request scope for context preparation.
 * Returns a `needs(part)` predicate that is true for full renders or when a part
 * is explicitly requested in partial render cycles.
 */
export function createPartContextScope({ options, partDefinitions, fallbackTotal = 0 } = {}) {
  const requested = Array.isArray(options?.parts) ? options.parts : [];
  const requestedParts = new Set(requested);
  const totalParts = Object.keys(partDefinitions ?? {}).length || fallbackTotal;
  const partialRender = requestedParts.size > 0 && requestedParts.size < totalParts;
  const needs = (part) => !partialRender || requestedParts.has(part);

  return {
    requestedParts,
    requestedList: requested,
    totalParts,
    partialRender,
    needs,
  };
}

/**
 * Select mutually exclusive full or limited Actor-sheet part descriptors before
 * HandlebarsApplication establishes the requested parts for the render cycle.
 *
 * @param {Record<string, object>} parts
 * @param {object} [options]
 * @param {boolean} [options.limited=false]
 * @param {string} [options.limitedPart="limited"]
 * @returns {Record<string, object>}
 */
export function selectDocumentSheetRenderParts(parts, {
  limited = false,
  limitedPart = "limited",
} = {}) {
  const configured = { ...(parts ?? {}) };
  if (limited) {
    return Object.hasOwn(configured, limitedPart)
      ? { [limitedPart]: configured[limitedPart] }
      : {};
  }

  delete configured[limitedPart];
  return configured;
}

/** Narrow only document-driven health refreshes on already rendered standard sheets. */
export function narrowHealthSheetRenderOptions(sheet, options, { explicitParts = false } = {}) {
  if (explicitParts || options.isFirstRender || options.force || !sheet.rendered) return;
  if (!game.user?.isGM && sheet.document?.limited) return;
  if (options.renderContext !== "updateActor" || !options.renderData) return;
  const keys = Object.keys(foundry.utils.flattenObject(options.renderData)).filter(key => key !== "_id");
  const healthPaths = new Set(["system.hp.value", "system.tempHP", "system.hp.temp"]);
  if (!keys.some(key => healthPaths.has(key))) return;
  const receiptPath = `flags.${SYSTEM_ID}.damageApplications`;
  if (!keys.every(key => healthPaths.has(key) || key === receiptPath || key.startsWith(`${receiptPath}.`))) return;
  // Includes transferred effects; unknown applicability retains the full render.
  if (typeof sheet.document?.allApplicableEffects !== "function") return;
  for (const effect of sheet.document.allApplicableEffects()) {
    if (isEffectCurrentlyApplicable(effect)) return;
  }
  options.parts = ["sidebar", "combat"];
}
