import { SYSTEM_ID } from "../constants.js";
import { MIGRATION_REVISIONS } from "./revisions.js";
import { isActiveGMUser } from "../../utils/users.js";

/** Failure evidence is independent of the saved revision and review advice. */
export function getMigrationFailureCount(record) {
  return Math.max(0, Number(record?.failures) || 0, Number(record?.result?.failed) || 0);
}

export function getSystemVersionString() {
  return String(game.system?.version ?? "").trim() || "0";
}

/** Read availability without changing the legacy getMigrationState fallback. */
export function readMigrationStateSnapshot() {
  try {
    const raw = String(game.settings.get(SYSTEM_ID, "migrationState") ?? "{}");
    const parsed = JSON.parse(raw);
    return { available: Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed)),
      state: (parsed && typeof parsed === "object") ? parsed : {} };
  } catch (_e) {
    return { available: false, state: {} };
  }
}

export function getMigrationState() {
  return readMigrationStateSnapshot().state;
}

export async function setMigrationState(next) {
  if (!isActiveGMUser(game.user)) throw new Error("Only the active GM may save migration completion.");
  const safe = (next && typeof next === "object") ? next : {};
  const serialized = JSON.stringify(safe);
  const assigned = await game.settings.set(SYSTEM_ID, "migrationState", serialized);
  if (assigned !== serialized || game.settings.get(SYSTEM_ID, "migrationState") !== serialized) {
    throw new Error("Migration completion state was not confirmed; inspect persisted revisions before retrying.");
  }
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
  return getMigrationFailureCount(state?.[key]) === 0 && getAppliedMigrationRevision(key, state) >= required;
}

export function markMigrationRevisionApplied(state, key, revision, extra = {}) {
  if (!state || typeof state !== "object") return state;
  if (getMigrationFailureCount(extra) > 0) {
    const error = new Error(`Cannot complete migration ${key} with known failures.`);
    error.migrationTelemetry = { key, ...extra };
    throw error;
  }
  if (!isActiveGMUser(game.user)) throw new Error("Only the active GM may mark migration completion.");
  state[key] = {
    ...extra,
    revision: Number(revision) || 0,
    appliedAt: Date.now(),
    systemVersion: getSystemVersionString(),
    appliedBy: game.user.id,
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
