/**
 * @module magic/spell-range
 *
 * src/core/magic/spell-range.js
 *
 * Range gating and spell range utilities.
 * Target: Foundry VTT v14.359+.
 *
 * Active AoE placement has been moved to src/core/aoe/ (AoEService) and now
 * resolves to Region-backed area placement.
 * This module retains range configuration helpers and target-by-range filtering.
 */

import { _str, _num as _numBase } from "./_primitives.js";
import { getAoeOriginMeasurementMode, measurePointDistance, measureTokenToPointDistance } from "../combat/opposed/range.js";

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
 * This is consumed by actor sheet listeners to decide whether to:
 *  - filter explicit targets by range (ranged/melee), or
 *  - initiate AoE area placement (aoe).
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
  // (shape alone is not enough; the default schema has aoeShape="circle" for every spell).
  const hasAoEShape = Boolean(_str(sys.aoeShape).trim()) || Boolean(_str(sys.aoe?.shape).trim());
  const hasAoESize = _num(sys.aoeSize ?? sys.aoe?.size, 0) > 0;
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
 *  - system.aoeShape: "circle"|"cone"|"rect"|"ray"
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
  const pulseFromShape = shapeRaw === "pulse";
  const pulseFromFlag = Boolean(sys.aoePulse ?? sys.aoe?.pulse);
  const pulse = pulseFromShape || pulseFromFlag;
  const includeCaster = Boolean(sys.aoeIncludeCaster ?? sys.aoe?.includeCaster);

  // Canonical area shape types accepted by the Region-backed AoE pipeline
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
    includeCaster,
  };
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
  const origin = casterToken?.center ?? casterToken?.object?.center ?? null;
  const originMode = getAoeOriginMeasurementMode();

  // If there is no usable range, do not filter.
  if (!Number.isFinite(maxRange) || maxRange <= 0 || !origin) {
    const all = Array.from(targets ?? []);
    return {
      validTargets: all,
      rejected: [],
      maxRange,
      // Back-compat aliases
      inRange: all,
      outOfRange: [],
    };
  }

  const inRange = [];
  const outOfRange = [];
  for (const tok of (targets ?? [])) {
    const c = tok?.center ?? tok?.object?.center ?? null;
    if (!c) continue;
    const d = casterToken
      ? (
        measureTokenToPointDistance(casterToken, c, { mode: originMode })
        ?? measurePointDistance(origin, c, { gridSpaces: true })
        ?? 0
      )
      : (measurePointDistance(origin, c, { gridSpaces: true }) ?? 0);
    if (d <= maxRange) inRange.push(tok);
    else outOfRange.push({ token: tok, distance: d, maxRange });
  }

  return {
    validTargets: inRange,
    rejected: outOfRange,
    maxRange,
    // Back-compat aliases
    inRange,
    outOfRange,
  };
}
