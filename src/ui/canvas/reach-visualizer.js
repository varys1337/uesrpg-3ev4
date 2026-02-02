/**
 * src/ui/canvas/reach-visualizer.js
 *
 * Canvas overlay which draws an actor's active melee reach as rings around tokens.
 * - Solid boundary: maximum melee reach
 * - Dashed boundary: minimum melee reach (from the active melee weapon, when present)
 *
 * Design goals:
 * - UI state derives solely from document data + client settings (no hidden state)
 * - Cache and redraw only when needed
 * - Avoid deprecated grid APIs (use BaseGrid#measurePath via canvas.grid.measurePath)
 *
 * Foundry VTT v13.351 (AppV1 system) compatible.
 */

import {
  REACH_BEHAVIOUR,
  REACH_COLOR_MODE,
  REACH_SHAPE,
  REACH_SOURCE,
  REACH_VISIBILITY,
  getReachVisualizerSettings,
  normalizeReachVisualizerSettings,
  setReachVisualizerSettings,
} from "./reach-visualizer-config.js";
import { getLastMeleeWeaponForActor, setLastMeleeWeaponForActor } from "./reach-visualizer-state.js";

const OVERLAY_NAME = "uesrpg-reach-visualizer-overlay";
const CONTROL_TOOL_NAME = "uesrpg-reach-visualizer";

let _enabled = false;
let _settings = normalizeReachVisualizerSettings({});
let _overlayContainer = null;
let _hoveredToken = null;
let _debouncedRedraw = null;
let _hooksRegistered = false;

/** @type {Map<string, {container: PIXI.Container, maxG: PIXI.Graphics, minG: PIXI.Graphics, label?: PIXI.Text, distLabel?: PIXI.Text, lastKey?: string, gridCache?: {max?: any, min?: any}}>} */
const _tokenOverlays = new Map();

/* -------------------------------------------- */
/* Utilities                                    */
/* -------------------------------------------- */

function _isCanvasReady() {
  return Boolean(canvas?.scene && canvas?.tokens && typeof canvas.tokens.addChild === "function");
}

function _getOverlayContainer() {
  if (!_isCanvasReady()) return null;

  if (!_overlayContainer || _overlayContainer.destroyed) {
    _overlayContainer = new PIXI.Container();
    _overlayContainer.name = OVERLAY_NAME;
    _overlayContainer.sortableChildren = true;
    _overlayContainer.zIndex = -1000;

    // Ensure overlays never intercept mouse interactions.
    try {
      _overlayContainer.eventMode = "none";
    } catch (_e) {
      // ignore
    }
    _overlayContainer.interactiveChildren = false;

    try {
      if (typeof canvas.tokens.addChildAt === "function") canvas.tokens.addChildAt(_overlayContainer, 0);
      else canvas.tokens.addChild(_overlayContainer);
    } catch (_e) {
      _overlayContainer = null;
      return null;
    }
  }
  return _overlayContainer;
}

function _destroyOverlayContainer() {
  if (_overlayContainer && !_overlayContainer.destroyed) {
    try { _overlayContainer.parent?.removeChild?.(_overlayContainer); } catch (_e) { /* no-op */ }
    try { _overlayContainer.destroy({ children: true }); } catch (_e) { /* no-op */ }
  }
  _overlayContainer = null;
  _tokenOverlays.clear();
}

function _clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function _getBaseOpacity() {
  return _clampNumber(_settings?.opacity, 0.05, 1.0, 0.35);
}

function _getPassiveOpacity() {
  return _clampNumber(_settings?.passiveOpacity ?? _settings?.opacity, 0.05, 1.0, 0.2);
}

function _getActiveOpacity() {
  return _clampNumber(_settings?.activeOpacity, 0.05, 1.0, 0.8);
}

function _getOverlayAlphaForToken(token) {
  if (_settings?.visibility === REACH_VISIBILITY.DYNAMIC) {
    if (_hoveredToken && token?.id === _hoveredToken.id) return _getActiveOpacity();
    return _getPassiveOpacity();
  }
  return _getBaseOpacity();
}

function _applyOverlayAlpha(token) {
  const entry = token ? _tokenOverlays.get(token.id) : null;
  if (!entry?.container) return;
  const a = _getOverlayAlphaForToken(token);
  if (Number(entry.container.alpha) !== Number(a)) entry.container.alpha = a;
}

function _getSceneUnitsLabel() {
  const units = canvas?.scene?.grid?.units ?? "";
  return units ? String(units) : "";
}

function _hexToNumber(hex, fallback = 0x33ff66) {
  const v = String(hex ?? "").trim();
  if (!v) return fallback;
  const raw = v.startsWith("#") ? v.slice(1) : v;
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return parseInt(raw, 16);
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const rrggbb = raw.split("").map(c => `${c}${c}`).join("");
    return parseInt(rrggbb, 16);
  }
  return fallback;
}

function _getDispositionColor(token, fallback = 0x33ff66) {
  const disp = token?.document?.disposition;
  if (disp === -1) return 0xff3355;
  if (disp === 0) return 0xffcc33;
  if (disp === 1) return 0x33ff66;
  return fallback;
}

function _getTokenColor(token) {
  if (_settings.colorMode === REACH_COLOR_MODE.DISPOSITION) return _getDispositionColor(token, 0x33ff66);
  if (_settings.colorMode === REACH_COLOR_MODE.UNIFORM) return _hexToNumber(_settings.uniformColor, 0x33ff66);
  return 0x33ff66;
}

function _getPxPerUnit() {
  const grid = canvas?.grid;
  const size = Number(grid?.size ?? canvas?.scene?.grid?.size);
  const dist = Number(grid?.distance ?? canvas?.scene?.grid?.distance);
  if (!size || !dist) return 1;
  return size / dist;
}

function _isGridlessScene() {
  try {
    return canvas?.scene?.grid?.type === CONST.GRID_TYPES.GRIDLESS;
  } catch (_e) {
    return false;
  }
}

function _isSquareGrid() {
  try {
    return canvas?.scene?.grid?.type === CONST.GRID_TYPES.SQUARE;
  } catch (_e) {
    // Fallback: heuristic
    return (canvas?.grid?.constructor?.name ?? "").toLowerCase().includes("square");
  }
}

function _isHexGrid() {
  try {
    const t = canvas?.scene?.grid?.type;
    const gt = CONST?.GRID_TYPES ?? {};
    const known = [
      gt.HEXODDQ,
      gt.HEXEVENQ,
      gt.HEXODDR,
      gt.HEXEVENR,
    ].filter(v => v != null);
    if (known.includes(t)) return true;
    return (canvas?.grid?.constructor?.name ?? "").toLowerCase().includes("hex");
  } catch (_e) {
    return (canvas?.grid?.constructor?.name ?? "").toLowerCase().includes("hex");
  }
}

function _measureGridDistanceUnits(a, b) {
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
  return px / _getPxPerUnit();
}

function _getElevationUnits(token) {
  const e = token?.document?.elevation;
  const n = Number(e);
  return Number.isFinite(n) ? n : 0;
}

function _measure3dDistanceUnits(fromToken, toToken) {
  const a = fromToken?.center;
  const b = toToken?.center;
  if (!a || !b) return 0;

  const horizontal = _measureGridDistanceUnits(a, b);
  if (!_settings.includeElevation) return horizontal;

  const dz = _getElevationUnits(toToken) - _getElevationUnits(fromToken);
  return Math.sqrt((horizontal * horizontal) + (dz * dz));
}

function _drawDashedCircle(g, radiusPx, dashPx = 10, gapPx = 6) {
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

function _drawDashedSegment(g, x1, y1, x2, y2, dashPx = 10, gapPx = 6) {
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
function _drawSolidGridSegments(g, segments, widthPx, color) {
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

function _drawDashedGridSegments(g, segments, widthPx, color, dashPx = null, gapPx = null) {
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
      _drawDashedSegment(g, x1, y1, x2, y2, dash, gap);
      g.lineStyle();
      g.beginFill(color, 1.0);
    }
  }
  g.endFill();
}

/* Active reach source-of-truth                  */
/* -------------------------------------------- */

function _isMeleeWeapon(item) {
  if (!item) return false;
  if (item.type !== "weapon") return false;

  // System-specific melee selector:
  // - primary: system.attackMode === "melee" (as per item menu)
  // - fallback: system.mode === "melee"
  const mode = item.system?.attackMode ?? item.system?.mode;
  if (String(mode ?? "").toLowerCase() !== "melee") return false;

  const equipped = Boolean(item.system?.equipped);
  return equipped;
}

function _getWeaponReachBoundsUnits(weapon) {
  const max = Number(weapon?.system?.reach ?? 0);
  const min = Number(weapon?.system?.reachMin ?? 0);
  return { max: Math.max(0, max), min: Math.max(0, min) };
}

/**
 * Determine the "active" melee weapon for an actor based on settings.
 * Returns null if no equipped melee weapons exist.
 * @param {Actor} actor
 * @returns {{weapon: Item|null, bounds: {max:number,min:number}}}
 */
function _getActiveMeleeWeapon(actor) {
  const weapons = actor?.items?.filter(_isMeleeWeapon) ?? [];
  if (!weapons.length) return { weapon: null, bounds: { max: 0, min: 0 } };

  if (_settings.reachSource === REACH_SOURCE.LAST_USED) {
    const lastId = getLastMeleeWeaponForActor(actor.id);
    const lastWeapon = lastId ? weapons.find(w => w.id === lastId) : null;
    if (lastWeapon) return { weapon: lastWeapon, bounds: _getWeaponReachBoundsUnits(lastWeapon) };
  }

  // Default: pick the equipped melee weapon with the highest reach.
  let best = weapons[0];
  let bestBounds = _getWeaponReachBoundsUnits(best);

  for (const w of weapons.slice(1)) {
    const b = _getWeaponReachBoundsUnits(w);
    if (b.max > bestBounds.max) {
      best = w;
      bestBounds = b;
    }
  }

  return { weapon: best, bounds: bestBounds };
}

/* -------------------------------------------- */
/* Grid-aware boundaries                         */
/* -------------------------------------------- */

function _rcKey(r, c) {
  return `${r},${c}`;
}

function _parseRcKey(key) {
  const [rStr, cStr] = String(key ?? "").split(",");
  return { r: Number(rStr), c: Number(cStr) };
}

function _getGridAxes(grid, origin) {
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

function _gridOffToRC(off, axes) {
  const i = Number(off?.i ?? 0);
  const j = Number(off?.j ?? 0);
  return axes?.iIsRow ? { r: i, c: j } : { r: j, c: i };
}

function _rcToGridOff(rc, axes) {
  const r = Number(rc?.r ?? 0);
  const c = Number(rc?.c ?? 0);
  return axes?.iIsRow ? { i: r, j: c } : { i: c, j: r };
}

function _getCellTopLeftWorld(grid, rc, axes) {
  const size = Number(grid?.size ?? 0);
  const off = _rcToGridOff(rc, axes);
  if (typeof grid.getTopLeftPoint === "function") return grid.getTopLeftPoint(off);
  const c = grid.getCenterPoint(off);
  return { x: c.x - size / 2, y: c.y - size / 2 };
}

function _getCellCenterWorld(grid, rc, axes) {
  const off = _rcToGridOff(rc, axes);
  return grid.getCenterPoint(off);
}

function _getGridOriginShift(grid, origin, axes) {
  try {
    const o = grid.getOffset(origin);
    const rc = _gridOffToRC(o, axes);
    const c = _getCellCenterWorld(grid, rc, axes);
    const dx = Math.round((origin.x - c.x) * 10) / 10;
    const dy = Math.round((origin.y - c.y) * 10) / 10;
    return { dx, dy };
  } catch (_e) {
    return { dx: 0, dy: 0 };
  }
}

function _getTokenFootprintCellsRC(token, grid, axes) {
  try {
    const w = Math.max(1, Math.round(Number(token?.document?.width ?? 1)));
    const h = Math.max(1, Math.round(Number(token?.document?.height ?? 1)));

    // Token document x/y are top-left in canvas coordinates.
    const x = Number(token?.document?.x);
    const y = Number(token?.document?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return new Set();

    const topLeftOff = grid.getOffset({ x, y });
    const topLeftRC = _gridOffToRC(topLeftOff, axes);

    const set = new Set();
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        set.add(_rcKey(topLeftRC.r + dr, topLeftRC.c + dc));
      }
    }
    return set;
  } catch (_e) {
    return new Set();
  }
}

function _mergeRanges(ranges) {
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

function _snapWorldLine(vWorld, widthPx) {
  const w = Math.max(1, Math.round(Number(widthPx) || 1));
  const isOdd = (w % 2) === 1;
  const n = Math.round(Number(vWorld) || 0);
  return isOdd ? (n + 0.5) : n;
}

function _snapWorldEdge(vWorld) {
  return Math.round(Number(vWorld) || 0);
}

function _edgeKey(x1, y1, x2, y2) {
  const r = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const ax = r(x1);
  const ay = r(y1);
  const bx = r(x2);
  const by = r(y2);
  // Normalize direction so undirected edges hash the same.
  if (ax < bx || (ax === bx && ay <= by)) return `${ax},${ay}|${bx},${by}`;
  return `${bx},${by}|${ax},${ay}`;
}

function _getCellPolygonWorldForOffset(grid, off) {
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

function _offKey(off) {
  return `${Number(off?.i ?? 0)},${Number(off?.j ?? 0)}`;
}

function _parseOffKey(key) {
  const [iStr, jStr] = String(key ?? "").split(",");
  return { i: Number(iStr), j: Number(jStr) };
}

function _sampleOutsideEdge(grid, off, poly, edgeIndex) {
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

function _drawSolidEdgeQuads(g, edges, widthPx, color) {
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

function _drawDashedEdgeQuads(g, edges, widthPx, color, dashPx = null, gapPx = null) {
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

/**
 * Compute square-grid boundary segments for all spaces within `radiusUnits` of the token center,
 * using a deterministic: cell-set -> boundary-edges -> merged-segments pipeline.
 *
 * Returns segments in LOCAL coordinates relative to token.center.
 *
 * @param {Token} token
 * @param {number} radiusUnits
 * @param {number} lineWidthPx
 * @returns {{key: string, segments: Array<[number,number,number,number]>}}
 */
function _computeSquareGridOutline(token, radiusUnits, lineWidthPx) {
  const grid = canvas?.grid;
  if (!grid) return { key: "nogrid", segments: [] };

  const origin = token?.center;
  if (!origin) return { key: "noorigin", segments: [] };

  const size = Number(grid.size ?? 0);
  const sceneDist = Number(canvas?.scene?.grid?.distance ?? grid.distance ?? 0);
  if (!size || !sceneDist) return { key: "nosize", segments: [] };

  const axes = _getGridAxes(grid, origin);
  const shift = _getGridOriginShift(grid, origin, axes);

  // Attempt to include diagonal rule / scene grid config in the key.
  let diag = "";
  try { diag = String(canvas?.scene?.grid?.diagonals ?? canvas?.scene?.grid?.diagonalRule ?? grid?.diagonalRule ?? ""); } catch (_e) { diag = ""; }

  const tokenW = Math.max(1, Math.round(Number(token?.document?.width ?? 1)));
  const tokenH = Math.max(1, Math.round(Number(token?.document?.height ?? 1)));
  const wPx = Math.max(1, Math.round(Number(lineWidthPx) || 1));

  const maxSteps = Math.max(0, Math.ceil(radiusUnits / sceneDist)) + Math.ceil(Math.max(tokenW, tokenH) / 2) + 1;
  const key = `sq|u=${radiusUnits}|steps=${maxSteps}|d=${sceneDist}|s=${size}|w=${wPx}|tw=${tokenW},th=${tokenH}|dx=${shift.dx},dy=${shift.dy}|diag=${diag}|axes=iIsRow:${Boolean(axes?.iIsRow)}`;

  let o0;
  try {
    o0 = grid.getOffset(origin);
  } catch (_e) {
    return { key, segments: [] };
  }
  const rc0 = _gridOffToRC(o0, axes);

  const included = _getTokenFootprintCellsRC(token, grid, axes);

  // Bounding box search in grid space (deterministic; respects diagonal rules via measurePath).
  // Use a quick euclidean px gate to avoid unnecessary measurePath calls.
  const pxPerUnit = _getPxPerUnit();
  const maxPx = (Number(radiusUnits) || 0) * pxPerUnit + size;
  const maxPx2 = maxPx * maxPx;

  for (let r = rc0.r - maxSteps; r <= rc0.r + maxSteps; r++) {
    for (let c = rc0.c - maxSteps; c <= rc0.c + maxSteps; c++) {
      const rc = { r, c };
      let center;
      try {
        center = _getCellCenterWorld(grid, rc, axes);
      } catch (_e) {
        continue;
      }

      const dx = (center?.x ?? 0) - origin.x;
      const dy = (center?.y ?? 0) - origin.y;
      if ((dx * dx + dy * dy) > maxPx2) continue;

      const d = _measureGridDistanceUnits(origin, center);
      if (d <= (radiusUnits + 1e-6)) included.add(_rcKey(r, c));
    }
  }

  const has = (r, c) => included.has(_rcKey(r, c));

  // Extract boundary edges in grid-space and merge into long segments to avoid corner seams.
  /** @type {Map<number, Array<[number,number]>>} */
  const hEdges = new Map(); // yGrid -> [[x0,x1], ...]
  /** @type {Map<number, Array<[number,number]>>} */
  const vEdges = new Map(); // xGrid -> [[y0,y1], ...]

  for (const k of included) {
    const { r, c } = _parseRcKey(k);
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
    for (const [x0, x1] of _mergeRanges(ranges)) {
      try {
        // Prefer using a real cell row when possible to avoid edge-case failures at extreme boundaries.
        let tl = null;
        let yWorld = null;
        try {
          tl = _getCellTopLeftWorld(grid, { r: yGrid, c: x0 }, axes);
          yWorld = tl.y;
        } catch (_e1) {
          tl = _getCellTopLeftWorld(grid, { r: yGrid - 1, c: x0 }, axes);
          yWorld = tl.y + size;
        }

        const xWorld0 = tl.x;
        const xWorld1 = tl.x + ((x1 - x0) * size);

        const x0s = _snapWorldEdge(xWorld0) - origin.x;
        const x1s = _snapWorldEdge(xWorld1) - origin.x;
        const ys = _snapWorldLine(yWorld, wPx) - origin.y;
        segments.push([x0s, ys, x1s, ys]);
      } catch (_e) {
        // ignore
      }
    }
  }

  // Vertical segments
  for (const [xGrid, ranges] of vEdges.entries()) {
    for (const [y0, y1] of _mergeRanges(ranges)) {
      try {
        let tl = null;
        let xWorld = null;
        try {
          tl = _getCellTopLeftWorld(grid, { r: y0, c: xGrid }, axes);
          xWorld = tl.x;
        } catch (_e1) {
          tl = _getCellTopLeftWorld(grid, { r: y0, c: xGrid - 1 }, axes);
          xWorld = tl.x + size;
        }

        const yWorld0 = tl.y;
        const yWorld1 = tl.y + ((y1 - y0) * size);

        const xs = _snapWorldLine(xWorld, wPx) - origin.x;
        const y0s = _snapWorldEdge(yWorld0) - origin.y;
        const y1s = _snapWorldEdge(yWorld1) - origin.y;
        segments.push([xs, y0s, xs, y1s]);
      } catch (_e) {
        // ignore
      }
    }
  }

  return { key, segments };
}

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
function _computeHexGridOutline(token, radiusUnits, lineWidthPx) {
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

  const originKey = _offKey(o0);
  /** @type {Map<string, number>} */
  const dist = new Map([[originKey, 0]]);
  const queue = [originKey];
  let qi = 0;

  /** @type {Map<string, string[]>} */
  const neighborCache = new Map();
  const getNeighbors = (keyStr) => {
    const cached = neighborCache.get(keyStr);
    if (cached) return cached;

    const off = _parseOffKey(keyStr);
    let poly;
    try {
      poly = _getCellPolygonWorldForOffset(grid, off);
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
      const sample = _sampleOutsideEdge(grid, off, poly, e);
      let nOff;
      try {
        nOff = grid.getOffset(sample);
      } catch (_e) {
        nOff = null;
      }
      if (!nOff) continue;
      const nk = _offKey(nOff);
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
    const off = _parseOffKey(keyStr);

    let poly;
    try {
      poly = _getCellPolygonWorldForOffset(grid, off);
    } catch (_e) {
      continue;
    }
    if (!poly?.length) continue;

    // Boundary detection: for each cell edge, sample a point just outside the edge and see which cell it maps to.
    for (let e = 0; e < poly.length; e++) {
      const sample = _sampleOutsideEdge(grid, off, poly, e);
      let nOff;
      try {
        nOff = grid.getOffset(sample);
      } catch (_e) {
        nOff = null;
      }
      const nk = nOff ? _offKey(nOff) : null;
      if (nk && hasKey(nk)) continue;

      const a = poly[e];
      const b = poly[(e + 1) % poly.length];
      const x1 = a.x - origin.x;
      const y1 = a.y - origin.y;
      const x2 = b.x - origin.x;
      const y2 = b.y - origin.y;
      const ek = _edgeKey(x1, y1, x2, y2);
      if (seenEdges.has(ek)) continue;
      seenEdges.add(ek);
      edges.push([x1, y1, x2, y2]);
    }
  }

  return { key, edges };
}

/* -------------------------------------------- */
/* Overlay sync + redraw                         */
/* -------------------------------------------- */

function _getCandidateTokens() {
  const tokens = canvas?.tokens?.placeables ?? [];
  if (!_enabled || !_settings.enabled) return [];

  // Everyone: GM sees all tokens; non-GM still only sees visible tokens.
  if (_settings.behaviour === REACH_BEHAVIOUR.EVERYONE) {
    if (game.user?.isGM) return tokens;
    return tokens.filter(t => t?.isVisible);
  }

  // Visible tokens for active user.
  return tokens.filter(t => t?.isVisible);
}

function _getDisplayTokens(candidates) {
  const vis = _settings.visibility;

  if (vis === REACH_VISIBILITY.HOVER) {
    if (_hoveredToken && candidates.some(t => t.id === _hoveredToken.id)) return [_hoveredToken];
    return [];
  }

  // ALWAYS or DYNAMIC: show all candidates (alpha differs).
  return candidates;
}

function _ensureOverlayEntry(token) {
  const id = token.id;
  const existing = _tokenOverlays.get(id);
  if (existing && existing.container && !existing.container.destroyed) return existing;

  const overlay = _getOverlayContainer();
  if (!overlay) return null;

  const container = new PIXI.Container();
  container.sortableChildren = true;
  container.zIndex = 0;
  container.alpha = _getOverlayAlphaForToken(token);

  const maxG = new PIXI.Graphics();
  maxG.zIndex = 1;

  const minG = new PIXI.Graphics();
  minG.zIndex = 2;

  container.addChild(maxG);
  container.addChild(minG);

  const entry = { container, maxG, minG, label: null, distLabel: null, lastKey: null, gridCache: {} };

  // Labels are always created so toggling settings doesn't require rebuilding overlay entries.
  {
    const text = new PIXI.Text("", {
      fontFamily: "Signika",
      fontSize: 14,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 4,
      align: "center",
    });
    text.anchor.set(0.5, 1.0);
    text.zIndex = 10;
    entry.label = text;
    container.addChild(text);
  }

  {
    const text = new PIXI.Text("", {
      fontFamily: "Signika",
      fontSize: 12,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 4,
      align: "center",
    });
    text.anchor.set(0.5, 0.0);
    text.zIndex = 11;
    entry.distLabel = text;
    container.addChild(text);
  }

  overlay.addChild(container);
  _tokenOverlays.set(id, entry);
  return entry;
}

function _destroyOverlayEntry(tokenId) {
  const entry = _tokenOverlays.get(tokenId);
  if (!entry) return;

  try { entry.container?.parent?.removeChild?.(entry.container); } catch (_e) { /* no-op */ }
  try { entry.container?.destroy?.({ children: true }); } catch (_e) { /* no-op */ }
  _tokenOverlays.delete(tokenId);
}

function _syncOverlays(tokens) {
  const wanted = new Set(tokens.map(t => t.id));

  // Remove unused.
  for (const id of Array.from(_tokenOverlays.keys())) {
    if (!wanted.has(id)) _destroyOverlayEntry(id);
  }

  // Ensure wanted exist.
  for (const t of tokens) _ensureOverlayEntry(t);
}

function _renderKeyForToken(token, bounds) {
  const grid = canvas?.grid;
  const scene = canvas?.scene;
  const pxPerUnit = _getPxPerUnit();

  // Any change in these should trigger a redraw.
  const key = [
    String(_settings.shape),
    String(_settings.colorMode),
    String(_settings.uniformColor ?? ""),
    Number(token?.document?.disposition ?? 0),
    Number(_settings.lineWidth),
    // bounds
    Number(bounds.max),
    Number(bounds.min),
    // token footprint (grid-aware)
    Number(token?.document?.width ?? 1),
    Number(token?.document?.height ?? 1),
    Number(token?.w ?? 0),
    Number(token?.h ?? 0),
    // grid info
    Number(grid?.size ?? 0),
    Number(scene?.grid?.distance ?? 0),
    String(scene?.grid?.type ?? ""),
    String(scene?.grid?.diagonals ?? scene?.grid?.diagonalRule ?? grid?.diagonalRule ?? ""),
    Number(pxPerUnit),
  ].join("|");

  return key;
}

function _positionOverlay(token, entry) {
  // Container is positioned at token center; all graphics are drawn around (0,0) in local space.
  const c = token?.center;
  if (!c) return;

  entry.container.position.set(c.x, c.y);

  // Label offsets
  const topY = -(token.h / 2) - 4;
  if (entry.label) entry.label.position.set(0, topY);
  if (entry.distLabel) entry.distLabel.position.set(0, (token.h / 2) + 4);
}

function _updateLabels(token, entry, bounds) {
  const units = _getSceneUnitsLabel();

  if (entry.label) {
    entry.label.text = bounds.max > 0 ? `${bounds.max} ${units}`.trim() : "";
    entry.label.visible = Boolean(_settings.showLabel && bounds.max > 0);
  }

  if (entry.distLabel) {
    // Only show when exactly one target and the token is controlled (matches prior behavior).
    const controlled = Boolean(token?.controlled);
    const targets = Array.from(game.user?.targets ?? []);
    if (!_settings.showTargetDistance || !controlled || targets.length !== 1) {
      entry.distLabel.text = "";
      entry.distLabel.visible = false;
    } else {
      const target = targets[0];
      const d = _measure3dDistanceUnits(token, target);
      entry.distLabel.text = `${Math.round(d * 10) / 10} ${units}`.trim();
      entry.distLabel.visible = true;
    }
  }
}

function _redrawTokenOverlay(token) {
  const actor = token?.actor;
  const entry = token ? _tokenOverlays.get(token.id) : null;
  if (!actor || !entry) return;

  const active = _getActiveMeleeWeapon(actor);
  const bounds = active?.bounds ?? { max: 0, min: 0 };
  const maxU = Number(bounds.max) || 0;
  const minU = Number(bounds.min) || 0;

  const renderKey = _renderKeyForToken(token, bounds);
  if (entry.lastKey === renderKey) {
    // Geometry unchanged; still refresh alpha + labels.
    _applyOverlayAlpha(token);
    _positionOverlay(token, entry);
    _updateLabels(token, entry, bounds);
    return;
  }
  entry.lastKey = renderKey;

  const color = _getTokenColor(token);
  const lineWidth = _clampNumber(_settings.lineWidth, 1, 12, 2);

  // Clear
  entry.maxG.clear();
  entry.minG.clear();

  // Nothing to draw if no reach.
  if (maxU <= 0) {
    if (entry.label) entry.label.text = "";
    if (entry.distLabel) entry.distLabel.text = "";
    return;
  }

  // Geometry
  const origin = token.center;
  const pxPerUnit = _getPxPerUnit();
  const maxPx = maxU * pxPerUnit;
  const minPx = minU * pxPerUnit;

  const doGrid = (_settings.shape === REACH_SHAPE.GRID) && !_isGridlessScene() && (_isSquareGrid() || _isHexGrid());

  // MAX boundary (solid)
  if (doGrid) {
    if (_isSquareGrid()) {
      const cached = entry.gridCache?.max;
      const outline = _computeSquareGridOutline(token, maxU, lineWidth);
      if (!cached || cached.key !== outline.key) entry.gridCache.max = outline;
      const segs = (entry.gridCache.max?.segments ?? outline.segments);
      _drawSolidGridSegments(entry.maxG, segs, lineWidth, color);
    } else {
      const cached = entry.gridCache?.max;
      const outline = _computeHexGridOutline(token, maxU, lineWidth);
      if (!cached || cached.key !== outline.key) entry.gridCache.max = outline;
      const edges = (entry.gridCache.max?.edges ?? outline.edges);
      _drawSolidEdgeQuads(entry.maxG, edges, lineWidth, color);
    }
  } else {
    entry.maxG.lineStyle({ width: lineWidth, color, alpha: 1.0 });
    entry.maxG.drawCircle(0, 0, maxPx);
  }

  // MIN boundary (dashed) when present
  if (minU > 0) {
    const minLineWidth = Math.max(1, lineWidth - 1);

    if (doGrid) {
      if (_isSquareGrid()) {
        const outline = _computeSquareGridOutline(token, minU, minLineWidth);
        const cached = entry.gridCache?.min;
        if (!cached || cached.key !== outline.key) entry.gridCache.min = outline;
        const segs = (entry.gridCache.min?.segments ?? outline.segments);
        _drawDashedGridSegments(entry.minG, segs, minLineWidth, color);
      } else {
        const outline = _computeHexGridOutline(token, minU, minLineWidth);
        const cached = entry.gridCache?.min;
        if (!cached || cached.key !== outline.key) entry.gridCache.min = outline;
        const edges = (entry.gridCache.min?.edges ?? outline.edges);
        _drawDashedEdgeQuads(entry.minG, edges, minLineWidth, color);
      }
    } else {
      entry.minG.lineStyle({ width: minLineWidth, color, alpha: 1.0 });
      _drawDashedCircle(entry.minG, minPx, 10, 6);
    }
  } else {
    entry.gridCache.min = null;
  }

  _applyOverlayAlpha(token);
  _positionOverlay(token, entry);
  _updateLabels(token, entry, bounds);
}

function redrawReachOverlays() {
  if (!_enabled || !_settings.enabled) return;

  const overlay = _getOverlayContainer();
  if (!overlay) return;

  overlay.visible = true;

  const candidates = _getCandidateTokens();
  const display = _getDisplayTokens(candidates);

  _syncOverlays(display);

  for (const t of display) _redrawTokenOverlay(t);
}

/* -------------------------------------------- */
/* Settings application + toggle                 */
/* -------------------------------------------- */

function _setEnabled(enabled) {
  _enabled = Boolean(enabled);
  const overlay = _getOverlayContainer();
  if (overlay) overlay.visible = _enabled;
  if (!_enabled) _syncOverlays([]);
}

export async function toggleReachVisualizer(enabled) {
  const next = Boolean(enabled);
  await setReachVisualizerSettings({ enabled: next });
  applySettings();
}

export function applySettings(partial = null) {
  // Pull latest from settings and normalize.
  const stored = partial && typeof partial === "object" ? partial : getReachVisualizerSettings();
  _settings = normalizeReachVisualizerSettings(stored);
  _setEnabled(_settings.enabled);

  // Immediate redraw (debounced where possible).
  if (_debouncedRedraw) _debouncedRedraw();
  else redrawReachOverlays();
}

/* -------------------------------------------- */
/* Hooks                                        */
/* -------------------------------------------- */

function _registerHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  const debounce = foundry?.utils?.debounce;
  _debouncedRedraw = (typeof debounce === "function")
    ? debounce(() => redrawReachOverlays(), 25)
    : (() => redrawReachOverlays());

  Hooks.once("canvasReady", () => {
    // Ensure overlay exists and reflects settings.
    try { _getOverlayContainer(); } catch (_e) { /* no-op */ }
    _debouncedRedraw();
  });

  Hooks.on("canvasTearDown", () => {
    _destroyOverlayContainer();
  });

  Hooks.on("hoverToken", (token, hovered) => {
    if (!_enabled || !_settings.enabled) return;

    const prev = _hoveredToken;
    _hoveredToken = hovered ? token : null;

    if (_settings.visibility === REACH_VISIBILITY.DYNAMIC) {
      if (prev) _applyOverlayAlpha(prev);
      if (_hoveredToken) _applyOverlayAlpha(_hoveredToken);
      return;
    }

    if (_settings.visibility === REACH_VISIBILITY.HOVER) {
      _debouncedRedraw();
    }
  });

  Hooks.on("sightRefresh", () => {
    if (!_enabled || !_settings.enabled) return;
    _debouncedRedraw();
  });

  Hooks.on("updateToken", (_doc, _changes, _opts, _userId) => {
    if (!_enabled || !_settings.enabled) return;
    _debouncedRedraw();
  });

  // During token drag / refresh, keep overlay container aligned without redrawing geometry.
  Hooks.on("refreshToken", (token) => {
    if (!_enabled || !_settings.enabled) return;
    const entry = _tokenOverlays.get(token?.id);
    if (!entry) return;

    _positionOverlay(token, entry);
    _applyOverlayAlpha(token);

    // Labels may depend on target selection/elevation; update without geometry redraw.
    try {
      const actor = token?.actor;
      if (actor) {
        const active = _getActiveMeleeWeapon(actor);
        const bounds = active?.bounds ?? { max: 0, min: 0 };
        _updateLabels(token, entry, bounds);
      }
    } catch (_e) {
      // no-op
    }
  });

  Hooks.on("controlToken", () => {
    if (!_enabled || !_settings.enabled) return;
    if (_settings.showTargetDistance) _debouncedRedraw();
  });

  Hooks.on("targetToken", () => {
    if (!_enabled || !_settings.enabled) return;
    if (_settings.showTargetDistance) _debouncedRedraw();
  });

  // Track last used melee weapon when system emits a hint (optional integration point).
  // This avoids any "sheet coupling" and keeps reach source-of-truth deterministic.
  Hooks.on("uesrpg:lastUsedMeleeWeapon", (actorId, weaponId) => {
    try {
      if (!actorId || !weaponId) return;
      void setLastMeleeWeaponForActor(actorId, weaponId);
      if (_settings.reachSource === REACH_SOURCE.LAST_USED) _debouncedRedraw();
    } catch (_e) {
      // no-op
    }
  });
}

/* -------------------------------------------- */
/* Registration                                 */
/* -------------------------------------------- */

export function registerReachVisualizer() {
  _registerHooks();
  applySettings();

  // Canvas control button.
  Hooks.on("getSceneControlButtons", (controls) => {
    // Foundry v13: controls is a Record<string, SceneControl>.
    const tokenControl = controls?.tokens ?? controls?.token;
    if (!tokenControl?.tools) return;

    const existing = tokenControl.tools[CONTROL_TOOL_NAME];
    const nextOrder = (() => {
      const orders = Object.values(tokenControl.tools)
        .map(t => Number(t?.order))
        .filter(n => Number.isFinite(n));
      return orders.length ? (Math.max(...orders) + 1) : Object.keys(tokenControl.tools).length;
    })();

    tokenControl.tools[CONTROL_TOOL_NAME] = {
      name: CONTROL_TOOL_NAME,
      title: "Reach Visualizer",
      icon: "fas fa-bullseye",
      toggle: true,
      active: Boolean(_settings.enabled),
      visible: Boolean(game.user?.isGM || game.user?.role >= 1),
      order: Number.isFinite(existing?.order) ? existing.order : nextOrder,
      onChange: async (_event, active) => {
        await toggleReachVisualizer(Boolean(active));
      },
    };
  });

  // Public API
  game.uesrpg = game.uesrpg || {};
  game.uesrpg.reachVisualizer = {
    toggle: toggleReachVisualizer,
    applySettings,
    redraw: redrawReachOverlays,
    get settings() { return _settings; },
  };
}
