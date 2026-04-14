import { findOpenAppInstance, focusOpenApp, resolveMacroActor, resolveMacroActorInput } from "./shared.js";

/**
 * Character Generation Wizard macro entrypoint.
 *
 * Usage:
 *   game.uesrpg.chargen.openWizard();
 */

export async function openCharGenWizard(opts = {}) {
  const actor = await resolveMacroActor({
    actorUuid: opts.actorUuid ?? null,
    multipleSelectionWarning: "Character Generation Wizard: select exactly one token, or none.",
    noActorWarning: "Character Generation Wizard: No actor found. Control a token or assign a character to your user account.",
  });
  if (!actor) return;

  const { CharGenWizardAppV2 } = await import("../ui/apps/v2/char-gen/char-gen-wizard.js");

  const existing = findOpenAppInstance(CharGenWizardAppV2);
  if (existing) return focusOpenApp(existing, { maximize: true });

  return CharGenWizardAppV2.prompt({
    actorUuid: actor.uuid,
    name: opts.name ?? "",
  });
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
