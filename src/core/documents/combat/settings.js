import { getCachedSetting } from "../../config/settings-cache.js";

export function getActionPointAutomationSetting() {
  const value = getCachedSetting("actionPointAutomation");
  return typeof value === "string" ? value : "off";
}

export function isDynamicInitiativeEnabledSetting() {
  return Boolean(getCachedSetting("dynamicInitiativeEnabled"));
}

export function getCombatRollModeMessageOptions() {
  let rollMode = "roll";
  try { rollMode = String(game.settings.get("core", "rollMode") ?? "roll").toLowerCase(); }
  catch (_e) { rollMode = "roll"; }

  if (rollMode === "gmroll") return { rollMode, whisper: ChatMessage.getWhisperRecipients("GM") };
  if (rollMode === "blindroll") return { rollMode, whisper: ChatMessage.getWhisperRecipients("GM"), blind: true };
  if (rollMode === "selfroll") return { rollMode, whisper: [game.user.id] };
  return { rollMode };
}
