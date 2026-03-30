/**
 * src/core/aoe/aoe-service.js
 *
 * Universal AoE placement service.
 * Single entry-point for all system features that produce AoE templates
 * (spells, attacks, items, powers, etc.).
 *
 * Usage:
 *   import { AoEService } from "../aoe/index.js";
 *   const result = await AoEService.place({ ... });
 *
 * Target: Foundry VTT v13.351
 */

import { buildTemplateData, buildSourceFlags, validateAoeSpec, normalizeShape } from "./aoe-template-data.js";
import { startPlacement, isPlacementActive } from "./aoe-placement-controller.js";
import { FLAG_NAMESPACE, AOE_SOURCE_TYPES } from "./aoe-constants.js";
import { collectTargetsInTemplate, getAoeContainmentMode } from "./containment.js";

export class AoEService {

  /**
   * Place an AoE template on the canvas.
   *
   * @param {object} params
   * @param {string}  [params.sourceType]       - "spell"|"weapon"|"item"|"power"|"other" (from AOE_SOURCE_TYPES)
   * @param {Actor}   [params.actor]            - Acting actor (optional, for metadata)
   * @param {Token}   [params.token]            - Caster/attacker token (used for origin + range gating)
   * @param {Item}    [params.item]             - Source item/spell/weapon (optional, for metadata)
   * @param {object}  params.aoe               - AoE specification
   * @param {string}  params.aoe.shape          - Template shape (circle/cone/ray/rect or aliases)
   * @param {number}  params.aoe.distance       - Distance/radius in scene units (meters)
   * @param {number}  [params.aoe.width]        - Width for ray/rect
   * @param {number}  [params.aoe.angle]        - Angle for cone
   * @param {number}  [params.aoe.direction]    - Initial direction (degrees)
   * @param {boolean} [params.aoe.pulse]        - If true, center on token and skip interactive placement
   * @param {boolean} [params.aoe.includeCaster]- Whether to include caster in affected targets (for pulse)
   * @param {{x:number,y:number}} [params.origin] - Explicit origin override (default: token center)
   * @param {object}  [params.flags]            - Additional flags to attach to the template
   * @param {object}  [params.options]          - Placement options
   * @param {number}  [params.options.maxRange] - Max range in meters (overrides item-derived range)
   * @param {boolean} [params.options.snapToGrid] - Snap placement to grid
   * @param {boolean} [params.options.collectTargets] - Auto-collect tokens within the template (default: true)
   * @returns {Promise<AoEPlacementResult|null>} Placement result or null if canceled/failed
   */
  static async place({
    sourceType = AOE_SOURCE_TYPES.OTHER,
    actor = null,
    token = null,
    item = null,
    aoe,
    origin = null,
    flags = {},
    options = {},
  } = {}) {
    // --- Validation ---
    const specErrors = validateAoeSpec(aoe);
    if (specErrors.length) {
      for (const err of specErrors) ui.notifications?.warn(err);
      return null;
    }

    if (!canvas?.scene) {
      ui.notifications?.warn("No active Scene.");
      return null;
    }

    // --- Derive origin ---
    const tokenCenter = token?.center ?? token?.object?.center ?? null;
    const placementOrigin = origin ?? tokenCenter;

    if (!placementOrigin) {
      ui.notifications?.warn("Cannot determine placement origin. Select a token or provide coordinates.");
      return null;
    }

    // --- Determine placement mode ---
    const isPulse = Boolean(aoe.pulse);
    const includeCaster = Boolean(aoe.includeCaster);

    // --- Build source flags ---
    const sourceFlags = buildSourceFlags({
      sourceType,
      sourceUuid: item?.uuid ?? null,
      sourceId: item?.id ?? null,
      sourceName: item?.name ?? null,
      casterTokenId: token?.id ?? token?.document?.id ?? null,
      casterActorId: actor?.id ?? null,
      damageType: item?.system?.damageType ?? null,
      pulse: isPulse,
      includeCaster,
      extra: flags,
    });

    // --- Build template data ---
    const result = buildTemplateData({
      origin: placementOrigin,
      aoe: {
        shape: aoe.shape,
        distance: aoe.distance ?? aoe.size ?? aoe.sizeMeters,
        width: aoe.width ?? aoe.widthMeters,
        angle: aoe.angle,
        direction: aoe.direction,
      },
      flags: sourceFlags,
    });

    if (!result) {
      ui.notifications?.warn("Failed to build AoE template data.");
      return null;
    }

    // --- Place the template ---
    const placementResult = await startPlacement(result.data, {
      maxRangeMeters: options.maxRange ?? null,
      rangeOrigin: placementOrigin,
      snapToGrid: Boolean(options.snapToGrid),
      lockPosition: isPulse,
    });

    if (!placementResult) return null; // Canceled

    // --- Collect affected targets ---
    const collectTargets = options.collectTargets !== false;
    let targets = [];

    if (collectTargets) {
      targets = await collectTargetsInTemplate(placementResult.templateDoc, {
        isPulse,
        includeCaster,
        casterTokenId: token?.id ?? token?.document?.id ?? null,
        containmentMode: getAoeContainmentMode(),
      });
    }

    return {
      templateDoc: placementResult.templateDoc,
      templateId: placementResult.templateDoc?.id ?? null,
      templateUuid: placementResult.templateDoc?.uuid ?? null,
      data: placementResult.data,
      targets,
      origin: placementOrigin,
    };
  }

  /**
   * Check if a placement is currently in progress.
   * @returns {boolean}
   */
  static get isActive() {
    return isPlacementActive();
  }

  /**
   * Validate an AoE spec without placing.
   * @param {object} aoe
   * @returns {string[]} Array of error strings (empty = valid)
   */
  static validateAoeSpec(aoe) {
    return validateAoeSpec(aoe);
  }
}

// ──────────────────────────── Internal Helpers ────────────────────────────

/**
 * Collect tokens that fall within a placed template's area.
 *
 * @param {MeasuredTemplateDocument} templateDoc
 * @param {object} opts
 * @param {boolean} opts.isPulse
 * @param {boolean} opts.includeCaster
 * @param {string|null} opts.casterTokenId
 * @returns {Promise<Token[]>}
 */
async function _collectTargetsInTemplate(templateDoc, { isPulse, includeCaster, casterTokenId }) {
  // Wait for the template object to render on canvas
  const templateObj = await _awaitTemplateObject(templateDoc.id);
  if (!templateObj?.shape || typeof templateObj.shape.contains !== "function") {
    // Fallback: use Foundry v13 testPoint if available
    if (typeof templateObj?.testPoint !== "function") {
      ui.notifications?.info("Template placed, but could not determine affected tokens.");
      return [];
    }
  }

  const tokens = canvas.tokens?.placeables ?? [];
  const affected = [];

  for (const tok of tokens) {
    if (!tok) continue;

    const inside = _isTokenInTemplate(tok, templateObj);
    if (inside) affected.push(tok);
  }

  // Handle pulse caster inclusion/exclusion
  if (isPulse && casterTokenId) {
    const isCaster = (t) => (t?.id ?? t?.document?.id) === casterTokenId;
    const already = affected.some(isCaster);

    if (!includeCaster && already) {
      // Remove caster
      for (let i = affected.length - 1; i >= 0; i--) {
        if (isCaster(affected[i])) affected.splice(i, 1);
      }
    } else if (includeCaster && !already) {
      // Add caster
      const casterTok = tokens.find(isCaster);
      if (casterTok) affected.push(casterTok);
    }
  }

  return affected;
}

/**
 * Test whether a token is inside a template.
 *
 * Mode is determined by the `aoeContainmentMode` setting:
 * - "true-radius" (default): multi-point sampling (center, corners, edge midpoints).
 *   Token is inside if ANY sample point falls within the template shape.
 * - "grid-aware": token is inside if the template shape overlaps any grid
 *   cell occupied by the token (D&D/PF2e style).
 *
 * @param {Token} tokObj
 * @param {MeasuredTemplate} templateObj
 * @returns {boolean}
 */
function _isTokenInTemplate(tokObj, templateObj) {
  const mode = _getAoeContainmentMode();
  if (mode === "grid-aware") return _isTokenInTemplateGridAware(tokObj, templateObj);
  return _isTokenInTemplateTrueRadius(tokObj, templateObj);
}

/**
 * True-radius (geometric multi-point sampling) containment check.
 * @param {Token} tokObj
 * @param {MeasuredTemplate} templateObj
 * @returns {boolean}
 */
function _isTokenInTemplateTrueRadius(tokObj, templateObj) {
  // Use v13 testPoint API if available — but guard against uninitialized shape
  if (typeof templateObj.testPoint === "function" && templateObj.shape) {
    try {
      const c = tokObj.center;
      if (c && templateObj.testPoint(c)) return true;
    } catch (_e) {
      // testPoint may throw if shape is not yet ready; fall through to manual check
    }
  }

  // Fallback: manual shape.contains check with multi-point sampling
  if (!templateObj.shape || typeof templateObj.shape.contains !== "function") return false;

  const c = tokObj.center;
  if (!c) return false;

  const w = Number(tokObj.w ?? tokObj.width ?? 0);
  const h = Number(tokObj.h ?? tokObj.height ?? 0);
  const x0 = Number(tokObj.x ?? (c.x - w / 2));
  const y0 = Number(tokObj.y ?? (c.y - h / 2));

  const points = [
    { x: c.x, y: c.y }, // Center
  ];

  if (w > 0 && h > 0) {
    // Corners
    points.push(
      { x: x0, y: y0 },
      { x: x0 + w, y: y0 },
      { x: x0, y: y0 + h },
      { x: x0 + w, y: y0 + h },
    );
    // Edge midpoints
    points.push(
      { x: x0 + w / 2, y: y0 },
      { x: x0 + w / 2, y: y0 + h },
      { x: x0, y: y0 + h / 2 },
      { x: x0 + w, y: y0 + h / 2 },
    );
  }

  for (const p of points) {
    if (templateObj.shape.contains(p.x - templateObj.x, p.y - templateObj.y)) {
      return true;
    }
  }

  return false;
}

/**
 * Grid-aware containment: token is inside if the template overlaps any grid
 * cell the token occupies.  For each cell center, check shape.contains().
 * @param {Token} tokObj
 * @param {MeasuredTemplate} templateObj
 * @returns {boolean}
 */
function _isTokenInTemplateGridAware(tokObj, templateObj) {
  if (!templateObj.shape || typeof templateObj.shape.contains !== "function") return false;
  if (!canvas?.grid) return _isTokenInTemplateTrueRadius(tokObj, templateObj);

  const gridSize = canvas.grid.size ?? canvas.grid.sizeX ?? 100;
  const tokDoc = tokObj.document ?? tokObj;
  const w = Number(tokDoc.width ?? 1);
  const h = Number(tokDoc.height ?? 1);
  const tokX = Number(tokObj.x ?? 0);
  const tokY = Number(tokObj.y ?? 0);

  // Iterate each grid cell the token occupies
  for (let col = 0; col < w; col++) {
    for (let row = 0; row < h; row++) {
      // Cell center in canvas coordinates
      const cx = tokX + (col + 0.5) * gridSize;
      const cy = tokY + (row + 0.5) * gridSize;
      // Convert to template-local coordinates
      if (templateObj.shape.contains(cx - templateObj.x, cy - templateObj.y)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Read the aoeContainmentMode setting with safe fallback.
 * @returns {"true-radius"|"grid-aware"}
 */
function _getAoeContainmentMode() {
  try {
    return game.settings?.get?.("uesrpg-3ev4", "aoeContainmentMode") ?? "true-radius";
  } catch (_e) {
    return "true-radius";
  }
}

/**
 * Wait for a MeasuredTemplate object to become available on the canvas.
 * @param {string} templateId
 * @param {number} [maxAttempts=20]
 * @returns {Promise<MeasuredTemplate|null>}
 */
async function _awaitTemplateObject(templateId, maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i++) {
    const obj =
      canvas.templates?.get?.(templateId) ??
      canvas.templates?.placeables?.find?.(t => t?.document?.id === templateId) ??
      null;
    if (obj) {
      // Wait for the shape to be computed (happens during draw/refresh cycle)
      if (obj.shape && typeof obj.shape.contains === "function") return obj;
      // Shape not ready yet — give the render cycle a tick
      await new Promise((r) => setTimeout(r, 50));
      if (obj.shape && typeof obj.shape.contains === "function") return obj;
      // Still no shape? Try triggering a refresh
      try { obj.renderFlags?.set?.({ refreshShape: true }); } catch (_e) { /* */ }
      await new Promise((r) => setTimeout(r, 50));
      if (obj.shape) return obj;
      // Return anyway — _isTokenInTemplate has its own guards
      return obj;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

/**
 * @typedef {object} AoEPlacementResult
 * @property {MeasuredTemplateDocument} templateDoc  - The created template document
 * @property {string|null}              templateId   - ID of the template
 * @property {string|null}              templateUuid - UUID of the template
 * @property {object}                   data         - The raw template data used
 * @property {Token[]}                  targets      - Tokens within the template area
 * @property {{x:number,y:number}}      origin       - The placement origin
 */
