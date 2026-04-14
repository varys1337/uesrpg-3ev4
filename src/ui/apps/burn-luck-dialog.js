import { templatePath } from "../constants.js";
import { customDialog, confirmDialog, renderDialogContent } from "../../utils/dialog-v2-helper.js";
import {
  burnLuckManually,
  canOpenBurnLuckFromSheet,
  getBurnLuckTotals,
  getManualBurnLuckOptions,
} from "../../core/luck/luck-workflow.js";
import { t, tf } from "../../utils/i18n.js";

async function _buildDialogContent(actor) {
  const { currentLuck, totalLuck } = getBurnLuckTotals(actor);
  const options = getManualBurnLuckOptions(actor);

  return renderDialogContent(templatePath("v2/dialogs/burn-luck-dialog.hbs"), {
    actorName: actor?.name ?? t("UESRPG.UI.Actor"),
    currentLuck,
    totalLuck,
    options,
  });
}

async function _confirmBurn(actor, option) {
  const currentLuck = Number(actor?.system?.characteristics?.lck?.base ?? actor?.system?.characteristics?.lck?.value ?? 0) || 0;
  const nextLuck = Math.max(0, currentLuck - option.cost);

  return confirmDialog({
    title: option.confirmTitle ?? option.title,
    content: `<div class="uesrpg">
      <p>${tf("UESRPG.Dialogs.BurnLuck.ConfirmActorCost", { actor: actor?.name ?? t("UESRPG.UI.Actor"), cost: option.cost })}</p>
      <p>${option.confirmText ?? option.effectText}</p>
      <p>${tf("UESRPG.Dialogs.BurnLuck.CurrentRemainingLuck", { current: currentLuck, remaining: nextLuck })}</p>
    </div>`,
    yesLabel: option.confirmLabel ?? option.title,
    noLabel: t("UESRPG.UI.Cancel"),
    yesIcon: "fas fa-fire",
    rejectClose: false,
  });
}

export class BurnLuckDialog {
  static async show(actor) {
    if (!canOpenBurnLuckFromSheet(actor, { notify: true })) return false;

    const content = await _buildDialogContent(actor);
    let completed = false;
    const result = await customDialog({
      title: tf("UESRPG.Dialogs.BurnLuck.Title", { actor: actor?.name ?? t("UESRPG.UI.Actor") }),
      content,
      classes: ["uesrpg-resource-dialog", "uesrpg-resource-dialog--burn-luck"],
      width: 600,
      buttons: {
        cancel: {
          label: t("UESRPG.UI.Cancel"),
          icon: "fas fa-times",
          callback: () => false,
        },
      },
      defaultButton: "cancel",
      render: async (_event, dialogRef) => {
        const root = dialogRef instanceof HTMLElement ? dialogRef : dialogRef?.element ?? dialogRef;
        if (!(root instanceof HTMLElement)) return;
        if (root.dataset.uesrpgBurnLuckBound === "1") return;
        root.dataset.uesrpgBurnLuckBound = "1";

        const optionButtons = Array.from(root.querySelectorAll(".uesrpg-burn-luck__option"));
        for (const button of optionButtons) {
          if (!(button instanceof HTMLButtonElement)) continue;
          button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled) return;

            const optionId = String(button.dataset.optionId ?? "").trim();
            const option = getManualBurnLuckOptions(actor).find((entry) => entry.id === optionId);
            if (!option?.available) return;

            const confirmed = await _confirmBurn(actor, option);
            if (!confirmed) return;

            button.disabled = true;
            const success = await burnLuckManually(actor, option.id);
            if (success) {
              completed = true;
              await dialogRef?.close?.();
              return;
            }
            button.disabled = false;
          });
        }
      },
    });

    return completed || Boolean(result);
  }
}
