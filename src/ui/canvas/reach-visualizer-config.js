/**
 * src/ui/canvas/reach-visualizer-config.js
 *
 * Client-scoped configuration for the Reach Visualizer.
 * - Must be deterministic and backwards-compatible with previously stored settings.
 */

export const REACH_VISUALIZER_NAMESPACE = "uesrpg-3ev4";
export const REACH_VISUALIZER_SETTING_KEY = "reachVisualizer";

export const REACH_BEHAVIOUR = Object.freeze({
  // NOTE: "selected" was removed; kept for migration only.
  SELECTED: "selected",
  VISIBLE: "visible",
  EVERYONE: "everyone",
});

export const REACH_VISIBILITY = Object.freeze({
  ALWAYS: "always",
  HOVER: "hover",
  DYNAMIC: "dynamic",
});

export const REACH_SHAPE = Object.freeze({
  CIRCLE: "circle",
  GRID: "grid",
});

export const REACH_SOURCE = Object.freeze({
  MAX_EQUIPPED: "maxEquipped",
  LAST_USED: "lastUsed",
});

export const REACH_COLOR_MODE = Object.freeze({
  DISPOSITION: "disposition",
  UNIFORM: "uniform",
});

export const DEFAULT_REACH_VISUALIZER_SETTINGS = Object.freeze({
  // Behaviour
  enabled: false,
  behaviour: REACH_BEHAVIOUR.VISIBLE,
  visibility: REACH_VISIBILITY.DYNAMIC,

  // Data
  reachSource: REACH_SOURCE.MAX_EQUIPPED,

  // Rendering
  shape: REACH_SHAPE.CIRCLE,
  lineWidth: 2,

  // Visibility opacities
  // - For ALWAYS/HOVER, use `opacity`
  // - For DYNAMIC, use `passiveOpacity` and `activeOpacity`
  opacity: 0.35,
  passiveOpacity: 0.20,
  activeOpacity: 0.80,

  // Color
  colorMode: REACH_COLOR_MODE.DISPOSITION,
  uniformColor: "#33ff66",

  // Labels
  showLabel: true,
  showTargetDistance: true,
  includeElevation: false,
});

function _deepClone(obj) {
  const cloner = foundry?.utils?.deepClone;
  if (typeof cloner === "function") return cloner(obj);
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (_e) {
    return { ...obj };
  }
}

function _mergeObject(target, source) {
  const merger = foundry?.utils?.mergeObject;
  if (typeof merger === "function") return merger(target, source, { inplace: false, overwrite: true, insertKeys: true, insertValues: true });
  return { ...target, ...(source ?? {}) };
}

function _clampNumber(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function _normalizeHexColor(value, fallback = DEFAULT_REACH_VISUALIZER_SETTINGS.uniformColor) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const v = raw.startsWith("#") ? raw : `#${raw}`;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const s = v.slice(1);
    return (`#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`).toLowerCase();
  }
  return fallback;
}

/**
 * Normalize a raw settings payload into a complete, valid settings object.
 * Backwards-compatible migrations:
 * - behaviour "selected" -> "visible"
 * - visibility missing/unknown -> default
 * - missing dynamic opacity fields -> defaults
 * @param {object} raw
 * @returns {object}
 */
export function normalizeReachVisualizerSettings(raw) {
  const base = _deepClone(DEFAULT_REACH_VISUALIZER_SETTINGS);
  const merged = _mergeObject(base, (raw && typeof raw === "object") ? raw : {});

  merged.enabled = Boolean(merged.enabled);

  const behaviour = String(merged.behaviour ?? "");
  if (behaviour === REACH_BEHAVIOUR.SELECTED) merged.behaviour = REACH_BEHAVIOUR.VISIBLE;
  else if (![REACH_BEHAVIOUR.VISIBLE, REACH_BEHAVIOUR.EVERYONE].includes(behaviour)) merged.behaviour = DEFAULT_REACH_VISUALIZER_SETTINGS.behaviour;

  const visibility = String(merged.visibility ?? "");
  if (!Object.values(REACH_VISIBILITY).includes(visibility)) merged.visibility = DEFAULT_REACH_VISUALIZER_SETTINGS.visibility;

  const shape = String(merged.shape ?? "");
  if (!Object.values(REACH_SHAPE).includes(shape)) merged.shape = DEFAULT_REACH_VISUALIZER_SETTINGS.shape;

  const reachSource = String(merged.reachSource ?? "");
  if (!Object.values(REACH_SOURCE).includes(reachSource)) merged.reachSource = DEFAULT_REACH_VISUALIZER_SETTINGS.reachSource;

  const colorMode = String(merged.colorMode ?? "");
  if (!Object.values(REACH_COLOR_MODE).includes(colorMode)) merged.colorMode = DEFAULT_REACH_VISUALIZER_SETTINGS.colorMode;

  merged.uniformColor = _normalizeHexColor(merged.uniformColor);

  merged.lineWidth = _clampNumber(merged.lineWidth, { min: 1, max: 12, fallback: DEFAULT_REACH_VISUALIZER_SETTINGS.lineWidth });
  merged.opacity = _clampNumber(merged.opacity, { min: 0.05, max: 1.0, fallback: DEFAULT_REACH_VISUALIZER_SETTINGS.opacity });

  merged.passiveOpacity = _clampNumber(merged.passiveOpacity, { min: 0.05, max: 1.0, fallback: DEFAULT_REACH_VISUALIZER_SETTINGS.passiveOpacity });
  merged.activeOpacity = _clampNumber(merged.activeOpacity, { min: 0.05, max: 1.0, fallback: DEFAULT_REACH_VISUALIZER_SETTINGS.activeOpacity });

  // Ensure dynamic active >= passive (prevents "hover makes it dimmer" surprises).
  if (merged.activeOpacity < merged.passiveOpacity) {
    const tmp = merged.activeOpacity;
    merged.activeOpacity = merged.passiveOpacity;
    merged.passiveOpacity = tmp;
  }

  merged.showLabel = Boolean(merged.showLabel);
  merged.showTargetDistance = Boolean(merged.showTargetDistance);
  merged.includeElevation = Boolean(merged.includeElevation);

  return merged;
}

/**
 * Read the current reach visualizer settings (client-scoped), with defaults applied.
 * @returns {object}
 */
export function getReachVisualizerSettings() {
  try {
    const raw = game?.settings?.get(REACH_VISUALIZER_NAMESPACE, REACH_VISUALIZER_SETTING_KEY);
    return normalizeReachVisualizerSettings(raw);
  } catch (_e) {
    return normalizeReachVisualizerSettings({});
  }
}

/**
 * Merge and store reach visualizer settings.
 * @param {object} partial
 */
export async function setReachVisualizerSettings(partial) {
  const current = getReachVisualizerSettings();
  const merged = _mergeObject(_deepClone(current), (partial && typeof partial === "object") ? partial : {});
  const normalized = normalizeReachVisualizerSettings(merged);
  await game.settings.set(REACH_VISUALIZER_NAMESPACE, REACH_VISUALIZER_SETTING_KEY, normalized);
}
