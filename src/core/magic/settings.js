import { getCachedSetting } from "../config/settings-cache.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";

export function getMagicSubRollMode({ fallback = "roll" } = {}) {
  return getCoreRollMode({ fallback });
}

export function isMagicDynamicInitiativeEnabled() {
  return Boolean(getCachedSetting("dynamicInitiativeEnabled"));
}
