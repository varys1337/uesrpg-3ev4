import { SYSTEM_ID } from "../constants.js";
import { MIGRATION_REVISIONS } from "./revisions.js";

export function getSystemVersionString() {
  return String(game.system?.version ?? "").trim() || "0";
}

export function getMigrationState() {
  try {
    const raw = String(game.settings.get(SYSTEM_ID, "migrationState") ?? "{}");
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch (_e) {
    return {};
  }
}

export async function setMigrationState(next) {
  const safe = (next && typeof next === "object") ? next : {};
  await game.settings.set(SYSTEM_ID, "migrationState", JSON.stringify(safe));
}

export function getAppliedMigrationRevision(key, state = getMigrationState()) {
  const value = state?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const revision = Number(value.revision);
    if (Number.isFinite(revision)) return revision;
    return 1;
  }
  if (typeof value === "string" && value.trim()) return 1;
  if (value === true) return 1;
  return 0;
}

export function isMigrationRevisionApplied(key, requiredRevision, state = getMigrationState()) {
  const required = Number(requiredRevision) || 0;
  if (required <= 0) return true;
  return getAppliedMigrationRevision(key, state) >= required;
}

export function markMigrationRevisionApplied(state, key, revision, extra = {}) {
  if (!state || typeof state !== "object") return state;
  state[key] = {
    revision: Number(revision) || 0,
    appliedAt: Date.now(),
    systemVersion: getSystemVersionString(),
    ...extra
  };
  return state;
}

export function getPendingMigrationKeys(keysOrMap, state = getMigrationState()) {
  const entries = Array.isArray(keysOrMap)
    ? keysOrMap.map((key) => [key, MIGRATION_REVISIONS[key]])
    : Object.entries(keysOrMap ?? {});
  return entries
    .filter(([key, revision]) => key && Number(revision) > 0 && !isMigrationRevisionApplied(key, revision, state))
    .map(([key]) => key);
}
