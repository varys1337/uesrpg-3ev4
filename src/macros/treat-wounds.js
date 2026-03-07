/**
 * src/macros/treat-wounds.js
 *
 * Treat Wounds macro entry point.
 *
 * Macro command:
 *   game.uesrpg.wounds.openTreatWoundsMacroDialog();
 */

export async function openTreatWoundsMacro(opts = {}) {
  const fn = game?.uesrpg?.wounds?.openTreatWoundsMacroDialog;
  if (typeof fn !== "function") {
    ui.notifications?.warn?.("Treat Wounds macro API is unavailable.");
    return { ok: false, reason: "missingApi" };
  }
  return fn(opts);
}

export function registerTreatWoundsMacroApi() {
  game.uesrpg = game.uesrpg || {};
  game.uesrpg.wounds = game.uesrpg.wounds || {};
  game.uesrpg.wounds.openTreatWoundsMacro = openTreatWoundsMacro;
}

