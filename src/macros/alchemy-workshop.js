import { findOpenAppInstance, focusOpenApp, resolveMacroActor } from "./shared.js";

/**
 * src/macros/alchemy-workshop.js
 *
 * Alchemy Workshop macro entry point.
 *
 * Exposes game.uesrpg.alchemy.openWorkshop(opts) for use from compendium macros.
 *
 * Usage in a macro:
 *   game.uesrpg.alchemy.openWorkshop();
 *   // or with a specific actor:
 *   game.uesrpg.alchemy.openWorkshop({ actorUuid: "Actor.abc123", mode: "potion" });
 *
 * De-duplication: if the workshop is already open for this actor, bring it
 * to the front instead of opening a second instance (mirrors enchanting workshop).
 *
 * Target: Foundry VTT v13.351
 *
 * Note: registerAlchemyApi() lives in src/core/alchemy/index.js and is called
 * once by system.js during the init hook. This file is responsible only for
 * the openAlchemyWorkshop() function that the API delegates to.
 */

/**
 * Open the Alchemy Workshop for the given actor (or the currently controlled token's actor).
 *
 * @param {object} [opts]
 * @param {string} [opts.actorUuid] UUID of the actor to open the workshop for.
 * @param {string} [opts.mode] Initial mode: "potion" | "poison" | "toxin" | "gather". Default "potion".
 */
export async function openAlchemyWorkshop({ actorUuid = null, mode = "potion" } = {}) {
  const resolvedActor = await resolveMacroActor({
    actorUuid,
    multipleSelectionWarning: "Alchemy Workshop: Multiple tokens are selected. Please select exactly one token.",
    noActorWarning: "Alchemy Workshop: No actor found. Control a token or assign a character to your user account.",
  });
  if (!resolvedActor) return;

  // Lazy-load the AppV2 class to defer parse cost until first open.
  const { AlchemyWorkshopAppV2 } = await import("../ui/apps/v2/alchemy-workshop-app.js");

  const existing = findOpenAppInstance(
    AlchemyWorkshopAppV2,
    (app) => app._actorUuid === resolvedActor.uuid,
  );
  if (existing) return focusOpenApp(existing);

  const app = new AlchemyWorkshopAppV2({
    actorUuid: resolvedActor.uuid,
    mode,
  });
  await app.render(true);
}
