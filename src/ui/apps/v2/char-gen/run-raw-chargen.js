import { RaceMenuAppV2, BirthSignMenuAppV2 } from "../character-creation-menus.js";
import { SpendXpMenuAppV2 } from "./spend-xp-menu.js";
import { SpellLearningMenuAppV2 } from "./spell-learning-menu.js";
import { onSetBaseCharacteristics, onLuckyMenu } from "../../../sheets/shared/listeners/characteristics-handlers.js";
import { onStartingResourcesMenu } from "../../../sheets/shared/dialogs/character-menus.js";

function _eventStub() {
  return { preventDefault() {} };
}

export async function runRawChargen(actor) {
  if (!actor || actor.documentName !== "Actor") {
    ui.notifications?.warn?.("Select a valid actor first.");
    return false;
  }

  const raceOk = await RaceMenuAppV2.prompt(actor);
  if (!raceOk) return false;

  await onSetBaseCharacteristics.call({ actor }, _eventStub(), null);

  const signOk = await BirthSignMenuAppV2.prompt(actor);
  if (!signOk) return false;

  await onStartingResourcesMenu.call({ actor }, _eventStub(), null);
  await SpellLearningMenuAppV2.prompt(actor);
  await SpendXpMenuAppV2.prompt(actor);
  await onLuckyMenu.call({ actor }, _eventStub(), null);
  return true;
}
