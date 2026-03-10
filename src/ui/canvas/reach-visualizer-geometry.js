/**
 * src/ui/canvas/reach-visualizer-geometry.js
 *
 * Grid-aware geometry computation for reach visualizer boundaries.
 * - Square grid: continuous boundary segments
 * - Hex grid: edge-based boundaries with neighbor detection
 * - Grid coordinate transformations and helpers
 *
 * Foundry VTT v13.351 compatible.
 */

/* -------------------------------------------- */
/* Grid Coordinate Helpers                      */
/* -------------------------------------------- */

export function rcKey(r, c) {
  return `${r},${c}`;
}

export function parseRcKey(key) {
  const [rStr, cStr] = String(key ?? "").split(",");
  return { r: Number(rStr), c: Number(cStr) };
}

export function offKey(off) {
  return `${Number(off?.i ?? 0)},${Number(off?.j ?? 0)}`;
}

export function parseOffKey(key) {
  const [iStr, jStr] = String(key ?? "").split(",");
  return { i: Number(iStr), j: Number(jStr) };
}

export function getGridAxes(grid, origin) {
  // Foundry's SquareGrid uses a {i,j} offset, but the "which axis is which" mapping has varied across versions.
  // Detect it by observing how getCenterPoint changes when incrementing i vs j.
  try {
    const o = grid.getOffset(origin);
    const c0 = grid.getCenterPoint(o);
    const cI = grid.getCenterPoint({ i: o.i + 1, j: o.j });
    const cJ = grid.getCenterPoint({ i: o.i, j: o.j + 1 });

    const dxI = Math.abs((cI?.x ?? 0) - (c0?.x ?? 0));
    const dyI = Math.abs((cI?.y ?? 0) - (c0?.y ?? 0));
    const dxJ = Math.abs((cJ?.x ?? 0) - (c0?.x ?? 0));
    const dyJ = Math.abs((cJ?.y ?? 0) - (c0?.y ?? 0));

    // "Row" axis tends to move more in Y than X.
    const iIsRow = dyI > dxI && dyI >= dyJ;
    const jIsRow = dyJ > dxJ && dyJ > dyI;
    if (iIsRow && !jIsRow) return { iIsRow: true };
    if (!iIsRow && jIsRow) return { iIsRow: false };

    // Fallback heuristic.
    return { iIsRow: dyI >= dyJ };
  } catch (_e) {
    return { iIsRow: true };
  }
}

export function gridOffToRC(off, axes) {
  const i = Number(off?.i ?? 0);
  const j = Number(off?.j ?? 0);
  return axes?.iIsRow ? { r: i, c: j } : { r: j, c: i };
}

export function rcToGridOff(rc, axes) {
  const r = Number(rc?.r ?? 0);
  const c = Number(rc?.c ?? 0);
  return axes?.iIsRow ? { i: r, j: c } : { i: c, j: r };
}

export function getCellTopLeftWorld(grid, rc, axes) {
  const size = Number(grid?.size ?? 0);
  const off = rcToGridOff(rc, axes);
  if (typeof grid.getTopLeftPoint === "function") return grid.getTopLeftPoint(off);
  const c = grid.getCenterPoint(off);
  return { x: c.x - size / 2, y: c.y - size / 2 };
}

export function getCellCenterWorld(grid, rc, axes) {
  const off = rcToGridOff(rc, axes);
  return grid.getCenterPoint(off);
}

export function getGridOriginShift(grid, origin, axes) {
  try {
    const o = grid.getOffset(origin);
    const rc = gridOffToRC(o, axes);
    const c = getCellCenterWorld(grid, rc, axes);
    const dx = Math.round((origin.x - c.x) * 10) / 10;
    const dy = Math.round((origin.y - c.y) * 10) / 10;
    return { dx, dy };
  } catch (_e) {
    return { dx: 0, dy: 0 };
  }
}

export function getTokenFootprintCellsRC(token, grid, axes) {
  try {
    const w = Math.max(1, Math.round(Number(token?.document?.width ?? 1)));
    const h = Math.max(1, Math.round(Number(token?.document?.height ?? 1)));

    // Token document x/y are top-left in canvas coordinates.
    const x = Number(token?.document?.x);
    const y = Number(token?.document?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return new Set();

    const topLeftOff = grid.getOffset({ x, y });
    const topLeftRC = gridOffToRC(topLeftOff, axes);

    const set = new Set();
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        set.add(rcKey(topLeftRC.r + dr, topLeftRC.c + dc));
      }
    }
    return set;
  } catch (_e) {
    return new Set();
  }
}

export function mergeRanges(ranges) {
  if (!ranges?.length) return [];
  const sorted = ranges
    .map(([a, b]) => [Number(a), Number(b)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));

  const out = [];
  let cur = sorted[0];
  for (const next of sorted.slice(1)) {
    if (next[0] <= cur[1]) cur[1] = Math.max(cur[1], next[1]);
    else {
      out.push(cur);
      cur = next;
    }
  }
  out.push(cur);
  return out;
}

export function snapWorldLine(vWorld, widthPx) {
  const w = Math.max(1, Math.round(Number(widthPx) || 1));
  const isOdd = (w % 2) === 1;
  const n = Math.round(Number(vWorld) || 0);
  return isOdd ? (n + 0.5) : n;
}

export function snapWorldEdge(vWorld) {
  return Math.round(Number(vWorld) || 0);
}

export function edgeKey(x1, y1, x2, y2) {
  const r = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const ax = r(x1);
  const ay = r(y1);
  const bx = r(x2);
  const by = r(y2);
  // Normalize direction so undirected edges hash the same.
  if (ax < bx || (ax === bx && ay <= by)) return `${ax},${ay}|${bx},${by}`;
  return `${bx},${by}|${ax},${ay}`;
}

export function getCellPolygonWorldForOffset(grid, off) {
  // Prefer grid-provided polygon/vertices if available.
  try {
    if (typeof grid.getVertices === "function") {
      const verts = grid.getVertices(off);
      if (Array.isArray(verts) && verts.length) {
        if (typeof verts[0]?.x === "number") return verts.map(p => ({ x: p.x, y: p.y }));
        if (typeof verts[0] === "number") {
          const pts = [];
          for (let i = 0; i < verts.length; i += 2) pts.push({ x: verts[i], y: verts[i + 1] });
          return pts;
        }
      }
    }
  } catch (_e) {
    // fall through
  }

  try {
    if (typeof grid.getPolygon === "function") {
      const poly = grid.getPolygon(off);
      const pts = poly?.points ?? poly;
      if (Array.isArray(pts) && pts.length) {
        if (typeof pts[0] === "number") {
          const out = [];
          for (let i = 0; i < pts.length; i += 2) out.push({ x: pts[i], y: pts[i + 1] });
          return out;
        }
        if (typeof pts[0]?.x === "number") return pts.map(p => ({ x: p.x, y: p.y }));
      }
    }
  } catch (_e) {
    // fall through
  }

  // Last resort: approximate a hex around the cell center.
  const size = Number(grid?.size ?? 0);
  const c = grid.getCenterPoint(off);
  const tl = { x: (c?.x ?? 0) - size / 2, y: (c?.y ?? 0) - size / 2 };
  const w = size;
  const h = size;
  const t = canvas?.scene?.grid?.type;
  const gt = CONST?.GRID_TYPES ?? {};
  const isRowOffset = (t === gt.HEXODDR || t === gt.HEXEVENR);

  if (isRowOffset) {
    return [
      { x: tl.x + w * 0.25, y: tl.y + 0 },
      { x: tl.x + w * 0.75, y: tl.y + 0 },
      { x: tl.x + w * 1.00, y: tl.y + h * 0.50 },
      { x: tl.x + w * 0.75, y: tl.y + h * 1.00 },
      { x: tl.x + w * 0.25, y: tl.y + h * 1.00 },
      { x: tl.x + w * 0.00, y: tl.y + h * 0.50 },
    ];
  }

  return [
    { x: tl.x + w * 0.50, y: tl.y + 0 },
    { x: tl.x + w * 1.00, y: tl.y + h * 0.25 },
    { x: tl.x + w * 1.00, y: tl.y + h * 0.75 },
    { x: tl.x + w * 0.50, y: tl.y + h * 1.00 },
    { x: tl.x + w * 0.00, y: tl.y + h * 0.75 },
    { x: tl.x + w * 0.00, y: tl.y + h * 0.25 },
  ];
}

export function sampleOutsideEdge(grid, off, poly, edgeIndex) {
  const center = grid.getCenterPoint(off);
  const a = poly[edgeIndex];
  const b = poly[(edgeIndex + 1) % poly.length];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const vx = mx - (center?.x ?? 0);
  const vy = my - (center?.y ?? 0);
  // Push 20% beyond the edge midpoint in the outward direction.
  const sx = (center?.x ?? 0) + (vx * 1.2);
  const sy = (center?.y ?? 0) + (vy * 1.2);
  return { x: sx, y: sy };
}

export function measureGridDistanceUnits(a, b) {
  const grid = canvas?.grid;
  if (!grid) return 0;

  if (typeof grid.measurePath === "function") {
    // Prefer gridSpaces=true to follow scene diagonal rules.
    try {
      const res = grid.measurePath([a, b], { gridSpaces: true });
      if (typeof res === "number") return res;
      if (res && typeof res === "object") {
        if (res.distance != null) return Number(res.distance) || 0;
        if (res.gridDistance != null) return Number(res.gridDistance) || 0;
      }
    } catch (_e) {
      // try without options
      try {
        const res = grid.measurePath([a, b]);
        if (typeof res === "number") return res;
        if (res && typeof res === "object") {
          if (res.distance != null) return Number(res.distance) || 0;
          if (res.gridDistance != null) return Number(res.gridDistance) || 0;
        }
      } catch (_e2) {
        // fall through
      }
    }
  }

  // Last-resort fallback: Euclidean in scene units (not diagonal-rule aware).
  const px = Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0));
  const pxPerUnit = getPxPerUnit();
  return px / pxPerUnit;
}

export function getPxPerUnit() {
  const grid = canvas?.grid;
  const size = Number(grid?.size ?? canvas?.scene?.grid?.size);
  const dist = Number(grid?.distance ?? canvas?.scene?.grid?.distance);
  if (!size || !dist) return 1;
  return size / dist;
}

/**
 * Compute reach distance (in scene units) from a token footprint to a candidate cell using
 * Chebyshev (equal-cost diagonal) distance. This intentionally ignores the scene's diagonal
 * movement rule (e.g. 1/2/1 alternating) because reach is not governed by movement.
 *
 * @param {number} r - Candidate cell row
 * @param {number} c - Candidate cell column
 * @param {Set<string>} footprint - rcKey strings for the token's occupied cells
 * @param {number} sceneDist - Scene distance per grid step
 * @returns {number} Distance in scene units (0 if the cell is inside the footprint)
 */
function chebyshevReachDistance(r, c, footprint, sceneDist) {
  let minSteps = Infinity;
  for (const k of footprint) {
    const { r: fr, c: fc } = parseRcKey(k);
    const steps = Math.max(Math.abs(r - fr), Math.abs(c - fc));
    if (steps < minSteps) minSteps = steps;
    if (minSteps === 0) break;
  }
  return (Number.isFinite(minSteps) ? minSteps : 0) * sceneDist;
}

/* -------------------------------------------- */
/* Square Grid Boundary Computation              */
/* -------------------------------------------- */

/**
 * Compute square-grid boundary segments for all spaces within `radiusUnits` of the token center,
 * using a deterministic: cell-set -> boundary-edges -> merged-segments pipeline.
 *
 * Returns segments in LOCAL coordinates relative to token.center.
 *
 * @param {Token} token
 * @param {number} radiusUnits
 * @param {number} lineWidthPx
 * @param {object} [options]
 * @param {boolean} [options.ignoreSceneDiagonals=true]
 *   When true (default), uses Chebyshev (equal-cost diagonal) distance, ignoring the scene's
 *   diagonal movement rule. When false, uses Foundry's measurePath which respects 1/2/1 etc.
 * @returns {{key: string, segments: Array<[number,number,number,number]>}}
 */
export function computeSquareGridOutline(token, radiusUnits, lineWidthPx, { ignoreSceneDiagonals = true } = {}) {
  const grid = canvas?.grid;
  if (!grid) return { key: "nogrid", segments: [] };

  const origin = token?.center;
  if (!origin) return { key: "noorigin", segments: [] };

  const size = Number(grid.size ?? 0);
  const sceneDist = Number(canvas?.scene?.grid?.distance ?? grid.distance ?? 0);
  if (!size || !sceneDist) return { key: "nosize", segments: [] };

  const axes = getGridAxes(grid, origin);
  const shift = getGridOriginShift(grid, origin, axes);

  const tokenW = Math.max(1, Math.round(Number(token?.document?.width ?? 1)));
  const tokenH = Math.max(1, Math.round(Number(token?.document?.height ?? 1)));
  const wPx = Math.max(1, Math.round(Number(lineWidthPx) || 1));

  // "diag=reach" for Chebyshev mode (scene rule ignored); real diag value for scene mode.
  let diagKey = "reach";
  if (!ignoreSceneDiagonals) {
    try { diagKey = String(canvas?.scene?.grid?.diagonals ?? canvas?.scene?.grid?.diagonalRule ?? grid?.diagonalRule ?? ""); } catch (_e) { diagKey = ""; }
  }

  const maxSteps = Math.max(0, Math.ceil(radiusUnits / sceneDist)) + Math.ceil(Math.max(tokenW, tokenH) / 2) + 1;
  const key = `sq|u=${radiusUnits}|steps=${maxSteps}|d=${sceneDist}|s=${size}|w=${wPx}|tw=${tokenW},th=${tokenH}|dx=${shift.dx},dy=${shift.dy}|diag=${diagKey}|axes=iIsRow:${Boolean(axes?.iIsRow)}`;

  let o0;
  try {
    o0 = grid.getOffset(origin);
  } catch (_e) {
    return { key, segments: [] };
  }
  const rc0 = gridOffToRC(o0, axes);

  // Capture the token footprint as a stable reference; `included` grows during the loop.
  const footprint = getTokenFootprintCellsRC(token, grid, axes);
  const included = new Set(footprint);

  if (ignoreSceneDiagonals) {
    // Chebyshev (equal-cost diagonals) — scene diagonal movement rule is intentionally ignored.
    for (let r = rc0.r - maxSteps; r <= rc0.r + maxSteps; r++) {
      for (let c = rc0.c - maxSteps; c <= rc0.c + maxSteps; c++) {
        if (included.has(rcKey(r, c))) continue;
        const d = chebyshevReachDistance(r, c, footprint, sceneDist);
        if (d <= (radiusUnits + 1e-6)) included.add(rcKey(r, c));
      }
    }
  } else {
    // Scene-diagonal mode: use Foundry's measurePath which respects the configured diagonal rule.
    const pxPerUnit = getPxPerUnit();
    const maxPx = (Number(radiusUnits) || 0) * pxPerUnit + size;
    const maxPx2 = maxPx * maxPx;

    for (let r = rc0.r - maxSteps; r <= rc0.r + maxSteps; r++) {
      for (let c = rc0.c - maxSteps; c <= rc0.c + maxSteps; c++) {
        if (included.has(rcKey(r, c))) continue;
        let center;
        try {
          center = getCellCenterWorld(grid, { r, c }, axes);
        } catch (_e) {
          continue;
        }
        const dx = (center?.x ?? 0) - origin.x;
        const dy = (center?.y ?? 0) - origin.y;
        if ((dx * dx + dy * dy) > maxPx2) continue;
        const d = measureGridDistanceUnits(origin, center);
        if (d <= (radiusUnits + 1e-6)) included.add(rcKey(r, c));
      }
    }
  }

  const has = (r, c) => included.has(rcKey(r, c));

  // Extract boundary edges in grid-space and merge into long segments to avoid corner seams.
  /** @type {Map<number, Array<[number,number]>>} */
  const hEdges = new Map(); // yGrid -> [[x0,x1], ...]
  /** @type {Map<number, Array<[number,number]>>} */
  const vEdges = new Map(); // xGrid -> [[y0,y1], ...]

  for (const k of included) {
    const { r, c } = parseRcKey(k);
    if (!Number.isFinite(r) || !Number.isFinite(c)) continue;

    // North
    if (!has(r - 1, c)) {
      const y = r;
      if (!hEdges.has(y)) hEdges.set(y, []);
      hEdges.get(y).push([c, c + 1]);
    }

    // South
    if (!has(r + 1, c)) {
      const y = r + 1;
      if (!hEdges.has(y)) hEdges.set(y, []);
      hEdges.get(y).push([c, c + 1]);
    }

    // West
    if (!has(r, c - 1)) {
      const x = c;
      if (!vEdges.has(x)) vEdges.set(x, []);
      vEdges.get(x).push([r, r + 1]);
    }

    // East
    if (!has(r, c + 1)) {
      const x = c + 1;
      if (!vEdges.has(x)) vEdges.set(x, []);
      vEdges.get(x).push([r, r + 1]);
    }
  }

  const segments = [];

  // Horizontal segments
  for (const [yGrid, ranges] of hEdges.entries()) {
    for (const [x0, x1] of mergeRanges(ranges)) {
      try {
        // Prefer using a real cell row when possible to avoid edge-case failures at extreme boundaries.
        let tl = null;
        let yWorld = null;
        try {
          tl = getCellTopLeftWorld(grid, { r: yGrid, c: x0 }, axes);
          yWorld = tl.y;
        } catch (_e1) {
          tl = getCellTopLeftWorld(grid, { r: yGrid - 1, c: x0 }, axes);
          yWorld = tl.y + size;
        }

        const xWorld0 = tl.x;
        const xWorld1 = tl.x + ((x1 - x0) * size);

        const x0s = snapWorldEdge(xWorld0) - origin.x;
        const x1s = snapWorldEdge(xWorld1) - origin.x;
        const ys = snapWorldLine(yWorld, wPx) - origin.y;
        segments.push([x0s, ys, x1s, ys]);
      } catch (_e) {
        // ignore
      }
    }
  }

  // Vertical segments
  for (const [xGrid, ranges] of vEdges.entries()) {
    for (const [y0, y1] of mergeRanges(ranges)) {
      try {
        let tl = null;
        let xWorld = null;
        try {
          tl = getCellTopLeftWorld(grid, { r: y0, c: xGrid }, axes);
          xWorld = tl.x;
        } catch (_e1) {
          tl = getCellTopLeftWorld(grid, { r: y0, c: xGrid - 1 }, axes);
          xWorld = tl.x + size;
        }

        const yWorld0 = tl.y;
        const yWorld1 = tl.y + ((y1 - y0) * size);

        const xs = snapWorldLine(xWorld, wPx) - origin.x;
        const y0s = snapWorldEdge(yWorld0) - origin.y;
        const y1s = snapWorldEdge(yWorld1) - origin.y;
        segments.push([xs, y0s, xs, y1s]);
      } catch (_e) {
        // ignore
      }
    }
  }

  return { key, segments };
}

/* -------------------------------------------- */
/* Hex Grid Boundary Computation                 */
/* -------------------------------------------- */

/**
 * Compute hex-grid boundary edges for all spaces within `radiusUnits` of the token center.
 *
 * Returns edges in LOCAL coordinates relative to token.center.
 *
 * @param {Token} token
 * @param {number} radiusUnits
 * @param {number} lineWidthPx
 * @returns {{key: string, edges: Array<[number,number,number,number]>}}
 */
export function computeHexGridOutline(token, radiusUnits, lineWidthPx) {
  const grid = canvas?.grid;
  if (!grid) return { key: "nogrid", edges: [] };

  const origin = token?.center;
  if (!origin) return { key: "noorigin", edges: [] };

  const size = Number(grid.size ?? 0);
  const sceneDist = Number(canvas?.scene?.grid?.distance ?? grid.distance ?? 0);
  if (!size || !sceneDist) return { key: "nosize", edges: [] };

  // Hex scenes are equidistant; use measurePath({gridSpaces:true}) for inclusion so FVTT rules apply.
  let shift = { dx: 0, dy: 0 };
  try {
    const c = grid.getCenterPoint(grid.getOffset(origin));
    shift = {
      dx: Math.round((origin.x - c.x) * 10) / 10,
      dy: Math.round((origin.y - c.y) * 10) / 10,
    };
  } catch (_e) {
    shift = { dx: 0, dy: 0 };
  }

  const wPx = Math.max(1, Math.round(Number(lineWidthPx) || 1));

  let diag = "";
  try { diag = String(canvas?.scene?.grid?.diagonals ?? canvas?.scene?.grid?.diagonalRule ?? grid?.diagonalRule ?? ""); } catch (_e) { diag = ""; }
  const gridType = String(canvas?.scene?.grid?.type ?? "");
  const steps = Math.max(0, Math.ceil((Number(radiusUnits) || 0) / sceneDist));
  // For hex grids we intentionally use an AoE-style emanation (radius in hexes) for deterministic results.
  // This matches typical FVTT hex behavior (equidistant: 1 per adjacent hex).
  const key = `hex|steps=${steps}|d=${sceneDist}|s=${size}|w=${wPx}|dx=${shift.dx},dy=${shift.dy}|diag=${diag}|type=${gridType}`;

  let o0;
  try {
    o0 = grid.getOffset(origin);
  } catch (_e) {
    return { key, edges: [] };
  }

  const originKey = offKey(o0);
  /** @type {Map<string, number>} */
  const dist = new Map([[originKey, 0]]);
  const queue = [originKey];
  let qi = 0;

  /** @type {Map<string, string[]>} */
  const neighborCache = new Map();
  const getNeighbors = (keyStr) => {
    const cached = neighborCache.get(keyStr);
    if (cached) return cached;

    const off = parseOffKey(keyStr);
    let poly;
    try {
      poly = getCellPolygonWorldForOffset(grid, off);
    } catch (_e) {
      poly = null;
    }
    if (!poly?.length) {
      neighborCache.set(keyStr, []);
      return [];
    }

    const out = [];
    const seen = new Set();
    for (let e = 0; e < poly.length; e++) {
      const sample = sampleOutsideEdge(grid, off, poly, e);
      let nOff;
      try {
        nOff = grid.getOffset(sample);
      } catch (_e) {
        nOff = null;
      }
      if (!nOff) continue;
      const nk = offKey(nOff);
      if (nk === keyStr) continue;
      if (seen.has(nk)) continue;
      seen.add(nk);
      out.push(nk);
    }
    neighborCache.set(keyStr, out);
    return out;
  };

  while (qi < queue.length) {
    const cur = queue[qi++];
    const d = dist.get(cur) ?? 0;
    if (d >= steps) continue;
    for (const nb of getNeighbors(cur)) {
      if (dist.has(nb)) continue;
      dist.set(nb, d + 1);
      queue.push(nb);
    }
  }

  const included = new Set(dist.keys());
  const edges = [];
  const seenEdges = new Set();

  const hasKey = (k) => included.has(k);

  for (const keyStr of included) {
    const off = parseOffKey(keyStr);

    let poly;
    try {
      poly = getCellPolygonWorldForOffset(grid, off);
    } catch (_e) {
      continue;
    }
    if (!poly?.length) continue;

    // Boundary detection: for each cell edge, sample a point just outside the edge and see which cell it maps to.
    for (let e = 0; e < poly.length; e++) {
      const sample = sampleOutsideEdge(grid, off, poly, e);
      let nOff;
      try {
        nOff = grid.getOffset(sample);
      } catch (_e) {
        nOff = null;
      }
      const nk = nOff ? offKey(nOff) : null;
      if (nk && hasKey(nk)) continue;

      const a = poly[e];
      const b = poly[(e + 1) % poly.length];
      const x1 = a.x - origin.x;
      const y1 = a.y - origin.y;
      const x2 = b.x - origin.x;
      const y2 = b.y - origin.y;
      const ek = edgeKey(x1, y1, x2, y2);
      if (seenEdges.has(ek)) continue;
      seenEdges.add(ek);
      edges.push([x1, y1, x2, y2]);
    }
  }

  return { key, edges };
}
