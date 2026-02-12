/**
 * src/ui/canvas/reach-visualizer-render.js
 *
 * PIXI rendering primitives for reach visualizer overlays.
 * - Circle drawing (solid and dashed)
 * - Grid segment drawing (solid and dashed, horizontal/vertical)
 * - Edge quad drawing (solid and dashed, arbitrary angles)
 *
 * Foundry VTT v13.351 compatible.
 */

/* -------------------------------------------- */
/* Circle Rendering                             */
/* -------------------------------------------- */

/**
 * Draw a dashed circle using arc segments.
 * @param {PIXI.Graphics} g - Graphics object to draw on
 * @param {number} radiusPx - Radius in pixels
 * @param {number} dashPx - Length of each dash
 * @param {number} gapPx - Length of gap between dashes
 */
export function drawDashedCircle(g, radiusPx, dashPx = 10, gapPx = 6) {
  const r = Number(radiusPx);
  if (!Number.isFinite(r) || r <= 0) return;

  const circumference = 2 * Math.PI * r;
  const step = dashPx + gapPx;
  const n = Math.max(8, Math.floor(circumference / step));
  const dashAngle = (dashPx / circumference) * (2 * Math.PI);
  const gapAngle = (gapPx / circumference) * (2 * Math.PI);
  let angle = 0;

  for (let i = 0; i < n; i++) {
    const a0 = angle;
    const a1 = angle + dashAngle;
    const x0 = Math.cos(a0) * r;
    const y0 = Math.sin(a0) * r;
    g.moveTo(x0, y0);
    g.arc(0, 0, r, a0, a1);
    angle += dashAngle + gapAngle;
  }
}

/**
 * Draw a dashed line segment.
 * @param {PIXI.Graphics} g - Graphics object
 * @param {number} x1 - Start X
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 * @param {number} dashPx - Dash length
 * @param {number} gapPx - Gap length
 */
export function drawDashedSegment(g, x1, y1, x2, y2, dashPx = 10, gapPx = 6) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!len) return;

  const step = dashPx + gapPx;
  const ux = dx / len;
  const uy = dy / len;

  let dist = 0;
  while (dist < len) {
    const d0 = dist;
    const d1 = Math.min(len, dist + dashPx);
    g.moveTo(x1 + ux * d0, y1 + uy * d0);
    g.lineTo(x1 + ux * d1, y1 + uy * d1);
    dist += step;
  }
}

/* -------------------------------------------- */
/* Grid Segment Rendering                       */
/* -------------------------------------------- */

/**
 * Draw solid grid-aligned segments (horizontal/vertical) using filled rectangles
 * for crisp, continuous borders without PIXI stroke seams.
 * @param {PIXI.Graphics} g - Graphics object
 * @param {Array<[number,number,number,number]>} segments - Array of [x1,y1,x2,y2] segments
 * @param {number} widthPx - Line width in pixels
 * @param {number} color - Color as hex number (e.g., 0xff3355)
 */
export function drawSolidGridSegments(g, segments, widthPx, color) {
  const w = Math.max(1, Math.round(Number(widthPx) || 1));
  const half = w / 2;
  const eps = 1e-6;

  // Use filled rectangles for crisp, continuous borders (avoids PIXI stroke seams).
  g.beginFill(color, 1.0);
  for (const seg of (segments ?? [])) {
    const [x1, y1, x2, y2] = seg;
    if (Math.abs(y1 - y2) <= eps) {
      // horizontal
      const y = y1;
      const xStart = Math.min(x1, x2);
      const len = Math.abs(x2 - x1);
      if (len > eps) g.drawRect(xStart, y - half, len, w);
    } else if (Math.abs(x1 - x2) <= eps) {
      // vertical
      const x = x1;
      const yStart = Math.min(y1, y2);
      const len = Math.abs(y2 - y1);
      if (len > eps) g.drawRect(x - half, yStart, w, len);
    } else {
      // Unexpected diagonal: fallback to a stroke.
      g.endFill();
      g.lineStyle({ width: w, color, alpha: 1.0 });
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.lineStyle();
      g.beginFill(color, 1.0);
    }
  }
  g.endFill();
}

/**
 * Draw dashed grid-aligned segments using filled rectangles.
 * @param {PIXI.Graphics} g - Graphics object
 * @param {Array<[number,number,number,number]>} segments - Array of [x1,y1,x2,y2] segments
 * @param {number} widthPx - Line width
 * @param {number} color - Color as hex number
 * @param {number} dashPx - Dash length (null = auto-calculate from grid size)
 * @param {number} gapPx - Gap length (null = same as dashPx)
 */
export function drawDashedGridSegments(g, segments, widthPx, color, dashPx = null, gapPx = null) {
  const w = Math.max(1, Math.round(Number(widthPx) || 1));
  const half = w / 2;
  const gridSize = Number(canvas?.grid?.size ?? 0);
  const defaultDash = Math.max(4, Math.round(gridSize * 0.25) || 10);
  const dash = Math.max(1, Math.round(Number(dashPx) || defaultDash));
  const gap = Math.max(0, Math.round(Number(gapPx) || dash));
  const step = dash + gap;
  const eps = 1e-6;

  g.beginFill(color, 1.0);
  for (const seg of (segments ?? [])) {
    const [x1, y1, x2, y2] = seg;
    if (Math.abs(y1 - y2) <= eps) {
      // horizontal
      const y = y1;
      const xStart = Math.min(x1, x2);
      const len = Math.abs(x2 - x1);
      for (let t = 0; t < len; t += step) {
        const dl = Math.min(dash, len - t);
        if (dl > eps) g.drawRect(xStart + t, y - half, dl, w);
      }
    } else if (Math.abs(x1 - x2) <= eps) {
      // vertical
      const x = x1;
      const yStart = Math.min(y1, y2);
      const len = Math.abs(y2 - y1);
      for (let t = 0; t < len; t += step) {
        const dl = Math.min(dash, len - t);
        if (dl > eps) g.drawRect(x - half, yStart + t, w, dl);
      }
    } else {
      // Unexpected diagonal: fallback to dashed stroke.
      g.endFill();
      g.lineStyle({ width: w, color, alpha: 1.0 });
      drawDashedSegment(g, x1, y1, x2, y2, dash, gap);
      g.lineStyle();
      g.beginFill(color, 1.0);
    }
  }
  g.endFill();
}

/* -------------------------------------------- */
/* Edge Quad Rendering (for Hex Grids)         */
/* -------------------------------------------- */

/**
 * Draw solid edges as filled quads (for hex grid boundaries).
 * Uses small overlap extension to hide corner seams.
 * @param {PIXI.Graphics} g - Graphics object
 * @param {Array<[number,number,number,number]>} edges - Array of [x1,y1,x2,y2] edges
 * @param {number} widthPx - Line width
 * @param {number} color - Color as hex number
 */
export function drawSolidEdgeQuads(g, edges, widthPx, color) {
  const w = Math.max(1, Math.round(Number(widthPx) || 1));
  const half = w / 2;
  const eps = 1e-6;
  const extend = Math.min(3, Math.max(0, half)); // small overlap to hide corner seams

  g.beginFill(color, 1.0);
  for (const seg of (edges ?? [])) {
    let [x1, y1, x2, y2] = seg;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len <= eps) continue;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const ax = x1 - ux * extend;
    const ay = y1 - uy * extend;
    const bx = x2 + ux * extend;
    const by = y2 + uy * extend;

    const p1x = ax + nx * half;
    const p1y = ay + ny * half;
    const p2x = ax - nx * half;
    const p2y = ay - ny * half;
    const p3x = bx - nx * half;
    const p3y = by - ny * half;
    const p4x = bx + nx * half;
    const p4y = by + ny * half;

    g.drawPolygon([p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y]);
  }
  g.endFill();
}

/**
 * Draw dashed edges as filled quads (for hex grid boundaries).
 * @param {PIXI.Graphics} g - Graphics object
 * @param {Array<[number,number,number,number]>} edges - Array of [x1,y1,x2,y2] edges
 * @param {number} widthPx - Line width
 * @param {number} color - Color as hex number
 * @param {number} dashPx - Dash length (null = auto-calculate)
 * @param {number} gapPx - Gap length (null = same as dashPx)
 */
export function drawDashedEdgeQuads(g, edges, widthPx, color, dashPx = null, gapPx = null) {
  const w = Math.max(1, Math.round(Number(widthPx) || 1));
  const half = w / 2;
  const gridSize = Number(canvas?.grid?.size ?? 0);
  const defaultDash = Math.max(4, Math.round(gridSize * 0.25) || 10);
  const dash = Math.max(1, Math.round(Number(dashPx) || defaultDash));
  const gap = Math.max(0, Math.round(Number(gapPx) || dash));
  const step = dash + gap;
  const eps = 1e-6;
  const extend = Math.min(3, Math.max(0, half));

  g.beginFill(color, 1.0);
  for (const seg of (edges ?? [])) {
    let [x1, y1, x2, y2] = seg;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len <= eps) continue;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    for (let t = 0; t < len; t += step) {
      const dl = Math.min(dash, len - t);
      if (dl <= eps) continue;

      const ax0 = x1 + ux * t;
      const ay0 = y1 + uy * t;
      const bx0 = x1 + ux * (t + dl);
      const by0 = y1 + uy * (t + dl);

      const ax = ax0 - ux * extend;
      const ay = ay0 - uy * extend;
      const bx = bx0 + ux * extend;
      const by = by0 + uy * extend;

      const p1x = ax + nx * half;
      const p1y = ay + ny * half;
      const p2x = ax - nx * half;
      const p2y = ay - ny * half;
      const p3x = bx - nx * half;
      const p3y = by - ny * half;
      const p4x = bx + nx * half;
      const p4y = by + ny * half;

      g.drawPolygon([p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y]);
    }
  }
  g.endFill();
}
