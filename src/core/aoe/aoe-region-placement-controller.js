/**
 * src/core/aoe/aoe-region-placement-controller.js
 *
 * Region-backed AoE placement controller.
 *
 * Target: Foundry VTT v14.359+
 */

import { measurePlacementDistanceMeters } from "./measurement.js";
import { buildRegionData } from "./aoe-region-data.js";

let _placementActive = false;

export function isRegionPlacementActive() {
  return _placementActive;
}

async function _createDirectly(regionData) {
  try {
    const docs = await canvas.scene.createEmbeddedDocuments("Region", [regionData]);
    const regionDoc = docs?.[0] ?? null;
    if (!regionDoc) return null;
    return { regionDoc, data: regionData };
  } catch (err) {
    console.error("UESRPG | AoE direct Region creation failed:", err);
    ui.notifications?.error("Failed to create AoE region.");
    return null;
  }
}

function _buildPlacementData(placement, origin, direction) {
  return buildRegionData({
    origin,
    aoe: { ...(placement?.aoe ?? {}), direction },
    userOverrides: placement?.userOverrides,
    flags: placement?.flags,
    name: placement?.name,
  })?.data ?? null;
}

function _sanitizePlacedRegionData(regionDoc) {
  const data = foundry.utils.deepClone(regionDoc?.toObject?.() ?? {});
  delete data._id;
  return data;
}

function _getPlacedOrigin(regionDoc, fallback = null) {
  const placedShape = regionDoc?.shapes?.[0] ?? regionDoc?.toObject?.()?.shapes?.[0] ?? null;
  const x = Number(placedShape?.x);
  const y = Number(placedShape?.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }
  return fallback ?? null;
}

export async function startRegionPlacement(placement, options = {}) {
  if (_placementActive) {
    ui.notifications?.warn("An AoE region placement is already in progress.");
    return null;
  }
  if (!canvas?.scene) {
    ui.notifications?.warn("No active scene.");
    return null;
  }
  if (!canvas?.regions) {
    ui.notifications?.warn("Canvas region layer is not available.");
    return null;
  }

  const {
    maxRangeMeters = null,
    rangeOrigin = null,
    rangeToken = null,
    snapToGrid = true,
    lockPosition = false,
  } = options;
  void snapToGrid;

  let nextPlacementData = _buildPlacementData(
    placement,
    placement?.origin,
    Number(placement?.aoe?.direction ?? 0) || 0,
  );
  if (!nextPlacementData) {
    ui.notifications?.warn("Failed to build AoE region data.");
    return null;
  }

  if (lockPosition) return _createDirectly(nextPlacementData);

  _placementActive = true;
  const previousActiveLayer = canvas.activeLayer ?? null;

  try {
    const shape = String(placement?.aoe?.shape ?? "").toLowerCase();
    const allowRotation = shape === "cone" || shape === "ray" || shape === "rect";

    while (true) {
      const placedRegion = await canvas.regions.placeRegion(nextPlacementData, {
        create: false,
        allowEmpty: false,
        allowRotation,
        createOptions: { controlObject: false },
      });

      if (!placedRegion) return null;

      if (Number.isFinite(maxRangeMeters) && maxRangeMeters > 0 && rangeOrigin) {
        const currentOrigin = _getPlacedOrigin(placedRegion, placement?.origin);
        const distance = measurePlacementDistanceMeters({
          rangeOrigin,
          rangeToken,
          targetPoint: currentOrigin,
        });
        if (distance > maxRangeMeters) {
          ui.notifications?.warn(`Out of range (${Math.round(distance)}m, max ${maxRangeMeters}m). Move closer or cancel.`);
          nextPlacementData = _sanitizePlacedRegionData(placedRegion);
          continue;
        }
      }

      const finalData = _sanitizePlacedRegionData(placedRegion);
      return _createDirectly(finalData);
    }
  } catch (err) {
    console.error("UESRPG | Region placement controller error:", err);
    return null;
  } finally {
    if (previousActiveLayer && typeof previousActiveLayer.activate === "function") {
      try { previousActiveLayer.activate(); } catch (_e) { /* noop */ }
    }
    _placementActive = false;
  }
}
