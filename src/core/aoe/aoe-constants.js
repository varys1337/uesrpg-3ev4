/**
 * src/core/aoe/aoe-constants.js
 *
 * Constants for the universal AoE template placement pipeline.
 * Target: Foundry VTT v13.351
 */

import { FLAG_SCOPE } from "../system/namespace.js";

/** @type {string} */
export const FLAG_NAMESPACE = FLAG_SCOPE;

/**
 * Canonical MeasuredTemplate shape types accepted by Foundry.
 * Maps system vocabulary → Foundry `t` field values.
 */
export const TEMPLATE_SHAPES = Object.freeze({
  CIRCLE: "circle",
  CONE:   "cone",
  RECT:   "rect",
  RAY:    "ray",
});

/**
 * All valid Foundry template type strings (used for validation).
 */
export const VALID_TEMPLATE_TYPES = Object.freeze(
  new Set(Object.values(TEMPLATE_SHAPES))
);

/**
 * Maps common system AoE vocabulary to Foundry template types.
 * Keys are lowercased input strings; values are canonical TEMPLATE_SHAPES.
 */
export const SHAPE_ALIASES = Object.freeze({
  circle:    TEMPLATE_SHAPES.CIRCLE,
  sphere:    TEMPLATE_SHAPES.CIRCLE,
  pulse:     TEMPLATE_SHAPES.CIRCLE,
  cone:      TEMPLATE_SHAPES.CONE,
  rect:      TEMPLATE_SHAPES.RECT,
  rectangle: TEMPLATE_SHAPES.RECT,
  square:    TEMPLATE_SHAPES.RECT,
  ray:       TEMPLATE_SHAPES.RAY,
  line:      TEMPLATE_SHAPES.RAY,
  beam:      TEMPLATE_SHAPES.RAY,
});

/**
 * Source types for tracking what initiated an AoE placement.
 */
export const AOE_SOURCE_TYPES = Object.freeze({
  SPELL:  "spell",
  WEAPON: "weapon",
  ITEM:   "item",
  POWER:  "power",
  OTHER:  "other",
});

/**
 * Default fill color for system-created templates (semi-transparent black).
 */
export const DEFAULT_FILL_COLOR = "#000000";

/**
 * Default cone angle in degrees (Foundry default is 53.13).
 */
export const DEFAULT_CONE_ANGLE = 53.13;
