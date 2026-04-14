/**
 * Stamina spending dialog and effect creation.
 * Implements Chapter 1 stamina rules from documentation.
 */

import { canUseHeroicActions } from "../rules/npc-rules.js";
import { hasTalent } from "../traits/talents-api.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { systemRootPath } from "../constants.js";
import { STAMINA_EFFECT_KEYS, getActiveStaminaEffect, consumeStaminaEffect } from "./stamina-effects.js";
import { STAMINA_OPTIONS, getStaminaOptionById } from "./stamina-options.js";
import { spendStaminaOption } from "./stamina-spend.js";
import { t } from "../../utils/i18n.js";

export { STAMINA_EFFECT_KEYS, getActiveStaminaEffect, consumeStaminaEffect };

function buildDialogOptions(actor) {
  const allowHeroic = canUseHeroicActions(actor);
  const hasKillingBlow = hasTalent(actor, "killingblow");
  return STAMINA_OPTIONS
    .filter((option) => option.id !== "heroic-action" || allowHeroic)
    .map((option) => {
      if (option.id !== "power-attack" || !hasKillingBlow) return option;
      return {
        ...option,
        description: "+3 damage per SP spent (max +9), spend before damage roll"
      };
    });
}

function syncDialogState(root) {
  const select = root?.querySelector('select[name="stamina-action"]');
  const amountDiv = root?.querySelector(".uesrpg-stamina-power-attack");
  const help = root?.querySelector(".uesrpg-stamina-action-help");

  const sync = () => {
    const isPowerAttack = select?.value === "power-attack";
    amountDiv?.classList.toggle("is-hidden", !isPowerAttack);
    const option = select?.selectedOptions?.[0];
    const description = String(option?.dataset?.description ?? "").trim();
    if (help) help.textContent = description || t("UESRPG.Dialogs.Stamina.ActionHelp");
  };

  select?.addEventListener("change", sync);
  sync();
}

export async function openStaminaDialog(actor) {
  if (!actor) {
    ui.notifications.warn(t("UESRPG.Notifications.Stamina.NoActor"));
    return;
  }

  const currentSP = actor.system?.stamina?.value ?? 0;
  const tempSP = actor.system?.stamina?.temp ?? 0;
  const maxSP = actor.system?.stamina?.max ?? 0;
  const effectiveSP = currentSP + tempSP;
  const options = buildDialogOptions(actor);

  const content = await foundry.applications.handlebars.renderTemplate(`${systemRootPath}/templates/v2/dialogs/stamina-dialog.hbs`, {
    currentSP,
    tempSP,
    maxSP,
    effectiveSP,
    showWarning: effectiveSP <= 0,
    options: options.map((option) => ({
      id: option.id,
      name: option.name,
      cost: option.cost,
      description: option.description
    }))
  });

  await customDialog({
    title: t("UESRPG.Dialogs.Stamina.Title"),
    content,
    classes: ["uesrpg-resource-dialog", "uesrpg-resource-dialog--stamina"],
    buttons: {
      spend: {
        label: t("UESRPG.Dialogs.Stamina.Spend"),
        callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const selectedId = root?.querySelector('select[name="stamina-action"]')?.value;
          const powerAttackSP = parseInt(root?.querySelector('input[name="power-attack-sp"]')?.value || "1", 10);

          if (!selectedId) {
            ui.notifications.warn(t("UESRPG.Notifications.Stamina.SelectAction"));
            return;
          }

          const option = getStaminaOptionById(selectedId);
          if (!option) return;

          const spAmount = option.allowAmount ? Math.max(1, Math.min(3, powerAttackSP)) : 1;
          await spendStaminaOption(actor, option, spAmount);
        }
      },
      cancel: { label: t("UESRPG.UI.Cancel") }
    },
    default: "spend",
    render: (_event, html) => {
      const root = html instanceof HTMLElement ? html : html?.element ?? html;
      syncDialogState(root);
    },
    width: 540
  });
}
