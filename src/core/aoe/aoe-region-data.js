/**
 * src/core/aoe/aoe-region-data.js
 *
 * Data normalization layer for Region-backed AoE placement.
 * Converts a system AoE spec into native Foundry v14 Region shape data.
 *
 * Target: Foundry VTT v14.359+
 */

import {
  FLAG_NAMESPACE,
  DEFAULT_FILL_COLOR,
  DEFAULT_CONE_ANGLE,
} from "./aoe-constants.js";
import { normalizeShape, validateAoeSpec } from "./aoe-template-data.js";

function _metersToPixels(distanceMeters) {
  const gridSize = Number(canvas?.grid?.size ?? 0) || 0;
  const gridDistance = Number(canvas?.scene?.grid?.distance ?? 0) || 0;
  if (!gridSize || !gridDistance) return null;
  return (Number(distanceMeters) / gridDistance) * gridSize;
}

function _buildRegionShapeData({ shape, x, y, distancePx, widthPx = null, angle = null, direction = 0 }) {
  switch (shape) {
    case "circle":
      return {
        type: "circle",
        x,
        y,
        radius: distancePx,
        gridBased: false,
      };
    case "cone":
      return {
        type: "cone",
        x,
        y,
        radius: distancePx,
        angle: Math.max(1, Number(angle ?? DEFAULT_CONE_ANGLE) || DEFAULT_CONE_ANGLE),
        rotation: direction,
        curvature: "round",
        gridBased: false,
      };
    case "ray":
      return {
        type: "line",
        x,
        y,
        length: distancePx,
        width: widthPx ?? distancePx,
        rotation: direction,
        gridBased: false,
      };
    case "rect":
      return {
        type: "rectangle",
        x,
        y,
        width: distancePx,
        height: widthPx ?? distancePx,
        anchorX: 0,
        anchorY: 0.5,
        rotation: direction,
        gridBased: false,
      };
    default:
      return null;
  }
}

export function buildRegionData({ origin, aoe, userOverrides = {}, flags = {}, name = "Area Effect" } = {}) {
  const errors = validateAoeSpec(aoe);
  if (errors.length) return null;

  const x = Number(origin?.x);
  const y = Number(origin?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const shape = normalizeShape(aoe?.shape);
  if (!shape) return null;

  const distancePx = _metersToPixels(aoe?.distance ?? aoe?.size ?? aoe?.sizeMeters);
  if (!Number.isFinite(distancePx) || distancePx <= 0) return null;

  const widthPx = (aoe?.width ?? aoe?.widthMeters) != null
    ? _metersToPixels(aoe.width ?? aoe.widthMeters)
    : null;
  const direction = Number.isFinite(Number(aoe?.direction)) ? Number(aoe.direction) : 0;
  const shapeData = _buildRegionShapeData({
    shape,
    x: Math.round(x),
    y: Math.round(y),
    distancePx,
    widthPx,
    angle: aoe?.angle,
    direction
  });
  if (!shapeData) return null;

  const regionFlags = {
    [FLAG_NAMESPACE]: {
      systemAoE: true,
      areaType: "region",
      shape,
      ...(flags ?? {})
    }
  };

  return {
    data: {
      name,
      color: userOverrides.color ?? game.user?.color ?? DEFAULT_FILL_COLOR,
      displayMeasurements: true,
      highlightMode: "coverage",
      visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 1,
      ownership: game.user?.id ? { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3 } : undefined,
      shapes: [shapeData],
      flags: regionFlags
    },
    errors: []
  };
}
