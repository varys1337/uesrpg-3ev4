import { resolveMacroActorInput } from "./shared.js";
import { loadDeferredModule } from "../utils/deferred-module.js";
import { t } from "../utils/i18n.js";

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
    else ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.ActorUuidUnresolved"));
  }

  if (!actor) {
    const controlled = Array.from(canvas?.tokens?.controlled ?? []);
    if (controlled.length === 1) actor = controlled[0]?.actor ?? null;
    else if (controlled.length > 1) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.MultipleTokensSelected"));
    }
  }

  const module = await loadDeferredModule(
    () => import("../ui/apps/v2/char-gen/char-gen-wizard.js"),
    { label: t("UESRPG.Dialogs.CharGen.WizardTitle") },
  );
  if (!module) return null;
  const { CharGenWizardAppV2 } = module;

  const promptOptions = { name: opts.name ?? "" };
  if (actor?.uuid) promptOptions.actorUuid = actor.uuid;
  return CharGenWizardAppV2.prompt(promptOptions);
}

export async function runRawChargenFlow(actorOrOpts = {}) {
  const actor = await resolveMacroActorInput(actorOrOpts);
  if (!actor || actor.documentName !== "Actor") {
    ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.NoActorForRawFlow"));
    return false;
  }

  const module = await loadDeferredModule(
    () => import("../ui/apps/v2/char-gen/run-raw-chargen.js"),
    { label: t("UESRPG.Dialogs.CharGen.WizardTitle") },
  );
  if (!module) return false;
  const { runRawChargen } = module;
  return runRawChargen(actor);
}

export function registerCharGenApi() {
  if (!game.uesrpg) game.uesrpg = {};
  if (!game.uesrpg.chargen) game.uesrpg.chargen = {};
  game.uesrpg.chargen.openWizard = openCharGenWizard;
  game.uesrpg.chargen.runRaw = runRawChargenFlow;
}
