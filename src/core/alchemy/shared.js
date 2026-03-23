import { FLAG_SCOPE } from "../system/namespace.js";

export const FLAG_NS = FLAG_SCOPE;
export const ALCHEMY_DEFAULT_ICON = "icons/consumables/potions/bottle-bulb-empty-glass.webp";

export function cloneAlchemyData(value) {
  try {
    return foundry.utils.deepClone(value);
  } catch (_err) {
    return JSON.parse(JSON.stringify(value));
  }
}

export function getAlchemyFlags(item) {
  return item?.flags?.[FLAG_NS]?.alchemy ?? {};
}

export function emitAlchemyRoll3d(roll, { rollMode = null } = {}) {
  if (!roll) return null;
  const dsn = game?.dice3d;
  if (!dsn || typeof dsn.showForRoll !== "function") return null;

  const mode = String(rollMode ?? game?.settings?.get?.("core", "rollMode") ?? "roll").toLowerCase();
  const sync = mode === "roll" || mode === "publicroll";
  try {
    const primary = dsn.showForRoll(roll, game.user, sync);
    Promise.resolve(primary).catch(() => {
      try {
        const fallback = dsn.showForRoll(roll);
        Promise.resolve(fallback).catch(() => {});
      } catch (_err2) {
        // no-op
      }
    });
  } catch (_err) {
    try {
      const fallback = dsn.showForRoll(roll);
      Promise.resolve(fallback).catch(() => {});
    } catch (_err2) {
      // no-op
    }
  }
  return true;
}

export function formatAlchemyDurationLabel(duration) {
  if (!duration) return "";
  const unit = String(duration.unit ?? "").trim();
  if (!unit) return "";
  return `${Number(duration.value ?? 0)} ${unit}`;
}
