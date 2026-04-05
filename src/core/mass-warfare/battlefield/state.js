import { isWarfareUnitActorType } from "../../actors/types.js";

export const WARFARE_ROUTE_STATES = Object.freeze(["none", "broken", "routed"]);

export function normalizeWarfareRoutingEdge(value) {
  const edge = String(value ?? "").trim().toLowerCase();
  return ["top", "right", "bottom", "left"].includes(edge) ? edge : "";
}

export function normalizeWarfareRouteState(value, fallback = "none") {
  const routeState = String(value ?? "").trim().toLowerCase();
  return WARFARE_ROUTE_STATES.includes(routeState) ? routeState : fallback;
}

export function createDefaultBattlefieldUnitState(tokenDoc = null) {
  return {
    routingEdge: "",
    routeState: "none",
  };
}

export function normalizeBattlefieldUnitState(entry = {}, tokenDoc = null) {
  const fallback = createDefaultBattlefieldUnitState(tokenDoc);
  return {
    routingEdge: normalizeWarfareRoutingEdge(entry?.routingEdge),
    routeState: normalizeWarfareRouteState(entry?.routeState, fallback.routeState),
  };
}

export function normalizeBattlefieldState(raw = {}, scene = null) {
  const units = {};
  const rawUnits = raw?.units && typeof raw.units === "object" ? raw.units : {};
  const tokenDocs = Array.from(scene?.tokens?.contents ?? []);

  for (const tokenDoc of tokenDocs) {
    if (!isWarfareUnitActorType(tokenDoc?.actor?.type)) continue;
    const tokenUuid = String(tokenDoc?.uuid ?? "");
    if (!tokenUuid) continue;
    units[tokenUuid] = normalizeBattlefieldUnitState(rawUnits[tokenUuid] ?? {}, tokenDoc);
  }

  for (const [tokenUuid, entry] of Object.entries(rawUnits)) {
    const normalizedUuid = String(tokenUuid ?? "");
    if (!normalizedUuid || units[normalizedUuid]) continue;
    units[normalizedUuid] = normalizeBattlefieldUnitState(entry ?? {}, null);
  }

  return { units };
}

export function synchronizeBattlefieldStateForScene(scene, state = {}) {
  const current = state?.battlefield && typeof state.battlefield === "object" ? state.battlefield : {};
  return normalizeBattlefieldState(current, scene);
}
