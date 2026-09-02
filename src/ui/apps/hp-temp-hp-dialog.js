/**
 * src/ui/apps/hp-temp-hp-dialog.js
 *
 * Dialog for managing HP and Temporary HP for actors.
 * Temporary HP acts as a damage buffer and does not stack.
 */

import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { templatePath } from "../constants.js";
import { customDialog, renderDialogContent } from "../../utils/dialog-v2-helper.js";
import { clampNumber, toFiniteNumber } from "./resource-dialog-utils.js";
import { t, tf } from "../../utils/i18n.js";

async function _buildDialogContent(actor) {
  const currentHP = toFiniteNumber(actor?.system?.hp?.value, 0);
  const maxHP = toFiniteNumber(actor?.system?.hp?.max, 0);
  const currentTempHP = toFiniteNumber(actor?.system?.tempHP, 0);
  const woundState = game?.uesrpg?.wounds?.getWoundState?.(actor)
    ?? (actor?.system?.wounded ? "active" : "none");
  const isWounded = woundState !== "none";

  return renderDialogContent(templatePath("v2/dialogs/hp-temp-hp-dialog.hbs"), {
    currentHP,
    maxHP,
    currentTempHP,
    isWounded,
  });
}

function _readHpFormValues(root, actor) {
  const maxHP = toFiniteNumber(actor?.system?.hp?.max, 0);
  const hpInput = root?.querySelector?.('input[name="hp"]');
  const tempInput = root?.querySelector?.('input[name="tempHP"]');
  return {
    newHP: clampNumber(hpInput?.value, 0, maxHP),
    newTempHP: clampNumber(tempInput?.value, 0),
  };
}

async function _persistHpValues(actor, root) {
  const { newHP, newTempHP } = _readHpFormValues(root, actor);
  const currentHP = toFiniteNumber(actor?.system?.hp?.value, 0);
  const currentTempHP = toFiniteNumber(actor?.system?.tempHP, 0);
  if (newHP === currentHP && newTempHP === currentTempHP) return false;

  await requestUpdateDocument(actor, {
    "system.hp.value": newHP,
    "system.tempHP": newTempHP,
  });
  return true;
}

export class HPTempHPDialog {
  static async show(actor) {
    if (!actor?.system) {
      ui.notifications.error(t("UESRPG.Notifications.InvalidActorHpManagement", "Invalid actor for HP management"));
      return false;
    }

    const content = await _buildDialogContent(actor);
    const result = await customDialog({
      layout: "workflow",
      title: tf("UESRPG.Dialogs.HpManagement.Title", { actor: actor?.name ?? t("UESRPG.UI.Actor", "Actor") }, `Manage HP - ${actor?.name ?? "Actor"}`),
      content,
      classes: ["uesrpg-resource-dialog", "uesrpg-resource-dialog--hp"],
      width: 540,
      buttons: {
        firstAid: {
          label: t("UESRPG.UI.FirstAid", "First Aid"),
          icon: "fas fa-medkit",
          callback: async (html) => {
            await _persistHpValues(actor, html);
            if (game.uesrpg?.wounds?.firstAid) {
              await game.uesrpg.wounds.firstAid(actor);
              ui.notifications.info(tf("UESRPG.Notifications.FirstAidApplied", { actor: actor.name }, `First Aid applied to ${actor.name}`));
              return true;
            }
            ui.notifications.error(t("UESRPG.Notifications.FirstAidUnavailable", "First Aid system not available"));
            return false;
          },
        },
        apply: {
          label: t("UESRPG.UI.Apply", "Apply"),
          icon: "fas fa-check",
          callback: async (html) => {
            const changed = await _persistHpValues(actor, html);
            if (changed) ui.notifications.info(tf("UESRPG.Notifications.HpUpdated", { actor: actor.name }, `HP updated for ${actor.name}`));
            return true;
          },
        },
        cancel: {
          label: t("UESRPG.UI.Cancel", "Cancel"),
          icon: "fas fa-times",
          callback: () => false,
        },
      },
      defaultButton: "apply",
      render: (_event, dialog) => {
        const root = dialog instanceof HTMLElement ? dialog : dialog?.element ?? dialog;
        const firstAidButton = root?.querySelector?.('[data-action="firstAid"]');
        if (!game?.uesrpg?.wounds?.firstAid) firstAidButton?.remove?.();
      },
    });

    return Boolean(result);
  }
}
