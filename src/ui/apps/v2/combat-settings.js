import { SYSTEM_ID, templatePath } from "../../constants.js";
/**
 * src/ui/apps/v2/combat-settings.js
 *
 * ApplicationV2 combat settings panel.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = SYSTEM_ID;

export class CombatSettingsAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-combat-settings",
    tag: "form",
    form: {
      handler: CombatSettingsAppV2._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
    window: {
      title: "UESRPG - Combat",
    },
    position: {
      width: 520,
    },
    classes: ["uesrpg"],
  };

  static PARTS = {
    form: {
      template: templatePath("v2/apps/combat-settings.hbs"),
    },
  };

  async _prepareContext(options) {
    return {
      enableActionEconomyUI: game.settings.get(NAMESPACE, "enableActionEconomyUI"),
      actionPointAutomation: game.settings.get(NAMESPACE, "actionPointAutomation"),
      tokenRangeMeasurement: game.settings.get(NAMESPACE, "tokenRangeMeasurement"),
      aoeContainmentMode: game.settings.get(NAMESPACE, "aoeContainmentMode"),
      aoeOriginMeasurement: game.settings.get(NAMESPACE, "aoeOriginMeasurement"),
      dynamicInitiativeEnabled: game.settings.get(NAMESPACE, "dynamicInitiativeEnabled"),
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object;
    const toBool = (v) => Boolean(v);
    if ("enableActionEconomyUI" in data) await game.settings.set(NAMESPACE, "enableActionEconomyUI", toBool(data.enableActionEconomyUI));
    if ("actionPointAutomation" in data) await game.settings.set(NAMESPACE, "actionPointAutomation", data.actionPointAutomation);
    if ("tokenRangeMeasurement" in data) await game.settings.set(NAMESPACE, "tokenRangeMeasurement", data.tokenRangeMeasurement);
    if ("aoeContainmentMode" in data) await game.settings.set(NAMESPACE, "aoeContainmentMode", data.aoeContainmentMode);
    if ("aoeOriginMeasurement" in data) await game.settings.set(NAMESPACE, "aoeOriginMeasurement", data.aoeOriginMeasurement);
    if ("dynamicInitiativeEnabled" in data) await game.settings.set(NAMESPACE, "dynamicInitiativeEnabled", toBool(data.dynamicInitiativeEnabled));
  }
}

