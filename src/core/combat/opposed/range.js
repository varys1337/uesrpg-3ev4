/**
 * src/core/combat/opposed/range.js
 * Range and reach measurement utilities for tokens of varying sizes
 * Supports both center-to-center and edge-to-edge measurement modes
 */

import { SYSTEM_ID } from "./constants.js";

/**
 * Measure distance between two tokens accounting for their sizes.
 * Uses system setting to determine measurement mode:
 *  - "center": Always use center points (legacy behavior, treats all tokens as 1x1)
 *  - "edge": Measure from nearest edges (D&D/PF2e standard for tokens >1x1)
 * 
 * @param {Token} tokenA - First token
 * @param {Token} tokenB - Second token
 * @returns {number|null} Distance in grid units, or null if measurement fails
 */
export function measureTokenDistance(tokenA, tokenB) {
  try {
    if (!tokenA || !tokenB) return null;
    if (!canvas?.ready) return null;

    const mode = game.settings.get(SYSTEM_ID, "tokenRangeMeasurement") ?? "center";

    if (mode === "center") {
      // Legacy center-to-center measurement
      const a = tokenA?.center ?? tokenA?.object?.center ?? null;
      const b = tokenB?.center ?? tokenB?.object?.center ?? null;
      return _measurePointDistance(a, b);
    }

    // Edge-to-edge measurement for larger tokens
    return _measureTokenDistanceEdgeToEdge(tokenA, tokenB);
  } catch (err) {
    console.warn("UESRPG | Failed to measure token distance", err);
    return null;
  }
}

/**
 * Measure distance from nearest edges of two tokens (D&D/PF2e standard).
 * For 1x1 tokens, this is equivalent to center-to-center.
 * For larger tokens, finds the shortest distance between their bounding boxes.
 * 
 * @private
 */
function _measureTokenDistanceEdgeToEdge(tokenA, tokenB) {
  try {
    // Get token bounds
    const a = tokenA?.document ?? tokenA;
    const b = tokenB?.document ?? tokenB;
    
    if (!a || !b) return null;

    // Token positions and dimensions (in grid units)
    const aX = Number(a.x ?? 0);
    const aY = Number(a.y ?? 0);
    const aWidth = Number(a.width ?? 1);
    const aHeight = Number(a.height ?? 1);

    const bX = Number(b.x ?? 0);
    const bY = Number(b.y ?? 0);
    const bWidth = Number(b.width ?? 1);
    const bHeight = Number(b.height ?? 1);

    // Grid configuration
    const gridSize = Number(canvas?.scene?.grid?.size ?? 1);
    const gridDistance = Number(canvas?.scene?.grid?.distance ?? 5);
    const gridType = canvas?.grid?.type ?? CONST.GRID_TYPES.SQUARE;

    if (gridSize <= 0 || gridDistance <= 0) return null;

    // Convert grid units to pixels
    const aLeft = aX;
    const aRight = aX + (aWidth * gridSize);
    const aTop = aY;
    const aBottom = aY + (aHeight * gridSize);

    const bLeft = bX;
    const bRight = bX + (bWidth * gridSize);
    const bTop = bY;
    const bBottom = bY + (bHeight * gridSize);

    // For square/gridless grids, use simple bounding box distance
    if (gridType === CONST.GRID_TYPES.SQUARE || gridType === CONST.GRID_TYPES.GRIDLESS) {
      // Find closest points on each bounding box
      const closestAX = Math.max(aLeft, Math.min(bLeft + (bRight - bLeft) / 2, aRight));
      const closestAY = Math.max(aTop, Math.min(bTop + (bBottom - bTop) / 2, aBottom));
      const closestBX = Math.max(bLeft, Math.min(aLeft + (aRight - aLeft) / 2, bRight));
      const closestBY = Math.max(bTop, Math.min(aTop + (aBottom - aTop) / 2, bBottom));

      // Calculate distance between closest points
      const dx = closestBX - closestAX;
      const dy = closestBY - closestAY;
      const pixelDistance = Math.hypot(dx, dy);

      // Convert to grid distance
      const spaces = pixelDistance / gridSize;
      return spaces * gridDistance;
    }

    // For hex grids, use Foundry's built-in measurement
    if (gridType === CONST.GRID_TYPES.HEXODDR || gridType === CONST.GRID_TYPES.HEXEVENR ||
        gridType === CONST.GRID_TYPES.HEXODDQ || gridType === CONST.GRID_TYPES.HEXEVENQ) {
      // Use center points for hex grids (edge-to-edge is complex for hex)
      const centerA = { x: aLeft + (aRight - aLeft) / 2, y: aTop + (aBottom - aTop) / 2 };
      const centerB = { x: bLeft + (bRight - bLeft) / 2, y: bTop + (bBottom - bTop) / 2 };
      return _measurePointDistance(centerA, centerB);
    }

    // Fallback: center-to-center
    const centerA = { x: aLeft + (aRight - aLeft) / 2, y: aTop + (aBottom - aTop) / 2 };
    const centerB = { x: bLeft + (bRight - bLeft) / 2, y: bTop + (bBottom - bTop) / 2 };
    return _measurePointDistance(centerA, centerB);

  } catch (err) {
    console.warn("UESRPG | Failed to measure edge-to-edge distance", err);
    return null;
  }
}

/**
 * Measure distance between two points.
 * @private
 */
function _measurePointDistance(a, b) {
  try {
    if (!a || !b) return null;

    // v13: Use namespaced Ray from foundry.canvas.geometry
    const ray = new foundry.canvas.geometry.Ray(a, b);

    // Preferred: BaseGrid.measurePath (v13+)
    const grid = canvas?.grid;
    if (grid && typeof grid.measurePath === "function") {
      const result = grid.measurePath([a, b]);
      const dist = result?.distance ?? result?.totalDistance ?? null;
      if (Number.isFinite(dist)) return dist;
    }

    // Fallback: manual calculation
    const gridSize = Number(canvas?.scene?.grid?.size ?? 0);
    const gridDistance = Number(canvas?.scene?.grid?.distance ?? 0);
    if (gridSize > 0 && gridDistance > 0) {
      const px = Math.hypot(b.x - a.x, b.y - a.y);
      const spaces = px / gridSize;
      return spaces * gridDistance;
    }

    return null;
  } catch (err) {
    console.warn("UESRPG | Failed to measure point distance", err);
    return null;
  }
}
