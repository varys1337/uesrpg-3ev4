import {
  measureTokenDistanceChebyshev,
  measureTokenDistanceGridSpaces,
} from "../../combat/opposed/range.js";
import { isWarfareUnitActorType } from "../../actors/types.js";
import { evaluateTerrainPath } from "./terrain.js";

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _gridSize(scene) {
  return Math.max(1, _num(scene?.grid?.size, _num(canvas?.scene?.grid?.size, 100)));
}

export function getSceneGridDistance(scene) {
  return Math.max(1, _num(scene?.grid?.distance, _num(canvas?.scene?.grid?.distance, 1)));
}

export function getTokenPixelSize(tokenDoc) {
  const gridSize = _gridSize(tokenDoc?.parent ?? null);
  return {
    width: Math.max(1, _num(tokenDoc?.width, 1)) * gridSize,
    height: Math.max(1, _num(tokenDoc?.height, 1)) * gridSize,
  };
}

export function getTokenCenterPoint(tokenLike) {
  const token = tokenLike?.document ?? tokenLike;
  const x = _num(token?.x, NaN);
  const y = _num(token?.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const size = getTokenPixelSize(token);
  return {
    x: x + (size.width / 2),
    y: y + (size.height / 2),
    elevation: _num(token?.elevation, 0),
  };
}

function _getTokenOffset(tokenDoc) {
  const grid = canvas?.grid;
  if (!grid || typeof grid.getOffset !== "function") return null;
  try {
    return grid.getOffset({ x: _num(tokenDoc?.x, 0), y: _num(tokenDoc?.y, 0) });
  } catch (_err) {
    return null;
  }
}

function _isOpposingByDisposition(aTokenDoc, bTokenDoc) {
  const aDisposition = _num(aTokenDoc?.disposition, 0);
  const bDisposition = _num(bTokenDoc?.disposition, 0);
  if (!aDisposition || !bDisposition) return false;
  return Math.sign(aDisposition) !== Math.sign(bDisposition);
}

export function areWarfareTokensOpposing(aTokenDoc, bTokenDoc) {
  if (!isWarfareUnitActorType(aTokenDoc?.actor?.type)) return false;
  if (!isWarfareUnitActorType(bTokenDoc?.actor?.type)) return false;
  return _isOpposingByDisposition(aTokenDoc, bTokenDoc);
}

export function areTokensInBaseContact(aTokenDoc, bTokenDoc) {
  const distance = measureTokenDistanceChebyshev(aTokenDoc?.object ?? aTokenDoc, bTokenDoc?.object ?? bTokenDoc);
  return Number.isFinite(distance) && distance <= getSceneGridDistance(aTokenDoc?.parent ?? bTokenDoc?.parent ?? null);
}

export function getEnemyContactTokenDocs(scene, tokenDoc) {
  return Array.from(scene?.tokens?.contents ?? []).filter((candidate) => {
    if (!candidate || String(candidate.uuid ?? "") === String(tokenDoc?.uuid ?? "")) return false;
    if (!areWarfareTokensOpposing(tokenDoc, candidate)) return false;
    return areTokensInBaseContact(tokenDoc, candidate);
  });
}

function _candidateContactOffsets() {
  return [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];
}

function _buildChargeContactPoints(attackerTokenDoc, defenderTokenDoc) {
  const gridSize = _gridSize(defenderTokenDoc?.parent ?? null);
  const defenderOffset = _getTokenOffset(defenderTokenDoc);
  const attackerOffset = _getTokenOffset(attackerTokenDoc);
  if (!defenderOffset || !attackerOffset) return [];

  const defenderWidth = Math.max(1, Math.round(_num(defenderTokenDoc?.width, 1)));
  const defenderHeight = Math.max(1, Math.round(_num(defenderTokenDoc?.height, 1)));
  const attackerWidth = Math.max(1, Math.round(_num(attackerTokenDoc?.width, 1)));
  const attackerHeight = Math.max(1, Math.round(_num(attackerTokenDoc?.height, 1)));
  const offsets = _candidateContactOffsets();
  const points = [];

  for (const offset of offsets) {
    let anchorI = defenderOffset.i;
    let anchorJ = defenderOffset.j;

    if (offset.dx > 0) anchorJ = defenderOffset.j + defenderWidth;
    if (offset.dx < 0) anchorJ = defenderOffset.j - attackerWidth;
    if (offset.dy > 0) anchorI = defenderOffset.i + defenderHeight;
    if (offset.dy < 0) anchorI = defenderOffset.i - attackerHeight;

    if (!offset.dx) {
      const overlapWidth = Math.max(1, Math.min(defenderWidth, attackerWidth));
      anchorJ = defenderOffset.j + Math.max(0, Math.floor((defenderWidth - overlapWidth) / 2));
    }
    if (!offset.dy) {
      const overlapHeight = Math.max(1, Math.min(defenderHeight, attackerHeight));
      anchorI = defenderOffset.i + Math.max(0, Math.floor((defenderHeight - overlapHeight) / 2));
    }

    points.push({
      x: (anchorJ * gridSize) + ((attackerWidth * gridSize) / 2),
      y: (anchorI * gridSize) + ((attackerHeight * gridSize) / 2),
      elevation: _num(attackerTokenDoc?.elevation, 0),
    });
  }

  return points;
}

export function validateChargeRoute({
  scene,
  attackerTokenDoc,
  defenderTokenDoc,
  targetContactSide = "front",
  maxCost = 0,
} = {}) {
  const attackerCenter = getTokenCenterPoint(attackerTokenDoc);
  if (!attackerCenter) {
    return { ok: false, reason: "The charging token must be on the active scene.", pathCost: 0 };
  }

  const destinations = _buildChargeContactPoints(
    attackerTokenDoc,
    defenderTokenDoc,
  );
  if (!destinations.length) {
    return { ok: false, reason: "Unable to determine a legal contact point for that charge.", pathCost: 0 };
  }

  let best = null;
  const gridDistance = getSceneGridDistance(scene);
  for (const destination of destinations) {
    let distance = null;
    try {
      const measurement = canvas?.grid?.measurePath?.([attackerCenter, destination], { gridSpaces: true });
      distance = typeof measurement === "number"
        ? measurement
        : Number(measurement?.distance ?? measurement?.gridDistance ?? measurement?.totalDistance ?? NaN);
    } catch (_err) {
      distance = null;
    }
    const steps = Number.isFinite(distance) ? Math.max(1, Math.ceil(distance / gridDistance)) : Math.max(1, Math.ceil(maxCost));
    const terrain = evaluateTerrainPath(scene, {
      start: attackerCenter,
      end: destination,
      steps,
      elevation: _num(attackerTokenDoc?.elevation, 0),
    });
    if (terrain.blocksCharge) continue;
    const pathCost = Math.max(steps, Math.ceil(Number(terrain.pathCost ?? steps) || steps));
    const candidate = {
      ok: pathCost <= Math.max(0, Number(maxCost ?? 0) || 0),
      pathCost,
      targetContactSide,
      contactPoint: destination,
      touchedRegionIds: terrain.touchedRegionIds,
      reason: pathCost <= Math.max(0, Number(maxCost ?? 0) || 0)
        ? ""
        : `Charge path cost ${pathCost} exceeds current Speed ${Math.max(0, Number(maxCost ?? 0) || 0)}.`,
    };
    if (!best || candidate.pathCost < best.pathCost) best = candidate;
  }

  if (best) return best;
  return {
    ok: false,
    pathCost: 0,
    targetContactSide,
    contactPoint: null,
    touchedRegionIds: [],
    reason: "No legal charge path reaches that side without crossing charge-blocking terrain.",
  };
}

export function getNearestBattlefieldEdge(scene, tokenDoc) {
  const center = getTokenCenterPoint(tokenDoc);
  const width = Math.max(1, _num(scene?.width, _num(canvas?.scene?.width, 0)));
  const height = Math.max(1, _num(scene?.height, _num(canvas?.scene?.height, 0)));
  if (!center) return "top";
  const distances = [
    { edge: "top", value: center.y },
    { edge: "right", value: Math.max(0, width - center.x) },
    { edge: "bottom", value: Math.max(0, height - center.y) },
    { edge: "left", value: center.x },
  ];
  distances.sort((a, b) => a.value - b.value);
  return distances[0]?.edge ?? "top";
}

export function getDistanceToBattlefieldEdge(scene, tokenDoc, edge = "top") {
  const center = getTokenCenterPoint(tokenDoc);
  const width = Math.max(1, _num(scene?.width, _num(canvas?.scene?.width, 0)));
  const height = Math.max(1, _num(scene?.height, _num(canvas?.scene?.height, 0)));
  if (!center) return 0;
  switch (String(edge ?? "").trim().toLowerCase()) {
    case "right": return Math.max(0, width - center.x);
    case "bottom": return Math.max(0, height - center.y);
    case "left": return Math.max(0, center.x);
    default: return Math.max(0, center.y);
  }
}
