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
 * Target: Foundry VTT v13.351
 */

const NAMESPACE = "uesrpg-3ev4";

/**
 * Open the Enchanting Workshop for the current actor.
 *
 * @param {{ actorUuid?: string, mode?: string }} [opts]
 */
export async function openEnchantingWorkshop(opts = {}) {
  // Resolve actor
  let actorUuid = opts.actorUuid ?? null;

  if (!actorUuid) {
    // Try controlled token first
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length === 1) {
      actorUuid = controlled[0].actor?.uuid ?? null;
    } else if (controlled.length > 1) {
      ui.notifications?.warn("Enchanting Workshop: Multiple tokens are selected. Please select exactly one token.");
      return;
    }
  }

  if (!actorUuid) {
    // Fall back to assigned character
    actorUuid = game.user?.character?.uuid ?? null;
  }

  if (!actorUuid) {
    ui.notifications?.warn(
      "Enchanting Workshop: No actor found. Control a token or assign a character to your user account."
    );
    return;
  }

  // Import and render the app
  const { EnchantingWorkshopAppV2 } = await import(
    "../ui/apps/v2/enchanting-workshop-app.js"
  );

  // Check if already open — if so, bring to front
  const existing = Object.values(ui.windows ?? {}).find(
    w => w instanceof EnchantingWorkshopAppV2 && w._actorUuid === actorUuid
  );
  if (existing) {
    existing.bringToTop();
    return;
  }

  const app = new EnchantingWorkshopAppV2({
    actorUuid,
    mode: opts.mode ?? "cast",
  });

  await app.render(true);
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
