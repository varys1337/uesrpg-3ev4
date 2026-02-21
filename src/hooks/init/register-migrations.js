/**
 * Register startup-ready hooks for font application, migration pass,
 * and developer diagnostics setup.
 */
export function registerMigrations({
  migrateItemsIfNeeded,
  normalizeItems,
  isDebugEnabled,
  registerSkillTNDebug,
  registerActorSelectDebug,
} = {}) {
  Hooks.once("ready", async () => {
    const fontFamily = game.settings.get("uesrpg-3ev4", "changeUiFont");
    document.documentElement.style.setProperty("--main-font-family", fontFamily);

    if (game.user?.isGM) {
      try {
        await migrateItemsIfNeeded();
        await normalizeItems();
      } catch (err) {
        console.error("UESRPG | Item migration/normalization startup pass failed", err);
        ui.notifications?.warn?.("UESRPG item migration pass failed; check console for details.");
      }
    }

    if (game.user?.isGM && isDebugEnabled?.("debugSkillTN")) {
      registerSkillTNDebug?.();
    }

    registerActorSelectDebug?.();
  });
}
