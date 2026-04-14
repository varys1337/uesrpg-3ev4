/**
 * src/core/aoe/aoe-service.js
 *
 * Universal AoE placement service.
 * Single entry-point for all system features that produce AoE areas
 * (spells, attacks, items, powers, etc.).
 *
 * Usage:
 *   import { AoEService } from "../aoe/index.js";
 *   const result = await AoEService.place({ ... });
 *
 * Target: Foundry VTT v14.359+
 */

import { buildSourceFlags, validateAoeSpec } from "./aoe-template-data.js";
import { buildRegionData } from "./aoe-region-data.js";
import { startRegionPlacement, isRegionPlacementActive } from "./aoe-region-placement-controller.js";
import { AOE_SOURCE_TYPES } from "./aoe-constants.js";
import { collectTargetsInArea, getAoeContainmentMode } from "./containment.js";

export class AoEService {

  /**
   * Place an AoE area on the canvas.
   *
   * @param {object} params
   * @param {string}  [params.sourceType]       - "spell"|"weapon"|"item"|"power"|"other" (from AOE_SOURCE_TYPES)
   * @param {Actor}   [params.actor]            - Acting actor (optional, for metadata)
   * @param {Token}   [params.token]            - Caster/attacker token (used for origin + range gating)
   * @param {Item}    [params.item]             - Source item/spell/weapon (optional, for metadata)
   * @param {object}  params.aoe                - AoE specification
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

    const result = buildRegionData({
      origin: placementOrigin,
      aoe: {
        shape: aoe.shape,
        distance: aoe.distance ?? aoe.size ?? aoe.sizeMeters,
        width: aoe.width ?? aoe.widthMeters,
        angle: aoe.angle,
        direction: aoe.direction,
      },
      flags: sourceFlags,
      name: item?.name ?? "Area Effect",
    });

    if (!result) {
      ui.notifications?.warn("Failed to build AoE region data.");
      return null;
    }

    // --- Place the area ---
    const placementResult = await startRegionPlacement({
      origin: placementOrigin,
      aoe: {
        shape: aoe.shape,
        distance: aoe.distance ?? aoe.size ?? aoe.sizeMeters,
        width: aoe.width ?? aoe.widthMeters,
        angle: aoe.angle,
        direction: aoe.direction,
      },
      userOverrides: { color: result.data?.color ?? null },
      flags: sourceFlags,
      name: item?.name ?? "Area Effect",
    }, {
      maxRangeMeters: options.maxRange ?? null,
      rangeOrigin: placementOrigin,
      rangeToken: token ?? null,
      snapToGrid: Boolean(options.snapToGrid),
      lockPosition: isPulse,
    });

    if (!placementResult) return null; // Canceled

    // --- Collect affected targets ---
    const collectTargets = options.collectTargets !== false;
    let targets = [];

    if (collectTargets) {
      targets = await collectTargetsInArea(placementResult.regionDoc, {
        isPulse,
        includeCaster,
        casterTokenId: token?.id ?? token?.document?.id ?? null,
        containmentMode: getAoeContainmentMode(),
      });
    }

    return {
      regionDoc: placementResult.regionDoc,
      regionId: placementResult.regionDoc?.id ?? null,
      regionUuid: placementResult.regionDoc?.uuid ?? null,
      areaDoc: placementResult.regionDoc,
      areaId: placementResult.regionDoc?.id ?? null,
      areaUuid: placementResult.regionDoc?.uuid ?? null,
      areaType: "region",
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
    return isRegionPlacementActive();
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

/**
 * @typedef {object} AoEPlacementResult
 * @property {RegionDocument}       regionDoc  - The created region document
 * @property {string|null}          regionId   - ID of the region
 * @property {string|null}          regionUuid - UUID of the region
 * @property {RegionDocument}       areaDoc    - Neutral alias for the created area
 * @property {string|null}          areaId     - Neutral alias for the area ID
 * @property {string|null}          areaUuid   - Neutral alias for the area UUID
 * @property {string}               areaType   - "region"
 * @property {object}               data       - The raw region data used
 * @property {Token[]}              targets    - Tokens within the area
 * @property {{x:number,y:number}}  origin     - The placement origin
 */
