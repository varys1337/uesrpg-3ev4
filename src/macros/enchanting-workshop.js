import { findOpenAppInstance, focusOpenApp, resolveMacroActor } from "./shared.js";
import { loadDeferredModule } from "../utils/deferred-module.js";
import { t } from "../utils/i18n.js";

/**
 * src/macros/enchanting-workshop.js
 *
 * Enchanting Workshop macro entry point.
 *
 * How to use:
 *   1. Create a Macro in Foundry (Script type).
 *   2. Paste the following into the macro body:
 *
 *      game.uesrpg.enchanting.openWorkshop();
 *
 *   3. Execute the macro with a controlled token selected (or via the actor sheet).
 *
 * The macro resolves the actor from:
 *   - The first controlled token's actor
 *   - Falling back to game.user.character
 *
 * Target: Foundry VTT v14.363+
 */

const NAMESPACE = "uesrpg-3ev4";

/**
 * Open the Enchanting Workshop for the current actor.
 *
 * @param {{ actorUuid?: string, mode?: string }} [opts]
 */
export async function openEnchantingWorkshop(opts = {}) {
  const actor = await resolveMacroActor({
    actorUuid: opts.actorUuid ?? null,
    multipleSelectionWarning: t("UESRPG.Notifications.Enchanting.MultipleTokensSelected"),
    noActorWarning: t("UESRPG.Notifications.Enchanting.NoWorkshopActor"),
  });
  if (!actor) return;

  const actorUuid = actor.uuid;
  const module = await loadDeferredModule(
    () => import("../ui/apps/v2/enchanting-workshop-app.js"),
    { label: t("UESRPG.Apps.EnchantingWorkshop.Title") },
  );
  if (!module) return null;
  const { EnchantingWorkshopAppV2 } = module;

  const existing = findOpenAppInstance(
    EnchantingWorkshopAppV2,
    (app) => app._actorUuid === actorUuid,
  );
  if (existing) return focusOpenApp(existing);

  return EnchantingWorkshopAppV2.prompt({
    actorUuid,
    mode: opts.mode ?? "cast",
  });
}

/**
 * Expose on game.uesrpg.enchanting for use in macros.
 * Called from system.js during the 'ready' hook.
 */
export function registerEnchantingApi() {
  if (!game.uesrpg) game.uesrpg = {};
  if (!game.uesrpg.enchanting) game.uesrpg.enchanting = {};

  game.uesrpg.enchanting.openWorkshop = openEnchantingWorkshop;
}
