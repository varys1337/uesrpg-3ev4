import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { clonePlain } from "../../utils/clone.js";
import { SYSTEM_ID } from "../system/namespace.js";

export const CONSECRATION_VERSION = 1;

function asKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function createDefaultConsecrationState() {
  return {
    version: CONSECRATION_VERSION,
    domainKey: "",
    deityName: "",
    active: false,
    permanent: false,
    createdBy: "",
    sourceInvocationId: "",
    notes: "",
    createdAt: 0,
    updatedAt: 0,
  };
}

export function migrateConsecrationState(rawState) {
  const base = createDefaultConsecrationState();
  if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) return base;
  const next = foundry.utils.mergeObject(base, clonePlain(rawState), {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true,
  });
  next.version = CONSECRATION_VERSION;
  next.domainKey = asKey(next.domainKey);
  next.deityName = String(next.deityName ?? "").trim();
  next.active = Boolean(next.active);
  next.permanent = Boolean(next.permanent);
  next.createdBy = String(next.createdBy ?? "").trim();
  next.sourceInvocationId = String(next.sourceInvocationId ?? "").trim();
  next.notes = String(next.notes ?? "").trim();
  next.createdAt = Number(next.createdAt ?? 0) || 0;
  next.updatedAt = Number(next.updatedAt ?? 0) || 0;
  return next;
}

export function getRegionConsecrationState(region) {
  if (!region) return createDefaultConsecrationState();
  const raw = region.flags?.[SYSTEM_ID]?.consecration ?? null;
  return migrateConsecrationState(raw);
}

export async function updateRegionConsecrationState(region, updater) {
  if (!region) throw new Error("Missing region for consecration update.");
  const current = getRegionConsecrationState(region);
  const next = typeof updater === "function"
    ? await updater(clonePlain(current))
    : foundry.utils.mergeObject(current, clonePlain(updater ?? {}), {
      inplace: false,
      insertKeys: true,
      insertValues: true,
      overwrite: true,
    });
  const migrated = migrateConsecrationState(next);
  migrated.updatedAt = Date.now();
  if (!migrated.createdAt && migrated.active) migrated.createdAt = migrated.updatedAt;
  await requestUpdateDocument(region, {
    [`flags.${SYSTEM_ID}.consecration`]: migrated,
  });
  return migrated;
}

export function getActiveConsecratedRegionsForToken(token, { domainKey = "" } = {}) {
  const regionDomainKey = asKey(domainKey);
  const scene = token?.scene ?? canvas?.scene ?? null;
  const center = token?.center ?? null;
  if (!scene || !center) return [];

  return Array.from(scene.regions?.contents ?? []).filter((region) => {
    if (typeof region?.testPoint !== "function") return false;
    const state = getRegionConsecrationState(region);
    if (!state.active) return false;
    if (regionDomainKey && state.domainKey !== regionDomainKey) return false;
    try {
      return region.testPoint(center);
    } catch (_err) {
      return false;
    }
  });
}

export function isActorInsideMatchingConsecratedRegion(actor, domainKey = "") {
  const tokens = actor?.getActiveTokens?.() ?? [];
  for (const token of tokens) {
    if (getActiveConsecratedRegionsForToken(token, { domainKey }).length > 0) return true;
  }
  return false;
}
