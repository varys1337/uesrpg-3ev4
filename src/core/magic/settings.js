import { getCachedSetting } from "../config/settings-cache.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";

export function getMagicOpposedPostSubRollMessagesEnabled() {
  try {
    const key = `${FLAG_SCOPE}.opposedPostSubRollMessages`;
    if (!game?.settings?.settings?.has?.(key)) return true;
    return game.settings.get(FLAG_SCOPE, "opposedPostSubRollMessages") !== false;
  } catch (_err) {
    return true;
  }
}

export function getMagicSubRollMode({ fallback = "roll" } = {}) {
  return getCoreRollMode({ fallback });
}

export function isMagicDynamicInitiativeEnabled() {
  return Boolean(getCachedSetting("dynamicInitiativeEnabled"));
}
