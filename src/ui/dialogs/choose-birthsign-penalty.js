import { systemRootPath } from "../../core/constants.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { capitalizeFirstLetter } from "../../utils/stringHelpers.js";

const getUserChoice = async (choices, penalty, defaultChoice) => {
  const choiceTemplatePath = `${systemRootPath}/templates/partials/dialogs/choose-birthsign-penalty.hbs`;
  const content = await foundry.applications.handlebars.renderTemplate(choiceTemplatePath, {
    choices,
    penalty,
    chosen: defaultChoice,
    groupName: "penaltyChoices"
  });

  return customDialog({
    title: "Choose Birthsign Penalty",
    content,
    buttons: {
      cancel: { label: "Cancel", callback: () => null },
      submit: {
        label: "Submit",
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
