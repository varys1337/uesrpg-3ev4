import { activateOpenApplication } from "../ui/apps/v2/application-focus.js";

export async function resolveMacroActor({
  actorUuid = null,
  multipleSelectionWarning = "Please select exactly one token.",
  noActorWarning = "No actor found. Control a token or assign a character to your user account.",
  fallbackToUserCharacter = true,
} = {}) {
  let actor = null;

  if (actorUuid) {
    actor = await fromUuid(String(actorUuid));
  }

  if (!actor) {
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length === 1) {
      actor = controlled[0]?.actor ?? null;
    } else if (controlled.length > 1) {
      ui.notifications?.warn?.(multipleSelectionWarning);
      return null;
    }
  }

  if (!actor && fallbackToUserCharacter) {
    actor = game.user?.character ?? null;
  }

  if (!actor) {
    ui.notifications?.warn?.(noActorWarning);
    return null;
  }

  return actor;
}

export async function resolveMacroActorInput(actorOrOpts = {}) {
  if (actorOrOpts?.documentName === "Actor") return actorOrOpts;
  if (actorOrOpts && actorOrOpts.actorUuid) {
    return fromUuid(String(actorOrOpts.actorUuid));
  }

  const controlled = canvas?.tokens?.controlled ?? [];
  if (controlled.length === 1) return controlled[0]?.actor ?? null;
  return game.user?.character ?? null;
}

export function findOpenAppInstance(AppCtor, predicate = null) {
  if (typeof AppCtor !== "function") return null;
  const matcher = typeof predicate === "function" ? predicate : () => true;
  if (typeof AppCtor.findOpenInstance === "function") {
    return AppCtor.findOpenInstance(matcher) ?? null;
  }
  if (typeof AppCtor.getOpenInstance === "function") {
    const app = AppCtor.getOpenInstance();
    return app && matcher(app) ? app : null;
  }
  return null;
}

export async function focusOpenApp(app, { maximize = true } = {}) {
  if (!app) return app;
  if (maximize) {
    return activateOpenApplication(app);
  }
  app.bringToFront?.();
  return app;
}
