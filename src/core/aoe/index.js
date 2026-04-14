/**
 * src/core/aoe/index.js
 *
 * Barrel export for the AoE placement pipeline.
 * All active runtime callers should use the Region-first exports from this file.
 * Template-oriented exports remain legacy compatibility only.
 *
 * Target: Foundry VTT v14.359+
 */

export { AoEService } from "./aoe-service.js";
export { AOE_SOURCE_TYPES, TEMPLATE_SHAPES, FLAG_NAMESPACE } from "./aoe-constants.js";
// Internal legacy template helpers are retained only for compatibility imports
// and migration-safe reads. New runtime callers should use Region-first APIs.
export { buildTemplateData, buildSourceFlags, validateAoeSpec, normalizeShape } from "./aoe-template-data.js";
export { buildRegionData } from "./aoe-region-data.js";
// Legacy MeasuredTemplate placement controller retained for compatibility callers only.
export { startPlacement, isPlacementActive } from "./aoe-placement-controller.js";
export { startRegionPlacement, isRegionPlacementActive } from "./aoe-region-placement-controller.js";
