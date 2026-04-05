import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { cloneFlagState, clonePlain } from "../../../utils/clone.js";
import { FLAG_SCOPE } from "../../system/namespace.js";

export const WARFARE_SIEGE_FLAG_KEY = "warfareSiege";
export const WARFARE_FEATURE_FLAG_KEY = "warfareFeature";
export const WARFARE_SIEGE_VERSION = 1;
export const WARFARE_FEATURE_VERSION = 1;
export const WARFARE_FEATURE_TYPES = [
  "wall",
  "gate",
  "tower",
  "mantlet",
  "caltrops",
  "spikes",
  "fascines",
  "palisade",
  "mound",
];

export function createDefaultWarfareSiegeState() {
  return {
    version: WARFARE_SIEGE_VERSION,
    active: false,
    attackerArmyUuid: "",
    defenderArmyUuid: "",
    settlementName: "",
    fortificationRating: 1,
    fortificationHp: 8,
    fortificationHpMax: 8,
    blockadeState: "none",
    sapProgress: 0,
    breachProgress: 0,
    repairProgress: 0,
    supplyPressure: 0,
    history: [],
  };
}

export function migrateWarfareSiegeState(rawState) {
  const base = createDefaultWarfareSiegeState();
  if (!rawState || typeof rawState !== "object") return base;
  const next = foundry.utils.mergeObject(base, cloneFlagState(rawState), {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true,
  });
  next.version = WARFARE_SIEGE_VERSION;
  next.fortificationRating = Math.max(1, Math.min(4, Number(next.fortificationRating ?? 1) || 1));
  next.fortificationHpMax = Math.max(1, Number(next.fortificationHpMax ?? (next.fortificationRating * 8)) || (next.fortificationRating * 8));
  next.fortificationHp = Math.max(0, Math.min(next.fortificationHpMax, Number(next.fortificationHp ?? next.fortificationHpMax) || 0));
  next.sapProgress = Math.max(0, Number(next.sapProgress ?? 0) || 0);
  next.breachProgress = Math.max(0, Number(next.breachProgress ?? 0) || 0);
  next.repairProgress = Math.max(0, Number(next.repairProgress ?? 0) || 0);
  next.supplyPressure = Math.max(0, Number(next.supplyPressure ?? 0) || 0);
  next.history = Array.isArray(next.history) ? next.history : [];
  return next;
}

export function getSceneWarfareSiegeState(scene) {
  if (!scene) return createDefaultWarfareSiegeState();
  const raw = scene.flags?.[FLAG_SCOPE]?.[WARFARE_SIEGE_FLAG_KEY] ?? null;
  return migrateWarfareSiegeState(raw);
}

export async function updateSceneWarfareSiegeState(scene, updater) {
  if (!scene) throw new Error("Missing scene for warfare siege update.");
  const current = getSceneWarfareSiegeState(scene);
  const next = typeof updater === "function"
    ? await updater(clonePlain(current))
    : foundry.utils.mergeObject(current, clonePlain(updater ?? {}), {
      inplace: false,
      overwrite: true,
      insertKeys: true,
      insertValues: true,
    });
  const migrated = migrateWarfareSiegeState(next);
  await requestUpdateDocument(scene, {
    [`flags.${FLAG_SCOPE}.${WARFARE_SIEGE_FLAG_KEY}`]: migrated,
  });
  return migrated;
}

export function createDefaultWarfareFeatureState() {
  return {
    version: WARFARE_FEATURE_VERSION,
    featureId: "",
    kind: "deployable",
    type: "",
    sourceArmyUuid: "",
    sourceUnitActorUuid: "",
    hp: 0,
    hpMax: 0,
    intact: true,
    breached: false,
    movementCost: 1,
    blocksCharge: false,
    coverBonus: 0,
    defenseBonus: 0,
    notes: "",
  };
}

export function migrateWarfareFeatureState(rawState) {
  const base = createDefaultWarfareFeatureState();
  if (!rawState || typeof rawState !== "object") return base;
  const next = foundry.utils.mergeObject(base, cloneFlagState(rawState), {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true,
  });
  next.version = WARFARE_FEATURE_VERSION;
  next.kind = String(next.kind ?? "deployable").trim().toLowerCase() === "fortification" ? "fortification" : "deployable";
  next.type = WARFARE_FEATURE_TYPES.includes(String(next.type ?? "").trim().toLowerCase())
    ? String(next.type).trim().toLowerCase()
    : "";
  next.hp = Math.max(0, Number(next.hp ?? 0) || 0);
  next.hpMax = Math.max(0, Number(next.hpMax ?? next.hp ?? 0) || 0);
  next.movementCost = Math.max(1, Number(next.movementCost ?? 1) || 1);
  next.coverBonus = Number(next.coverBonus ?? 0) || 0;
  next.defenseBonus = Number(next.defenseBonus ?? 0) || 0;
  next.intact = Boolean(next.intact) && next.hp > 0;
  next.breached = Boolean(next.breached);
  if (!next.featureId) next.featureId = foundry.utils.randomID();
  return next;
}

export function getRegionWarfareFeatureState(region) {
  if (!region) return createDefaultWarfareFeatureState();
  const raw = region.flags?.[FLAG_SCOPE]?.[WARFARE_FEATURE_FLAG_KEY] ?? null;
  return migrateWarfareFeatureState(raw);
}

export async function updateRegionWarfareFeatureState(region, updater) {
  if (!region) throw new Error("Missing region for warfare feature update.");
  const current = getRegionWarfareFeatureState(region);
  const next = typeof updater === "function"
    ? await updater(clonePlain(current))
    : foundry.utils.mergeObject(current, clonePlain(updater ?? {}), {
      inplace: false,
      overwrite: true,
      insertKeys: true,
      insertValues: true,
    });
  const migrated = migrateWarfareFeatureState(next);
  await requestUpdateDocument(region, {
    [`flags.${FLAG_SCOPE}.${WARFARE_FEATURE_FLAG_KEY}`]: migrated,
  });
  return migrated;
}
