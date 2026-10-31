import { RaceMenuAppV2, BirthSignMenuAppV2 } from "../character-creation-menus.js";
import { SpendXpMenuAppV2 } from "./spend-xp-menu.js";
import { SpellLearningMenuAppV2 } from "./spell-learning-menu.js";
import { onSetBaseCharacteristics, onLuckyMenu } from "../../../sheets/shared/listeners/characteristics-handlers.js";
import { onStartingResourcesMenu } from "../../../sheets/shared/dialogs/character-menus.js";
import { ensureXpPurchasesReviewed } from "../../../advancement/purchase-review.js";
import { promptAndApplyAllMissingRacialGrants } from "./racial-grants.js";
import { t } from "../../../../utils/i18n.js";

function _eventStub() {
  // The shared sheet handlers use the event target to guard duplicate actions.
  return { currentTarget: new EventTarget(), preventDefault() {} };
}

function _waitForMenuClose(Menu, actor) {
  return new Promise((resolve, reject) => {
    Menu.prompt(actor, { onClose: resolve }).catch(reject);
  });
}

export async function runRawChargen(actor) {
  if (!actor || actor.documentName !== "Actor") {
    ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectOrCreateActorFirst"));
    return false;
  }

  const raceOk = await RaceMenuAppV2.prompt(actor);
  if (!raceOk) return false;

  const stats = await onSetBaseCharacteristics.call({ actor }, _eventStub(), null);
  if (!stats?.ok) return false;

  const signOk = await BirthSignMenuAppV2.prompt(actor);
  if (!signOk) return false;

  const resources = await onStartingResourcesMenu.call({ actor }, _eventStub(), null);
  if (!resources?.ok) return false;
  const grants = await promptAndApplyAllMissingRacialGrants(actor);
  if (grants.some(result => !result?.ok)) return false;
  await _waitForMenuClose(SpellLearningMenuAppV2, actor);
  if (!await ensureXpPurchasesReviewed(actor)) return false;
  await _waitForMenuClose(SpendXpMenuAppV2, actor);
  if (!await ensureXpPurchasesReviewed(actor)) return false;
  const luck = await onLuckyMenu.call({ actor }, _eventStub(), null);
  return Boolean(luck?.ok);
}
