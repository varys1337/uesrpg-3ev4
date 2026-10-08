import { isActiveGMUser } from "../../../utils/users.js";
import { FLAG_SCOPE } from "../../constants.js";
import {
  getDistanceToBattlefieldEdge,
  getNearestBattlefieldEdge,
} from "./geometry.js";
import {
  getSceneWarfareEncounterState,
  isSceneWarfareEncounterActive,
} from "../encounter/state.js";
import { synchronizeWarfareEncounter } from "../encounter/controller.js";
import { isMassCombatEnabled } from "../../homebrew/settings.js";
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
  return ["x", "y", "width", "height", "elevation", "disposition", "actorId", "actorLink"].some(key => key in changed);
}

export function registerWarfareBattlefieldHooks() {
  if (_registered) return;
  _registered = true;

  Hooks.on("preUpdateToken", (tokenDoc, changed) => {
    if (!isMassCombatEnabled()) return undefined;
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

  Hooks.on("updateScene", (scene, changed) => {
    if (!isMassCombatEnabled() || !isActiveGMUser(game.user)) return;
    const keys = Object.keys(foundry.utils.flattenObject(changed ?? {}));
    if (!keys.some(key => key.startsWith(`flags.${FLAG_SCOPE}.warfareEncounter`) || ["width", "height", "grid.size"].includes(key))) return;
    void synchronizeWarfareEncounter(scene).catch(error => console.error("UESRPG | Battlefield synchronization failed", error));
  });

  Hooks.on("updateToken", (tokenDoc, changed) => {
    if (!isMassCombatEnabled()) return;
    if (!isActiveGMUser(game.user) || !_shouldSyncBattlefieldToken(tokenDoc, changed)) return;
    void synchronizeWarfareEncounter(tokenDoc?.parent ?? game?.scenes?.current ?? null).catch(error => console.error("UESRPG | Battlefield synchronization failed", error));
  });

  for (const event of ["createToken", "deleteToken"]) Hooks.on(event, token => {
    if (!isMassCombatEnabled() || !isActiveGMUser(game.user) || token.actor?.type !== "Warfare Unit") return;
    void synchronizeWarfareEncounter(token.parent).catch(error => console.error("UESRPG | Battlefield synchronization failed", error));
  });

  Hooks.on("updateActor", (actor, changed) => {
    if (!isMassCombatEnabled()) return;
    if (!isActiveGMUser(game.user) || actor?.type !== "Warfare Unit") return;
    const keys = Object.keys(foundry.utils.flattenObject(changed ?? {}));
    if (!keys.some(key => key.startsWith("system.status.battle") || key.startsWith("system.stats.speed") || ["name", "type"].includes(key))) return;
    const scenes = Array.from(game?.scenes?.contents ?? []);
    for (const scene of scenes) {
      const hasToken = Array.from(scene?.tokens?.contents ?? []).some((tokenDoc) => String(tokenDoc?.actor?.uuid ?? "") === String(actor?.uuid ?? ""));
      if (!hasToken) continue;
      void synchronizeWarfareEncounter(scene).catch(error => console.error("UESRPG | Battlefield synchronization failed", error));
    }
  });

  Hooks.on("updateRegion", (region, changed) => {
    if (!isMassCombatEnabled()) return;
    if (!isActiveGMUser(game.user)) return;
    const keys = Object.keys(foundry.utils.flattenObject(changed ?? {}));
    if (!keys.some(key => key.startsWith("shapes") || key.startsWith("elevation") || key.startsWith(`flags.${FLAG_SCOPE}.warfareTerrain`) || key.startsWith(`flags.${FLAG_SCOPE}.warfareFeature`))) return;
    void synchronizeWarfareEncounter(region?.parent ?? null).catch(error => console.error("UESRPG | Battlefield synchronization failed", error));
  });

  Hooks.on("createRegion", (region) => {
    if (!isMassCombatEnabled()) return;
    if (!isActiveGMUser(game.user)) return;
    void synchronizeWarfareEncounter(region?.parent ?? null).catch(error => console.error("UESRPG | Battlefield synchronization failed", error));
  });

  Hooks.on("deleteRegion", (region) => {
    if (!isMassCombatEnabled()) return;
    if (!isActiveGMUser(game.user)) return;
    void synchronizeWarfareEncounter(region?.parent ?? null).catch(error => console.error("UESRPG | Battlefield synchronization failed", error));
  });
}

function actorMustRetreat(scene, tokenDoc) {
  if (!isSceneWarfareEncounterActive(scene)) return false;
  const actor = tokenDoc?.actor ?? null;
  return Boolean(actor?.system?.status?.battle?.broken);
}
