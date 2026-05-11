import { resolveMacroActorInput } from "./shared.js";

/**
 * Character Generation Wizard macro entrypoint.
 *
 * Usage:
 *   game.uesrpg.chargen.openWizard();
 */

export async function openCharGenWizard(opts = {}) {
  let actor = null;

  if (opts.actorUuid) {
    const resolved = await fromUuid(String(opts.actorUuid));
    if (resolved?.documentName === "Actor") actor = resolved;
    else ui.notifications?.warn?.("Character Generation Wizard: actor UUID could not be resolved. Opening without a preselected actor.");
  }

  if (!actor) {
    const controlled = Array.from(canvas?.tokens?.controlled ?? []);
    if (controlled.length === 1) actor = controlled[0]?.actor ?? null;
    else if (controlled.length > 1) {
      ui.notifications?.warn?.("Character Generation Wizard: multiple tokens selected. Opening without a preselected actor.");
    }
  }

  const { CharGenWizardAppV2 } = await import("../ui/apps/v2/char-gen/char-gen-wizard.js");

  const promptOptions = { name: opts.name ?? "" };
  if (actor?.uuid) promptOptions.actorUuid = actor.uuid;
  return CharGenWizardAppV2.prompt(promptOptions);
}

export async function runRawChargenFlow(actorOrOpts = {}) {
  const actor = await resolveMacroActorInput(actorOrOpts);
  if (!actor || actor.documentName !== "Actor") {
    ui.notifications?.warn?.("No actor found for RAW chargen flow.");
    return false;
  }

  const { runRawChargen } = await import("../ui/apps/v2/char-gen/run-raw-chargen.js");
  return runRawChargen(actor);
}

export function registerCharGenApi() {
  if (!game.uesrpg) game.uesrpg = {};
  if (!game.uesrpg.chargen) game.uesrpg.chargen = {};
  game.uesrpg.chargen.openWizard = openCharGenWizard;
  game.uesrpg.chargen.runRaw = runRawChargenFlow;
}
