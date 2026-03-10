import { SYSTEM_ID } from "../../core/constants.js";
import { isDebugEnabled } from "../../utils/debug.js";
import { runSystemMigrations } from "../../core/migrations/runner.js";

/**
 * Register startup-ready hooks for font application, migration pass,
 * and developer diagnostics setup.
 */
export function registerMigrations({
  migrateActorsIfNeeded,
  normalizeActors,
  migrateItemsIfNeeded,
  normalizeItems,
  migrateCombatLegacyIfNeeded,
} = {}) {
  Hooks.once("ready", async () => {
    const fontFamily = game.settings.get(SYSTEM_ID, "changeUiFont");
    document.documentElement.style.setProperty("--main-font-family", fontFamily);

    if (game.user?.isGM) {
      try {
        // Keep manual normalization lanes available via exported functions,
        // but do not auto-run them on startup to avoid duplicate traversal work.
        void normalizeActors;
        void normalizeItems;
        void migrateActorsIfNeeded;
        void migrateItemsIfNeeded;
        void migrateCombatLegacyIfNeeded;

        const autoRun = game.settings.get(SYSTEM_ID, "autoRunMigrationsOnStartup") === true;
        if (autoRun) {
          await runSystemMigrations({
            origin: "startup",
            notifyStart: false,
            notifySuccess: false,
            notifyFailure: true,
          });
        }
      } catch (err) {
        console.error("UESRPG | Actor/item/combat migration startup pass failed", err);
        ui.notifications?.warn?.("UESRPG startup migration pass failed; check console for details.");
      }
    }

    if (game.user?.isGM && isDebugEnabled?.("debugSkillTN")) {
      try {
        const mod = await import("../../utils/dev/skill-tn-debug.js");
        mod?.registerSkillTNDebug?.();
      } catch (err) {
        console.warn("UESRPG | Failed to load/register skill TN debug tools", err);
      }
    }

    try {
      const mod = await import("../../utils/dev/actor-select-debug.js");
      mod?.registerActorSelectDebug?.();
    } catch (err) {
      console.warn("UESRPG | Failed to load/register actor select debug tools", err);
    }
  });
}
