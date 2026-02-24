/**
 * Character Generation Wizard macro entrypoint.
 *
 * Usage:
 *   game.uesrpg.chargen.openWizard();
 */

export async function openCharGenWizard(opts = {}) {
  let actorUuid = opts.actorUuid ?? null;

  if (!actorUuid) {
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length === 1) {
      actorUuid = controlled[0]?.actor?.uuid ?? null;
    } else if (controlled.length > 1) {
      ui.notifications?.warn?.("Character Generation Wizard: select exactly one token, or none.");
      return;
    }
  }

  if (!actorUuid) actorUuid = game.user?.character?.uuid ?? null;

  const { CharGenWizardAppV2 } = await import("../ui/apps/v2/char-gen/char-gen-wizard.js");

  const existing = Object.values(ui.windows ?? {}).find(
    (w) => w instanceof CharGenWizardAppV2
  );
  if (existing) {
    if (typeof existing.maximize === "function") await existing.maximize();
    existing.bringToTop();
    return;
  }

  const app = new CharGenWizardAppV2({
    actorUuid,
    name: opts.name ?? "",
  });
  await app.render(true);
}

export async function runRawChargenFlow(actorOrOpts = {}) {
  let actor = actorOrOpts;
  if (actorOrOpts && actorOrOpts.actorUuid) {
    actor = await fromUuid(actorOrOpts.actorUuid);
  } else if (!actorOrOpts?.documentName) {
    const controlled = canvas?.tokens?.controlled ?? [];
    actor = controlled.length === 1 ? controlled[0]?.actor : null;
    if (!actor) actor = game.user?.character ?? null;
  }

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
