import {
  getAoeOriginMeasurementMode,
  measurePointDistance,
  measureTokenToPointDistance,
} from "../combat/opposed/range.js";

export function measureDistanceMeters(a, b) {
  return measurePointDistance(a, b, { gridSpaces: true }) ?? 0;
}

export function measurePlacementDistanceMeters({ rangeOrigin, rangeToken = null, targetPoint } = {}) {
  if (!targetPoint) return 0;

  const mode = getAoeOriginMeasurementMode();
  if (rangeToken && mode === "edge") {
    return measureTokenToPointDistance(rangeToken, targetPoint, { mode }) ?? measureDistanceMeters(rangeOrigin, targetPoint);
  }

  return measureDistanceMeters(rangeOrigin, targetPoint);
}

/**
 * Legacy compatibility helper.
 * Active runtime range gating should prefer measurePlacementDistanceMeters().
 *
 * @param {{x:number,y:number}|null} origin
 * @returns {{x:number,y:number}|null}
 */
export function resolveRangeOrigin(origin) {
  return origin ?? null;
}
