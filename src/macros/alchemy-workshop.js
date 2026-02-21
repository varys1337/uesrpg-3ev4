/**
 * src/macros/alchemy-workshop.js
 *
 * Alchemy Workshop — macro entry point.
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
 * once by system.js during the init hook.  This file is responsible only for
 * the openAlchemyWorkshop() function that the API delegates to.
 */

/**
 * Open the Alchemy Workshop for the given actor (or the currently controlled token's actor).
 *
 * @param {object} [opts]
 * @param {string} [opts.actorUuid]  UUID of the actor to open the workshop for.
 * @param {string} [opts.mode]       Initial mode: "potion" | "poison" | "toxin" | "gather". Default "potion".
 */
export async function openAlchemyWorkshop({ actorUuid = null, mode = "potion" } = {}) {
  // Resolve actor: explicit UUID → single controlled token → user character.
  let resolvedActor = null;
  if (actorUuid) {
    resolvedActor = await fromUuid(actorUuid);
  }

  if (!resolvedActor) {
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length === 1) {
      resolvedActor = controlled[0].actor ?? null;
    } else if (controlled.length > 1) {
      ui.notifications.warn(
        "Alchemy Workshop: Multiple tokens are selected. Please select exactly one token."
      );
      return;
    }
  }

  if (!resolvedActor) {
    resolvedActor = game.user?.character ?? null;
  }

  if (!resolvedActor) {
    ui.notifications.warn(
      "Alchemy Workshop: No actor found. Control a token or assign a character to your user account."
    );
    return;
  }

  // Lazy-load the AppV2 class — defers parse cost until first open,
  // matching the same pattern used by enchanting-workshop.js.
  const { AlchemyWorkshopAppV2 } = await import("../ui/apps/v2/alchemy-workshop-app.js");

  // De-duplication: bring to front if already open for this actor.
  const existing = Object.values(ui.windows ?? {}).find(
    (app) => app instanceof AlchemyWorkshopAppV2 && app._actorUuid === resolvedActor.uuid
  );
  if (existing) {
    existing.bringToTop();
    return;
  }

  // Open the workshop.
  const app = new AlchemyWorkshopAppV2({
    actorUuid: resolvedActor.uuid,
    mode,
  });
  await app.render(true);
}
