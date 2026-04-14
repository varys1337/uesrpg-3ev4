import { systemRootPath } from "../../core/constants.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { capitalizeFirstLetter } from "../../utils/stringHelpers.js";
import { t } from "../../utils/i18n.js";

const getUserChoice = async (choices, penalty, defaultChoice) => {
  const choiceTemplatePath = `${systemRootPath}/templates/partials/dialogs/choose-birthsign-penalty.hbs`;
  const content = await foundry.applications.handlebars.renderTemplate(choiceTemplatePath, {
    choices,
    penalty,
    chosen: defaultChoice,
    groupName: "penaltyChoices"
  });

  return customDialog({
    title: t("UESRPG.Dialogs.CharGen.ChooseBirthsignPenaltyTitle"),
    content,
    buttons: {
      cancel: { label: t("UESRPG.UI.Cancel"), callback: () => null },
      submit: {
        label: t("UESRPG.UI.Submit"),
        callback: (html) => html.querySelector('input[type="radio"]:checked')?.value ?? null,
      },
    },
    defaultButton: "submit",
  });
};

export default async function chooseBirthsignPenalty(attributes, penalty) {
  const choices = {};
  for (const attribute of attributes) {
    choices[attribute] = capitalizeFirstLetter(attribute);
  }
  return getUserChoice(choices, penalty, attributes[0]);
}
