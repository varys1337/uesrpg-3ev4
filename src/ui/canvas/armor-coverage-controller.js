/**
 * src/ui/canvas/armor-coverage-controller.js
 *
 * Hook coordinator for compact armor coverage overlay.
 */

import { resolveArmorCoverage } from "../../core/combat/armor-coverage-service.js";
import { buildArmorCoverageViewModel } from "./armor-coverage-presenter.js";
import { ArmorCoverageOverlay } from "./armor-coverage-overlay.js";

export const ARMOR_COVERAGE_OVERLAY_MODES = Object.freeze({
  DISABLED: "disabled",
  COMPACT: "compact"
});

const NAMESPACE = "uesrpg-3ev4";
export const ARMOR_COVERAGE_MODE_SETTING = "armorCoverageOverlayMode";
export const ARMOR_COVERAGE_TRANSPARENCY_SETTING = "armorCoverageOverlayTransparency";
export const DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS = Object.freeze({
  mode: ARMOR_COVERAGE_OVERLAY_MODES.DISABLED,
  transparency: 90
});

let _hooksRegistered = false;
let _overlay = null;
let _hoveredToken = null;
let _debouncedRender = null;
let _settings = { ...DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS };

export function normalizeArmorCoverageOverlaySettings(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  let mode = String(source.mode ?? DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS.mode);
  const transparency = Number(source.transparency ?? DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS.transparency);

  if (!Object.values(ARMOR_COVERAGE_OVERLAY_MODES).includes(mode)) mode = ARMOR_COVERAGE_OVERLAY_MODES.DISABLED;
  return {
    mode,
    transparency: Number.isFinite(transparency)
      ? Math.max(0, Math.min(100, transparency))
      : DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS.transparency
  };
}

function _readSettings() {
  let mode = DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS.mode;
  let transparency = DEFAULT_ARMOR_COVERAGE_OVERLAY_SETTINGS.transparency;
  try { mode = game?.settings?.get?.(NAMESPACE, ARMOR_COVERAGE_MODE_SETTING) ?? mode; } catch (_e) { /* no-op */ }
  try { transparency = game?.settings?.get?.(NAMESPACE, ARMOR_COVERAGE_TRANSPARENCY_SETTING) ?? transparency; } catch (_e) { /* no-op */ }
  return normalizeArmorCoverageOverlaySettings({ mode, transparency });
}

function _isEnabled() {
  return _settings.mode === ARMOR_COVERAGE_OVERLAY_MODES.COMPACT;
}

function _getOverlay() {
  if (!_overlay) {
    _overlay = new ArmorCoverageOverlay();
    // Set initial transparency from settings
    _overlay.setTransparency(_settings.transparency);
  }
  return _overlay;
}

function _canViewTokenCoverage(token) {
  if (!token?.actor) return false;
  if (token.isVisible === false) return false;
  // Default to "visible tokens" behavior (always show for visible tokens)
  return true;
}

function _displayTokens() {
  if (!_isEnabled()) return [];
  if (_hoveredToken && _canViewTokenCoverage(_hoveredToken)) return [_hoveredToken];
  return [];
}

function _renderNow() {
  if (!_isEnabled()) {
    _overlay?.destroy();
    return;
  }

  const overlay = _getOverlay();
  const tokens = _displayTokens();
  overlay.clearExcept(tokens.map(token => token.id));
  for (const token of tokens) {
    const payload = resolveArmorCoverage(token);
    const canSeeDetails = Boolean(game?.user?.isGM || token.actor?.isOwner);
    const viewModel = buildArmorCoverageViewModel(payload, { includeSourceNames: canSeeDetails });
    overlay.updateToken(token, viewModel);
  }
}

function _scheduleRender() {
  if (!_debouncedRender) {
    const debounce = foundry?.utils?.debounce;
    _debouncedRender = (typeof debounce === "function") ? debounce(_renderNow, 25) : _renderNow;
  }
  _debouncedRender();
}

function _actorTokenIds(actor) {
  const actorId = String(actor?.id ?? "");
  if (!actorId) return [];
  return (canvas?.tokens?.placeables ?? [])
    .filter(token => String(token?.actor?.id ?? "") === actorId)
    .map(token => String(token.id));
}

function _refreshTokensById(ids) {
  if (!_isEnabled()) return;
  const wanted = new Set((ids ?? []).map(id => String(id)).filter(Boolean));
  const active = _displayTokens().map(token => String(token.id));
  if (!active.some(id => wanted.has(id))) return;
  _scheduleRender();
}

export function isArmorCoverageItemChangeRelevant(item, changed) {
  if (String(item?.type ?? "") !== "armor") return false;
  if (!item?.parent || item.parent.documentName !== "Actor") return false;
  if (!changed || Object.keys(changed ?? {}).length === 0) return true;
  return foundry.utils.hasProperty(changed, "system.equipped")
    || foundry.utils.hasProperty(changed, "system.hitLocations")
    || foundry.utils.hasProperty(changed, "system.armorClass")
    || foundry.utils.hasProperty(changed, "system.qualitiesStructured");
}

function _registerHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  Hooks.once("canvasReady", () => {
    _settings = _readSettings();
    if (_isEnabled()) _scheduleRender();
  });

  Hooks.on("canvasTearDown", () => {
    _hoveredToken = null;
    _debouncedRender = null;
    _overlay?.destroy();
    _overlay = null;
  });

  Hooks.on("hoverToken", (token, hovered) => {
    if (!_isEnabled()) return;
    _hoveredToken = hovered ? token : (_hoveredToken?.id === token?.id ? null : _hoveredToken);
    _scheduleRender();
  });

  Hooks.on("targetToken", () => {
    if (!_isEnabled()) return;
    _scheduleRender();
  });

  Hooks.on("refreshToken", (token) => {
    if (!_isEnabled()) return;
    _overlay?.positionToken(token);
  });

  Hooks.on("updateToken", (doc) => {
    if (!_isEnabled()) return;
    _refreshTokensById([doc?.id]);
  });

  Hooks.on("deleteToken", (doc) => {
    const tokenId = String(doc?.id ?? "");
    if (_hoveredToken && String(_hoveredToken.id) === tokenId) _hoveredToken = null;
    _overlay?.destroyToken(tokenId);
    _scheduleRender();
  });

  Hooks.on("updateItem", (item, changed) => {
    if (!_isEnabled()) return;
    if (!isArmorCoverageItemChangeRelevant(item, changed)) return;
    _refreshTokensById(_actorTokenIds(item.parent));
  });

  Hooks.on("updateActor", (actor) => {
    if (!_isEnabled()) return;
    _refreshTokensById(_actorTokenIds(actor));
  });
}

export function applyArmorCoverageOverlaySettings() {
  _settings = _readSettings();
  if (!_isEnabled()) {
    _hoveredToken = null;
    _overlay?.destroy();
    _overlay = null;
    return;
  }
  // Update overlay transparency if it exists
  if (_overlay) {
    _overlay.setTransparency(_settings.transparency);
  }
  _scheduleRender();
}

export function buildArmorCoverageOverlayApi() {
  return {
    applySettings: applyArmorCoverageOverlaySettings,
    redraw: _renderNow,
    get settings() { return { ..._settings }; }
  };
}

export function registerArmorCoverageOverlay() {
  _registerHooks();
  applyArmorCoverageOverlaySettings();
  return buildArmorCoverageOverlayApi();
}

export function canViewArmorCoverageForToken(token) {
  _settings = _readSettings();
  return _canViewTokenCoverage(token);
}
