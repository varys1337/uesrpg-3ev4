import { SYSTEM_ID } from "../../constants.js";
import { getRegionWarfareFeatureState } from "../siege/state.js";
import { testAreaPoint } from "../../aoe/containment.js";

const TERRAIN_TYPES = new Set(["normal", "difficult", "impassable", "fortification", "hazard"]);

export function normalizeWarfareTerrainRegion(region) {
  const raw = region?.flags?.[SYSTEM_ID]?.warfareTerrain ?? {};
  const type = TERRAIN_TYPES.has(String(raw?.type ?? "").trim().toLowerCase())
    ? String(raw.type).trim().toLowerCase()
    : "normal";
  const defaultMovementCost = type === "impassable" ? Number.POSITIVE_INFINITY : 1;
  const movementCost = Number(raw?.movementCost);
  return {
    type,
    movementCost: Number.isFinite(movementCost) && movementCost > 0 ? movementCost : defaultMovementCost,
    blocksCharge: Boolean(raw?.blocksCharge) || type === "impassable",
  };
}

export function normalizeWarfareFeatureRegion(region) {
  const feature = getRegionWarfareFeatureState(region);
  const activeFeature = Boolean(feature?.type) && (feature.kind !== "fortification" || feature.intact || feature.breached);
  if (!activeFeature) {
    return {
      active: false,
      kind: "",
      type: "",
      movementCost: 1,
      blocksCharge: false,
      coverBonus: 0,
      defenseBonus: 0,
      intact: false,
      breached: false,
    };
  }
  return {
    active: true,
    kind: String(feature.kind ?? ""),
    type: String(feature.type ?? ""),
    movementCost: Math.max(1, Number(feature.movementCost ?? 1) || 1),
    blocksCharge: Boolean(feature.blocksCharge),
    coverBonus: Number(feature.coverBonus ?? 0) || 0,
    defenseBonus: Number(feature.defenseBonus ?? 0) || 0,
    intact: Boolean(feature.intact),
    breached: Boolean(feature.breached),
  };
}

export function getWarfareTerrainAtPoint(scene, point) {
  const elevatedPoint = {
    x: Number(point?.x ?? 0) || 0,
    y: Number(point?.y ?? 0) || 0,
    elevation: Number(point?.elevation ?? 0) || 0,
  };

  const regions = Array.from(scene?.regions?.contents ?? [])
    .filter((region) => {
      return testAreaPoint(region, elevatedPoint, { elevation: elevatedPoint.elevation });
    })
    .map((region) => ({
      region,
      terrain: normalizeWarfareTerrainRegion(region),
      feature: normalizeWarfareFeatureRegion(region),
    }));

  if (!regions.length) {
    return {
      movementCost: 1,
      blocksCharge: false,
      regions: [],
      terrains: [],
      features: [],
    };
  }

  return {
    movementCost: Math.max(...regions.map((entry) => Math.max(
      Number(entry.terrain?.movementCost ?? 1) || 1,
      Number(entry.feature?.movementCost ?? 1) || 1,
    ))),
    blocksCharge: regions.some((entry) => entry.terrain?.blocksCharge || entry.feature?.blocksCharge),
    regions: regions.map((entry) => entry.region),
    terrains: regions.map((entry) => entry.terrain),
    features: regions.map((entry) => entry.feature).filter((entry) => entry?.active),
  };
}

function _lerp(a, b, t) {
  return a + ((b - a) * t);
}

export function evaluateTerrainPath(scene, {
  start,
  end,
  steps = 1,
  elevation = 0,
} = {}) {
  const safeSteps = Math.max(1, Math.ceil(Number(steps ?? 1) || 1));
  let pathCost = 0;
  let blocksCharge = false;
  const touchedRegionIds = new Set();

  for (let index = 1; index <= safeSteps; index += 1) {
    const t = index / safeSteps;
    const point = {
      x: _lerp(Number(start?.x ?? 0) || 0, Number(end?.x ?? 0) || 0, t),
      y: _lerp(Number(start?.y ?? 0) || 0, Number(end?.y ?? 0) || 0, t),
      elevation,
    };
    const terrain = getWarfareTerrainAtPoint(scene, point);
    pathCost += Number(terrain.movementCost ?? 1) || 1;
    blocksCharge ||= Boolean(terrain.blocksCharge);
    for (const region of terrain.regions) {
      if (region?.id) touchedRegionIds.add(String(region.id));
    }
  }

  return {
    pathCost,
    blocksCharge,
    touchedRegionIds: Array.from(touchedRegionIds),
  };
}
