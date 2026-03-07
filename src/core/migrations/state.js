import { SYSTEM_ID } from "../constants.js";

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
