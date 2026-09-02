import { SYSTEM_ID } from "../../core/constants.js";
import { isDebugEnabled } from "../../utils/debug.js";

/**
 * Register startup-ready hooks for font application and developer diagnostics setup.
 */
export function registerMigrations() {
  Hooks.once("ready", async () => {
    const fontFamily = game.settings.get(SYSTEM_ID, "changeUiFont");
    document.documentElement.style.setProperty("--main-font-family", fontFamily);

    if (game.user?.isGM && isDebugEnabled?.("debugSkillTN")) {
      try {
        const mod = await import("../../utils/dev/skill-tn-debug.js");
        mod?.registerSkillTNDebug?.();
      } catch (err) {
        console.warn("UESRPG | Failed to load/register skill TN debug tools", err);
      }
    }

    if (isDebugEnabled?.("debugActorSelect")) {
      try {
        const mod = await import("../../utils/dev/actor-select-debug.js");
        mod?.registerActorSelectDebug?.();
      } catch (err) {
        console.warn("UESRPG | Failed to load/register actor select debug tools", err);
      }
    }
  });
}
