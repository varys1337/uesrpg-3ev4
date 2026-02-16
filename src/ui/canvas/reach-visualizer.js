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
 * - Modular architecture: geometry, rendering, and weapon logic extracted
 *
 * Foundry VTT v13.351 compatible.
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
import { setLastMeleeWeaponForActor } from "./reach-visualizer-state.js";
import { getActiveMeleeWeapon } from "./reach-visualizer-weapons.js";
import { computeSquareGridOutline, computeHexGridOutline, measureGridDistanceUnits } from "./reach-visualizer-geometry.js";
import {
  drawDashedCircle,
  drawSolidGridSegments,
  drawDashedGridSegments,
  drawSolidEdgeQuads,
  drawDashedEdgeQuads,
} from "./reach-visualizer-render.js";

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

function _getElevationUnits(token) {
  const e = token?.document?.elevation;
  const n = Number(e);
  return Number.isFinite(n) ? n : 0;
}

function _measure3dDistanceUnits(fromToken, toToken) {
  const a = fromToken?.center;
  const b = toToken?.center;
  if (!a || !b) return 0;

  const horizontal = measureGridDistanceUnits(a, b);
  if (!_settings.includeElevation) return horizontal;

  const dz = _getElevationUnits(toToken) - _getElevationUnits(fromToken);
  return Math.sqrt((horizontal * horizontal) + (dz * dz));
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

/* -------------------------------------------- */
/* Overlay Container Management                 */
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

  const active = getActiveMeleeWeapon(actor, _settings.reachSource);
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
      const outline = computeSquareGridOutline(token, maxU, lineWidth);
      if (!cached || cached.key !== outline.key) entry.gridCache.max = outline;
      const segs = (entry.gridCache.max?.segments ?? outline.segments);
      drawSolidGridSegments(entry.maxG, segs, lineWidth, color);
    } else {
      const cached = entry.gridCache?.max;
      const outline = computeHexGridOutline(token, maxU, lineWidth);
      if (!cached || cached.key !== outline.key) entry.gridCache.max = outline;
      const edges = (entry.gridCache.max?.edges ?? outline.edges);
      drawSolidEdgeQuads(entry.maxG, edges, lineWidth, color);
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
        const outline = computeSquareGridOutline(token, minU, minLineWidth);
        const cached = entry.gridCache?.min;
        if (!cached || cached.key !== outline.key) entry.gridCache.min = outline;
        const segs = (entry.gridCache.min?.segments ?? outline.segments);
        drawDashedGridSegments(entry.minG, segs, minLineWidth, color);
      } else {
        const outline = computeHexGridOutline(token, minU, minLineWidth);
        const cached = entry.gridCache?.min;
        if (!cached || cached.key !== outline.key) entry.gridCache.min = outline;
        const edges = (entry.gridCache.min?.edges ?? outline.edges);
        drawDashedEdgeQuads(entry.minG, edges, minLineWidth, color);
      }
    } else {
      entry.minG.lineStyle({ width: minLineWidth, color, alpha: 1.0 });
      drawDashedCircle(entry.minG, minPx, 10, 6);
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
        const active = getActiveMeleeWeapon(actor, _settings.reachSource);
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
}

/* -------------------------------------------- */
/* Registration                                 */
/* -------------------------------------------- */

export function registerReachVisualizer() {
  _registerHooks();
  applySettings();

  // Public API
  game.uesrpg = game.uesrpg || {};
  game.uesrpg.reachVisualizer = {
    toggle: toggleReachVisualizer,
    applySettings,
    redraw: redrawReachOverlays,
    get settings() { return _settings; },
  };
}
