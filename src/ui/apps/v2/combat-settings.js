import { SYSTEM_ID, templatePath } from "../../constants.js";
/**
 * src/ui/apps/v2/combat-settings.js
 *
 * ApplicationV2 combat settings panel.
 */

import { getSettingPresentation, t } from "../../../utils/i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = SYSTEM_ID;
const COMBAT_SETTINGS_KEYS = Object.freeze([
  "enableActionEconomyUI",
  "actionPointAutomation",
  "tokenRangeMeasurement",
  "aoeContainmentMode",
  "aoeOriginMeasurement",
  "dynamicInitiativeEnabled",
]);

function _getRegisteredSettingPresentation(namespace, key) {
  if (!game.settings?.settings?.has?.(`${namespace}.${key}`)) return null;
  return getSettingPresentation(namespace, key);
}

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

  get title() {
    return t("UESRPG.Apps.Menus.combatSettings.Name", "Combat");
  }

  async _prepareContext(options) {
    const settings = {};
    for (const key of COMBAT_SETTINGS_KEYS) {
      const presentation = _getRegisteredSettingPresentation(NAMESPACE, key);
      if (presentation) settings[key] = presentation;
    }
    return {
      settings,
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
