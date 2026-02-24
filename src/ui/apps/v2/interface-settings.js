/**
 * src/ui/apps/v2/interface-settings.js
 *
 * ApplicationV2 interface settings panel.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = "uesrpg-3ev4";

export class InterfaceSettingsAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-interface-settings",
    tag: "form",
    form: {
      handler: InterfaceSettingsAppV2._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
    window: {
      title: "UESRPG — Interface",
    },
    position: {
      width: 520,
    },
    classes: ["uesrpg"],
  };

  static PARTS = {
    form: {
      template: "systems/uesrpg-3ev4/templates/v2/apps/interface-settings.hbs",
    },
  };

  async _prepareContext(options) {
    const fontSetting = game.settings?.settings?.get?.(`${NAMESPACE}.changeUiFont`) ?? null;
    const fontChoices = fontSetting?.choices ?? {
      Cyrodiil: "Cyrodiil - Default",
      "Magic-Cyr": "Magic-Cyr",
    };

    return {
      changeUiFont: game.settings.get(NAMESPACE, "changeUiFont"),
      fontChoices,
      noStartUpDialog: game.settings.get(NAMESPACE, "noStartUpDialog"),
      sortAlpha: game.settings.get(NAMESPACE, "sortAlpha"),
      enableLoadouts: game.settings.get(NAMESPACE, "enableLoadouts"),
      customCursor: game.settings.get(NAMESPACE, "customCursor"),
      autoResizeSheets: game.settings.get(NAMESPACE, "autoResizeSheets"),
      enableRuleElementsRuntime: game.settings.get(NAMESPACE, "enableRuleElementsRuntime"),
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object;
    const toBool = (v) => Boolean(v);
    const toString = (v) => String(v ?? "").trim();

    if ("changeUiFont" in data) await game.settings.set(NAMESPACE, "changeUiFont", toString(data.changeUiFont));
    if ("noStartUpDialog" in data) await game.settings.set(NAMESPACE, "noStartUpDialog", toBool(data.noStartUpDialog));
    if ("sortAlpha" in data) await game.settings.set(NAMESPACE, "sortAlpha", toBool(data.sortAlpha));
    if ("enableLoadouts" in data) await game.settings.set(NAMESPACE, "enableLoadouts", toBool(data.enableLoadouts));
    if ("customCursor" in data) await game.settings.set(NAMESPACE, "customCursor", toBool(data.customCursor));
    if ("autoResizeSheets" in data) await game.settings.set(NAMESPACE, "autoResizeSheets", toBool(data.autoResizeSheets));
    if ("enableRuleElementsRuntime" in data) await game.settings.set(NAMESPACE, "enableRuleElementsRuntime", toBool(data.enableRuleElementsRuntime));
  }
}
