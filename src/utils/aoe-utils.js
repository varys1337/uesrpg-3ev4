/**
 * src/utils/aoe-utils.js

 *
 * Small AoE geometry helpers for escape checks.
 * Foundry VTT v14.359+.
 */

import { resolveUuidSync } from "./uuid-cache.js";
import { testAreaPoint } from "../core/aoe/containment.js";

function _getPixelsPerMeter() {
  const gridSize = Number(canvas?.grid?.size ?? 0) || 0;
  const gridDistance = Number(canvas?.scene?.grid?.distance ?? 0) || 0;
  if (!gridSize || !gridDistance) return null;
  return gridSize / gridDistance;
}

function _getTemplateObject(templateDoc, templateId) {
  if (templateDoc?.object) return templateDoc.object;
  const id = templateDoc?.id ?? templateDoc?._id ?? templateId ?? null;
  if (!id) return null;
  return (
    canvas?.templates?.get?.(id) ??
    canvas?.templates?.placeables?.find?.(t => t?.id === id || t?.document?.id === id) ??
    null
  );
}

function _getRegionObject(regionDoc, regionId) {
  if (regionDoc?.object) return regionDoc.object;
  const id = regionDoc?.id ?? regionDoc?._id ?? regionId ?? null;
  if (!id) return null;
  return (
    canvas?.regions?.get?.(id) ??
    canvas?.regions?.placeables?.find?.((region) => region?.id === id || region?.document?.id === id) ??
    null
  );
}

/**
 * Resolve a MeasuredTemplateDocument from a UUID.
 * @param {string|null} templateUuid
 * @returns {MeasuredTemplateDocument|null}
 */
function resolveTemplateByUuid(templateUuid) {
  if (!templateUuid) return null;
  try {
    const doc = resolveUuidSync(String(templateUuid));
    return doc?.documentName === "MeasuredTemplate" ? doc : null;
  } catch (_e) {
    return null;
  }
}

function resolveRegionByUuid(regionUuid) {
  if (!regionUuid) return null;
  try {
    const doc = resolveUuidSync(String(regionUuid));
    return doc?.documentName === "Region" ? doc : null;
  } catch (_e) {
    return null;
  }
}

function _canTokenEscapeAreaObject(areaObj, token, stepMeters) {
  const center = token?.center ?? token?.object?.center ?? null;
  if (!center) return null;
  const elevation = token?.document?.elevation ?? token?.elevation ?? 0;

  const ppm = _getPixelsPerMeter();
  if (!ppm) return null;

  const step = Number(stepMeters) * ppm;
  if (!Number.isFinite(step) || step <= 0) return null;

  let isInside = false;
  try {
    isInside = testAreaPoint(areaObj, center, { elevation });
  } catch (_e) {
    return null;
  }

  if (!isInside) return true;

  const diag = step / Math.SQRT2;
  const offsets = [
    { x: step, y: 0 },
    { x: -step, y: 0 },
    { x: 0, y: step },
    { x: 0, y: -step },
    { x: diag, y: diag },
    { x: diag, y: -diag },
    { x: -diag, y: diag },
    { x: -diag, y: -diag }
  ];

  for (const off of offsets) {
    const point = { x: center.x + off.x, y: center.y + off.y };
    try {
      const inside = testAreaPoint(areaObj, point, { elevation });
      if (!inside) return true;
    } catch (_e) {
      return null;
    }
  }

  return false;
}

export function canTokenEscapeArea({ areaUuid = null, areaId = null, token = null, stepMeters = 1 } = {}) {
  if (!canvas?.scene || !token) return null;

  const regionDoc = resolveRegionByUuid(areaUuid);
  if (regionDoc) return _canTokenEscapeAreaObject(regionDoc, token, stepMeters);
  const regionObj = _getRegionObject(regionDoc, areaId);
  if (regionObj) return _canTokenEscapeAreaObject(regionObj, token, stepMeters);

  const templateDoc = resolveTemplateByUuid(areaUuid);
  const templateObj = _getTemplateObject(templateDoc, areaId);
  if (templateObj) return _canTokenEscapeAreaObject(templateObj, token, stepMeters);

  return null;
}

/**
 * Determine if a token can move 1 meter to leave a template area.
 * Uses a simple 8-direction sample from the token center.
 *
 * @param {object} params
 * @param {string|null} params.templateUuid
 * @param {string|null} params.templateId
 * @param {Token|null} params.token
 * @param {number} params.stepMeters
 * @returns {boolean|null} true if a 1m step can exit, false if not, null if unknown
 */
export function canTokenEscapeTemplate({ templateUuid = null, templateId = null, token = null, stepMeters = 1 } = {}) {
  return canTokenEscapeArea({ areaUuid: templateUuid, areaId: templateId, token, stepMeters });
}
