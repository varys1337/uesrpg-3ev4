import {
  getDistanceToBattlefieldEdge,
  getNearestBattlefieldEdge,
} from "./geometry.js";
import {
  getSceneWarfareEncounterState,
  isSceneWarfareEncounterActive,
} from "../encounter/state.js";
import { synchronizeWarfareEncounter } from "../encounter/controller.js";
let _registered = false;

function _previewTokenDoc(tokenDoc, changed) {
  return {
    ...tokenDoc,
    x: Number(changed?.x ?? tokenDoc?.x ?? 0) || 0,
    y: Number(changed?.y ?? tokenDoc?.y ?? 0) || 0,
    width: Number(tokenDoc?.width ?? 1) || 1,
    height: Number(tokenDoc?.height ?? 1) || 1,
    parent: tokenDoc?.parent ?? null,
    elevation: Number(changed?.elevation ?? tokenDoc?.elevation ?? 0) || 0,
  };
}

function _shouldSyncBattlefieldToken(tokenDoc, changed) {
  if (tokenDoc?.actor?.type !== "Warfare Unit") return false;
  if (!changed || typeof changed !== "object") return false;
  return "x" in changed || "y" in changed || "disposition" in changed;
}

export function registerWarfareBattlefieldHooks() {
  if (_registered) return;
  _registered = true;

  Hooks.on("preUpdateToken", (tokenDoc, changed) => {
    if (!game.user?.isGM || tokenDoc?.actor?.type !== "Warfare Unit") return undefined;
    const scene = tokenDoc?.parent ?? game?.scenes?.current ?? null;
    if (!scene) return undefined;

    if (actorMustRetreat(scene, tokenDoc) && ("x" in (changed ?? {}) || "y" in (changed ?? {}))) {
      const encounterState = getSceneWarfareEncounterState(scene);
      const tokenUuid = String(tokenDoc?.uuid ?? "");
      const edge = String(encounterState?.battlefield?.units?.[tokenUuid]?.routingEdge ?? "") || getNearestBattlefieldEdge(scene, tokenDoc);
      const currentDistance = getDistanceToBattlefieldEdge(scene, tokenDoc, edge);
      const preview = _previewTokenDoc(tokenDoc, changed);
      const nextDistance = getDistanceToBattlefieldEdge(scene, preview, edge);
      if (nextDistance >= currentDistance) {
        ui.notifications?.warn?.("Broken warfare units must move toward their assigned battlefield edge.");
        return false;
      }
    }

    return undefined;
  });

  Hooks.on("updateToken", (tokenDoc, changed) => {
    if (!game.user?.isGM || !_shouldSyncBattlefieldToken(tokenDoc, changed)) return;
    void synchronizeWarfareEncounter(tokenDoc?.parent ?? game?.scenes?.current ?? null);
  });

  Hooks.on("updateActor", (actor) => {
    if (!game.user?.isGM || actor?.type !== "Warfare Unit") return;
    const scenes = Array.from(game?.scenes?.contents ?? []);
    for (const scene of scenes) {
      const hasToken = Array.from(scene?.tokens?.contents ?? []).some((tokenDoc) => String(tokenDoc?.actor?.id ?? "") === String(actor?.id ?? ""));
      if (!hasToken) continue;
      void synchronizeWarfareEncounter(scene);
    }
  });

  Hooks.on("updateRegion", (region) => {
    if (!game.user?.isGM) return;
    void synchronizeWarfareEncounter(region?.parent ?? null);
  });

  Hooks.on("createRegion", (region) => {
    if (!game.user?.isGM) return;
    void synchronizeWarfareEncounter(region?.parent ?? null);
  });

  Hooks.on("deleteRegion", (region) => {
    if (!game.user?.isGM) return;
    void synchronizeWarfareEncounter(region?.parent ?? null);
  });
}

function actorMustRetreat(scene, tokenDoc) {
  if (!isSceneWarfareEncounterActive(scene)) return false;
  const actor = tokenDoc?.actor ?? null;
  return Boolean(actor?.system?.status?.battle?.broken);
}
