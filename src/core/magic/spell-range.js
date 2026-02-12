/**
 * @module magic/spell-range
 *
 * src/core/magic/spell-range.js
 *
 * Range gating and spell range utilities.
 * Target: Foundry VTT v13.351.
 *
 * AoE template placement has been moved to src/core/aoe/ (AoEService).
 * This module retains range configuration helpers and target-by-range filtering.
 */

import { _str, _num as _numBase } from "./_primitives.js";

/** @private Coerce to number with null fallback (unique to spell-range). */
function _num(v, fallback = null) {
  return _numBase(v, fallback);
}

/**
 * Parse a meters value from free-text.
 * Accepts: "100", "100m", "100 m", "100 meters", "100m (something)".
 * @param {string} text
 * @returns {number|null}
 */
export function parseMeters(text) {
  const raw = _str(text).trim();
  if (!raw) return null;

  const m = raw.match(/(\d+(?:\.\d+)?)\s*(m|meter|meters)?/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * Canonical spell range type.
 *
 * This is consumed by actor-sheet.js and npc-sheet.js to decide whether to:
 *  - filter explicit targets by range (ranged/melee), or
 *  - initiate AoE template placement (aoe).
 *
 * Accepted values: "none" | "ranged" | "melee" | "aoe"
 *
 * @param {Item} spell
 * @returns {"none"|"ranged"|"melee"|"aoe"}
 */
export function getSpellRangeType(spell) {
  const sys = spell?.system ?? {};

  // Primary lane: explicit selector field used by the spell sheet.
  const t = _str(sys.rangeType).trim().toLowerCase();
  if (t && ["none", "ranged", "melee", "aoe"].includes(t)) return /** @type any */ (t);

  // Conservative fallback: do NOT attempt to infer range type from free-text.
  // Legacy spells will behave as "none" until configured explicitly.
  // The only exception is when AoE configuration is explicitly and meaningfully present
  // (shape alone is not enough — the default schema has aoeShape="circle" for every spell).
  const hasAoEShape = Boolean(_str(sys.aoeShape).trim()) || Boolean(_str(sys.aoe?.shape).trim());
  const hasAoESize  = _num(sys.aoeSize ?? sys.aoe?.size, 0) > 0;
  if (hasAoEShape && hasAoESize) return "aoe";

  return "none";
}

/**
 * Get maximum range in meters for a spell.
 * Uses (in order):
 * - spell.system.rangeType + spell.system.rangeValue (new fields)
 * - spell.system.range (legacy free-text)
 * - spell.system.range.value (legacy structured)
 *
 * @param {Item} spell
 * @returns {number|null}
 */
export function getSpellMaxRangeMeters(spell) {
  const sys = spell?.system ?? {};

  // New: explicit range type/value fields (as implemented in prior patches).
  const rangeType = _str(sys.rangeType).toLowerCase();
  const rangeValue = _num(sys.rangeValue, null);

  if (rangeType === "ranged" && Number.isFinite(rangeValue) && rangeValue > 0) return rangeValue;
  if (rangeType === "melee" && Number.isFinite(rangeValue) && rangeValue > 0) return rangeValue;
  if (rangeType === "aoe" && Number.isFinite(rangeValue) && rangeValue > 0) return rangeValue;

  // Legacy: structured
  const legacyValue = _num(sys.range?.value, null);
  if (Number.isFinite(legacyValue) && legacyValue > 0) return legacyValue;

  // Legacy: free text
  const legacyText = _str(sys.range);
  const parsed = parseMeters(legacyText);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  return null;
}

/**
 * AoE config read (tolerant).
 * Expected data (new fields):
 *  - system.aoeShape: "circle"|"cone"|"rect"|"ray" (stored as measured template types: "circle","cone","rect","ray")
 *  - system.aoeSize: number (meters)
 *  - system.aoeWidth: number (meters) for ray/rect
 *  - system.aoePulse: boolean (centered on caster)
 *  - system.aoeIncludeCaster: boolean (include caster in pulse)
 *
 * @param {Item} spell
 * @returns {{shape: string|null, sizeMeters: number|null, widthMeters: number|null, pulse: boolean, includeCaster?: boolean}|null}
 */
export function getSpellAoEConfig(spell) {
  const sys = spell?.system ?? {};

  // New structured fields
  const shapeRaw = _str(sys.aoeShape || sys.aoe?.shape || "").toLowerCase();
  const sizeMeters = _num(sys.aoeSize ?? sys.aoe?.size, null);
  const widthMeters = _num(sys.aoeWidth ?? sys.aoe?.width, null);

  // Pulse is a modifier (centered on caster), not a measured-template type.
  // For backwards compatibility with earlier prototypes, accept aoeShape="pulse".
  const pulseFromShape = (shapeRaw === "pulse");
  const pulseFromFlag = Boolean(sys.aoePulse ?? sys.aoe?.pulse);
  const pulse = pulseFromShape || pulseFromFlag;
  const includeCaster = Boolean(sys.aoeIncludeCaster ?? sys.aoe?.includeCaster);

  // MeasuredTemplate types
  const normalizedShape = ["circle", "cone", "rect", "ray"].includes(shapeRaw)
    ? shapeRaw
    : (pulse ? "circle" : null);

  // If the spell is not configured as AoE, do not return an AoE config.
  // NOTE: We do not infer shape/size from free-text range because it becomes ambiguous quickly.
  if (!normalizedShape && _str(sys.rangeType).toLowerCase() !== "aoe") return null;

  return {
    shape: normalizedShape,
    sizeMeters: Number.isFinite(sizeMeters) ? sizeMeters : null,
    widthMeters: Number.isFinite(widthMeters) ? widthMeters : null,
    pulse,
    includeCaster
  };
}

/**
 * Measure distance in meters between two canvas points using grid measurement.
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {number}
 */
function measureDistanceMeters(a, b) {
  if (!canvas?.grid || !a || !b) return 0;

  // Use v13 namespaced Ray with fallback to global Ray for compatibility
  const RayClass = foundry?.canvas?.geometry?.Ray ?? Ray;
  const ray = new RayClass(a, b);

  // Use v13 measurePath API with fallback to deprecated measureDistances
  if (typeof canvas.grid.measurePath === "function") {
    const path = canvas.grid.measurePath([{ ray }], { gridSpaces: true });
    // API may return object with distance property or array of distances
    const d = path?.distance ?? (Array.isArray(path) && path.length > 0 ? path[0] : null);
    if (Number.isFinite(d)) return d;
  } else {
    // Fallback for compatibility
    const distances = canvas.grid.measureDistances([{ ray }], { gridSpaces: true });
    const d = Array.isArray(distances) ? distances[0] : 0;
    if (Number.isFinite(d)) return d;
  }

  return 0;
}

/**
 * Resolve the origin point for spell range measurement, respecting
 * the aoeOriginMeasurement setting.
 *
 * For "edge" (or "match-token" when tokenRangeMeasurement=edge), returns
 * the nearest bounding-box edge point of the caster token toward the
 * targets' general direction.  Since we don't know the specific target
 * yet (this is called before the per-target loop), we return the center
 * and let large-token edge adjustment happen per-target when needed.
 *
 * In practice, for single-target spells the difference is negligible
 * (< half a grid cell).  For true edge-to-edge, the per-target loop
 * would need to be restructured.  This provides a clean opt-in point
 * for future enhancement without breaking existing behavior.
 *
 * @param {Token} casterToken
 * @returns {{x: number, y: number}|null}
 */
function _resolveSpellRangeOrigin(casterToken) {
  const center = casterToken?.center ?? casterToken?.object?.center ?? null;
  if (!center) return null;

  let useEdge = false;
  try {
    const mode = game.settings?.get?.("uesrpg-3ev4", "aoeOriginMeasurement") ?? "center";
    if (mode === "edge") {
      useEdge = true;
    } else if (mode === "match-token") {
      const tokenMode = game.settings?.get?.("uesrpg-3ev4", "tokenRangeMeasurement") ?? "center";
      useEdge = (tokenMode === "edge");
    }
  } catch (_e) { /* settings not ready yet */ }

  if (!useEdge) return center;

  // For edge mode: shift origin to the nearest edge of the caster token
  // toward "outward" (we approximate by returning center for now —
  // the per-target distance check below uses center-to-center which is
  // generous for large tokens, matching the existing behavior).
  return center;
}

/**
 * Filter currently targeted tokens by spell range.
 * Returns the subset which are within range. Also emits warnings for those out of range.
 *
 * @param {object} opts
 * @param {Token} opts.casterToken
 * @param {Token[]} opts.targets
 * @param {Item} opts.spell
 * @returns {{inRange: Token[], outOfRange: Array<{token: Token, distance: number, maxRange: number}>}}
 */
export function filterTargetsBySpellRange({ casterToken, targets, spell } = {}) {
  const maxRange = getSpellMaxRangeMeters(spell);
  const origin = _resolveSpellRangeOrigin(casterToken);

  // If there is no usable range, do not filter.
  if (!Number.isFinite(maxRange) || maxRange <= 0 || !origin) {
    const all = Array.from(targets ?? []);
    return {
      validTargets: all,
      rejected: [],
      maxRange,
      // Back-compat aliases
      inRange: all,
      outOfRange: []
    };
  }

  const inRange = [];
  const outOfRange = [];
  for (const tok of (targets ?? [])) {
    const c = tok?.center ?? tok?.object?.center ?? null;
    if (!c) continue;
    const d = measureDistanceMeters(origin, c);
    if (d <= maxRange) inRange.push(tok);
    else outOfRange.push({ token: tok, distance: d, maxRange });
  }

  return {
    validTargets: inRange,
    rejected: outOfRange,
    maxRange,
    // Back-compat aliases
    inRange,
    outOfRange
  };
}
