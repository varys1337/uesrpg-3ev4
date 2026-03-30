import { awaitTemplateObject } from "./template-object.js";

export function getAoeContainmentMode() {
  try {
    return game.settings?.get?.("uesrpg-3ev4", "aoeContainmentMode") ?? "true-radius";
  } catch (_e) {
    return "true-radius";
  }
}

function getTokenSamplePoints(tokObj, cache = null) {
  const cacheKey = tokObj?.document?.id ?? tokObj?.id ?? null;
  if (cache && cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);

  const center = tokObj?.center ?? null;
  if (!center) return [];

  const width = Number(tokObj.w ?? tokObj.width ?? 0);
  const height = Number(tokObj.h ?? tokObj.height ?? 0);
  const x0 = Number(tokObj.x ?? (center.x - width / 2));
  const y0 = Number(tokObj.y ?? (center.y - height / 2));

  const points = [{ x: center.x, y: center.y }];
  if (width > 0 && height > 0) {
    points.push(
      { x: x0, y: y0 },
      { x: x0 + width, y: y0 },
      { x: x0, y: y0 + height },
      { x: x0 + width, y: y0 + height },
      { x: x0 + width / 2, y: y0 },
      { x: x0 + width / 2, y: y0 + height },
      { x: x0, y: y0 + height / 2 },
      { x: x0 + width, y: y0 + height / 2 },
    );
  }

  if (cache && cacheKey) cache.set(cacheKey, points);
  return points;
}

export function isTokenInTemplateTrueRadius(tokObj, templateObj, { samplePointCache = null } = {}) {
  if (typeof templateObj.testPoint === "function" && templateObj.shape) {
    try {
      const center = tokObj.center;
      if (center && templateObj.testPoint(center)) return true;
    } catch (_e) {
      // Fall through to shape.contains sampling.
    }
  }

  if (!templateObj.shape || typeof templateObj.shape.contains !== "function") return false;
  const points = getTokenSamplePoints(tokObj, samplePointCache);
  for (const point of points) {
    if (templateObj.shape.contains(point.x - templateObj.x, point.y - templateObj.y)) return true;
  }
  return false;
}

export function isTokenInTemplateGridAware(tokObj, templateObj) {
  if (!templateObj.shape || typeof templateObj.shape.contains !== "function") return false;
  if (!canvas?.grid) return isTokenInTemplateTrueRadius(tokObj, templateObj);

  const gridSize = canvas.grid.size ?? canvas.grid.sizeX ?? 100;
  const tokDoc = tokObj.document ?? tokObj;
  const width = Number(tokDoc.width ?? 1);
  const height = Number(tokDoc.height ?? 1);
  const tokX = Number(tokObj.x ?? 0);
  const tokY = Number(tokObj.y ?? 0);

  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      const cx = tokX + (col + 0.5) * gridSize;
      const cy = tokY + (row + 0.5) * gridSize;
      if (templateObj.shape.contains(cx - templateObj.x, cy - templateObj.y)) return true;
    }
  }
  return false;
}

export function isTokenInTemplate(tokObj, templateObj, { containmentMode = "true-radius", samplePointCache = null } = {}) {
  if (containmentMode === "grid-aware") return isTokenInTemplateGridAware(tokObj, templateObj);
  return isTokenInTemplateTrueRadius(tokObj, templateObj, { samplePointCache });
}

export async function collectTargetsInTemplate(templateDoc, {
  isPulse = false,
  includeCaster = false,
  casterTokenId = null,
  containmentMode = getAoeContainmentMode(),
} = {}) {
  const templateObj = await awaitTemplateObject(templateDoc.id);
  if (!templateObj?.shape || typeof templateObj.shape.contains !== "function") {
    if (typeof templateObj?.testPoint !== "function") {
      ui.notifications?.info("Template placed, but could not determine affected tokens.");
      return [];
    }
  }

  const tokens = canvas.tokens?.placeables ?? [];
  const affected = [];
  const samplePointCache = new Map();

  for (const tok of tokens) {
    if (!tok) continue;
    const inside = isTokenInTemplate(tok, templateObj, { containmentMode, samplePointCache });
    if (inside) affected.push(tok);
  }

  if (isPulse && casterTokenId) {
    const isCaster = (tok) => (tok?.id ?? tok?.document?.id) === casterTokenId;
    const alreadyIncluded = affected.some(isCaster);

    if (!includeCaster && alreadyIncluded) {
      for (let i = affected.length - 1; i >= 0; i--) {
        if (isCaster(affected[i])) affected.splice(i, 1);
      }
    } else if (includeCaster && !alreadyIncluded) {
      const casterTok = tokens.find(isCaster);
      if (casterTok) affected.push(casterTok);
    }
  }

  return affected;
}
