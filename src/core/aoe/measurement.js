export function measureDistanceMeters(a, b) {
  if (!canvas?.grid || !a || !b) return 0;
  try {
    if (typeof canvas.grid.measurePath === "function") {
      const path = canvas.grid.measurePath([a, b], { gridSpaces: true });
      const distance = path?.distance ?? (Array.isArray(path) ? path[0] : null);
      if (Number.isFinite(distance)) return distance;
    }
  } catch (_e) {
    // Ignore and fall back to pixel math.
  }

  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  const gridSize = Number(canvas?.grid?.size ?? 0) || 0;
  const gridDistance = Number(canvas?.scene?.grid?.distance ?? 0) || 0;
  if (gridSize > 0 && gridDistance > 0) return (pixels / gridSize) * gridDistance;
  return 0;
}

export function resolveRangeOrigin(origin) {
  let useEdge = false;
  try {
    const mode = game.settings?.get?.("uesrpg-3ev4", "aoeOriginMeasurement") ?? "center";
    if (mode === "edge") {
      useEdge = true;
    } else if (mode === "match-token") {
      const tokenMode = game.settings?.get?.("uesrpg-3ev4", "tokenRangeMeasurement") ?? "center";
      useEdge = tokenMode === "edge";
    }
  } catch (_e) {
    // Settings not ready; use center.
  }
  if (!useEdge) return origin;

  const token = (canvas.tokens?.controlled ?? [])
    .find((controlled) =>
      controlled.center
      && Math.abs(controlled.center.x - origin.x) < 2
      && Math.abs(controlled.center.y - origin.y) < 2);
  if (!token) return origin;

  return origin;
}
