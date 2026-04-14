import { getCachedSetting } from "../../config/settings-cache.js";
import { getChatMessageModeOptions } from "../../../utils/chat-roll-mode.js";

export function getActionPointAutomationSetting() {
  const value = getCachedSetting("actionPointAutomation");
  return typeof value === "string" ? value : "off";
}

export function isDynamicInitiativeEnabledSetting() {
  return Boolean(getCachedSetting("dynamicInitiativeEnabled"));
}

export function getCombatRollModeMessageOptions() {
  return getChatMessageModeOptions();
}
