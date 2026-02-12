/**
 * src/core/aoe/index.js
 *
 * Barrel export for the universal AoE placement pipeline.
 * All system callers should import from this file.
 *
 * Target: Foundry VTT v13.351
 */

export { AoEService } from "./aoe-service.js";
export { AOE_SOURCE_TYPES, TEMPLATE_SHAPES, FLAG_NAMESPACE } from "./aoe-constants.js";
export { buildTemplateData, buildSourceFlags, validateAoeSpec, normalizeShape } from "./aoe-template-data.js";
export { startPlacement, isPlacementActive } from "./aoe-placement-controller.js";
