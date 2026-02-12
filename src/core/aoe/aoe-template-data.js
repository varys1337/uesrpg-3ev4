/**
 * src/core/aoe/aoe-template-data.js
 *
 * Pure data normalization layer.
 * Converts a system AoE spec into MeasuredTemplateDocument source data.
 *
 * This module is PURE — no canvas reads, no document mutation.
 * Target: Foundry VTT v13.351
 */

import {
  FLAG_NAMESPACE,
  SHAPE_ALIASES,
  VALID_TEMPLATE_TYPES,
  DEFAULT_FILL_COLOR,
  DEFAULT_CONE_ANGLE,
  AOE_SOURCE_TYPES,
} from "./aoe-constants.js";

/**
 * Normalize a shape string to a valid Foundry template type.
 *
 * @param {string} input - Raw shape string (e.g. "circle", "sphere", "beam", "pulse")
 * @returns {string|null} Normalized Foundry template type or null if unrecognised
 */
export function normalizeShape(input) {
  if (!input || typeof input !== "string") return null;
  const key = input.trim().toLowerCase();
  return SHAPE_ALIASES[key] ?? (VALID_TEMPLATE_TYPES.has(key) ? key : null);
}

/**
 * Coerce a value to a finite positive number or return null.
 *
 * @param {*} v
 * @returns {number|null}
 */
function _positiveNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Build a plain MeasuredTemplateDocument source data object suitable for
 * `scene.createEmbeddedDocuments("MeasuredTemplate", [data])`.
 *
 * @param {object} params
 * @param {{x: number, y: number}} params.origin        - Canvas pixel coordinates for initial placement
 * @param {object}                 params.aoe            - AoE specification
 * @param {string}                 params.aoe.shape      - Shape string (circle/cone/ray/rect or aliases)
 * @param {number}                 params.aoe.distance   - Size/radius in scene distance units (meters)
 * @param {number}                 [params.aoe.width]    - Width for ray/rect templates
 * @param {number}                 [params.aoe.angle]    - Angle for cone templates (degrees)
 * @param {number}                 [params.aoe.direction]- Initial direction (degrees, 0 = south)
 * @param {object}                 [params.userOverrides]- Optional overrides (fillColor, texture, etc.)
 * @param {object}                 [params.flags]        - Additional flags to merge into uesrpg-3ev4 namespace
 * @returns {{data: object, errors: string[]}|null}      - Template data + validation errors, or null if fatal
 */
export function buildTemplateData({ origin, aoe, userOverrides = {}, flags = {} } = {}) {
  const errors = [];

  // --- Origin ---
  const x = Number(origin?.x);
  const y = Number(origin?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null; // Fatal: no valid origin
  }

  // --- Shape ---
  const shape = normalizeShape(aoe?.shape);
  if (!shape) {
    errors.push(`Unknown AoE shape: "${aoe?.shape}"`);
    return null; // Fatal: no valid shape
  }

  // --- Distance ---
  const distance = _positiveNum(aoe?.distance ?? aoe?.size ?? aoe?.sizeMeters);
  if (!distance) {
    errors.push("AoE distance/size must be a positive number.");
    return null;
  }

  // --- Optional dimensions ---
  const width = _positiveNum(aoe?.width ?? aoe?.widthMeters);
  const angle = _positiveNum(aoe?.angle) ?? (shape === "cone" ? DEFAULT_CONE_ANGLE : undefined);
  const direction = Number.isFinite(Number(aoe?.direction)) ? Number(aoe.direction) : 0;

  // --- Assemble data ---
  const data = {
    user: undefined, // Will be set to game.user.id at call time
    t: shape,
    x,
    y,
    direction,
    distance,
    fillColor: userOverrides.fillColor ?? DEFAULT_FILL_COLOR,
    flags: {
      [FLAG_NAMESPACE]: {
        systemAoE: true,
        ...(flags ?? {}),
      },
    },
  };

  // Conditional fields
  if (shape === "ray" || shape === "rect") {
    data.width = width ?? 1; // Foundry expects a width for rays; default to 1 scene unit
  }
  if (shape === "cone" && angle !== undefined) {
    data.angle = angle;
  }
  if (userOverrides.texture) {
    data.texture = userOverrides.texture;
  }

  return { data, errors };
}

/**
 * Build AoE flags payload for tracking the source of the template.
 *
 * @param {object} params
 * @param {string} [params.sourceType]     - One of AOE_SOURCE_TYPES
 * @param {string} [params.sourceUuid]     - UUID of the source item/spell/weapon
 * @param {string} [params.sourceId]       - ID of the source item
 * @param {string} [params.sourceName]     - Human-readable name
 * @param {string} [params.casterTokenId]  - Token ID of the caster
 * @param {string} [params.casterActorId]  - Actor ID of the caster
 * @param {string} [params.damageType]     - Damage type if applicable
 * @param {boolean} [params.pulse]         - Whether this is a pulse-style AoE (centered on caster)
 * @param {boolean} [params.includeCaster] - Whether to include caster in affected targets
 * @param {object}  [params.extra]         - Any additional metadata
 * @returns {object} Flags object to pass into buildTemplateData
 */
export function buildSourceFlags({
  sourceType = AOE_SOURCE_TYPES.OTHER,
  sourceUuid = null,
  sourceId = null,
  sourceName = null,
  casterTokenId = null,
  casterActorId = null,
  damageType = null,
  pulse = false,
  includeCaster = false,
  extra = {},
} = {}) {
  return {
    spellAoE: true,
    sourceType,
    sourceUuid,
    sourceId,
    sourceName,
    casterTokenId,
    casterActorId,
    damageType,
    pulse,
    includeCaster,
    ...extra,
  };
}

/**
 * Validate an AoE specification. Returns an array of error strings (empty = valid).
 *
 * @param {object} aoe
 * @returns {string[]}
 */
export function validateAoeSpec(aoe) {
  const errors = [];
  if (!aoe) {
    errors.push("AoE specification is required.");
    return errors;
  }
  if (!normalizeShape(aoe.shape)) {
    errors.push(`Unknown or missing AoE shape: "${aoe.shape}".`);
  }
  const distance = _positiveNum(aoe.distance ?? aoe.size ?? aoe.sizeMeters);
  if (!distance) {
    errors.push("AoE distance/size must be a positive number.");
  }
  return errors;
}
