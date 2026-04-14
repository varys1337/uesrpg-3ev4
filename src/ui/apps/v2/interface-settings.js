import { SYSTEM_ID, templatePath } from "../../constants.js";
/**
 * src/ui/apps/v2/interface-settings.js
 *
 * ApplicationV2 interface settings panel.
 */

import { getSettingPresentation, t } from "../../../utils/i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = SYSTEM_ID;

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
      title: "UESRPG - Interface",
    },
    position: {
      width: 520,
    },
    classes: ["uesrpg"],
  };

  static PARTS = {
    form: {
      template: templatePath("v2/apps/interface-settings.hbs"),
    },
  };

  get title() {
    return t("UESRPG.Apps.Menus.interfaceSettings.Name", "Interface");
  }

  async _prepareContext(options) {
    return {
      settings: {
        changeUiFont: getSettingPresentation(NAMESPACE, "changeUiFont"),
        sheetDensity: getSettingPresentation(NAMESPACE, "sheetDensity"),
        encumbranceUiEnhanced: getSettingPresentation(NAMESPACE, "encumbranceUiEnhanced"),
        dialogKeyboardEnhancements: getSettingPresentation(NAMESPACE, "dialogKeyboardEnhancements"),
        enableItemRowQuickMenu: getSettingPresentation(NAMESPACE, "enableItemRowQuickMenu"),
        noStartUpDialog: getSettingPresentation(NAMESPACE, "noStartUpDialog"),
        sortAlpha: getSettingPresentation(NAMESPACE, "sortAlpha"),
        enableLoadouts: getSettingPresentation(NAMESPACE, "enableLoadouts"),
        customCursor: getSettingPresentation(NAMESPACE, "customCursor"),
        autoResizeSheets: getSettingPresentation(NAMESPACE, "autoResizeSheets"),
        enableInlineRulesTooltips: getSettingPresentation(NAMESPACE, "enableInlineRulesTooltips"),
        opposedPostSubRollMessages: getSettingPresentation(NAMESPACE, "opposedPostSubRollMessages"),
      },
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object;
    const toBool = (v) => Boolean(v);
    const toString = (v) => String(v ?? "").trim();

    if ("changeUiFont" in data) await game.settings.set(NAMESPACE, "changeUiFont", toString(data.changeUiFont));
    if ("sheetDensity" in data) await game.settings.set(NAMESPACE, "sheetDensity", toString(data.sheetDensity));
    if ("encumbranceUiEnhanced" in data) await game.settings.set(NAMESPACE, "encumbranceUiEnhanced", toBool(data.encumbranceUiEnhanced));
    if ("dialogKeyboardEnhancements" in data) await game.settings.set(NAMESPACE, "dialogKeyboardEnhancements", toBool(data.dialogKeyboardEnhancements));
    if ("enableItemRowQuickMenu" in data) await game.settings.set(NAMESPACE, "enableItemRowQuickMenu", toBool(data.enableItemRowQuickMenu));
    if ("noStartUpDialog" in data) await game.settings.set(NAMESPACE, "noStartUpDialog", toBool(data.noStartUpDialog));
    if ("sortAlpha" in data) await game.settings.set(NAMESPACE, "sortAlpha", toBool(data.sortAlpha));
    if ("enableLoadouts" in data) await game.settings.set(NAMESPACE, "enableLoadouts", toBool(data.enableLoadouts));
    if ("customCursor" in data) await game.settings.set(NAMESPACE, "customCursor", toBool(data.customCursor));
    if ("autoResizeSheets" in data) await game.settings.set(NAMESPACE, "autoResizeSheets", toBool(data.autoResizeSheets));
    if ("enableInlineRulesTooltips" in data) await game.settings.set(NAMESPACE, "enableInlineRulesTooltips", toBool(data.enableInlineRulesTooltips));
    if ("opposedPostSubRollMessages" in data) await game.settings.set(NAMESPACE, "opposedPostSubRollMessages", toBool(data.opposedPostSubRollMessages));
  }
}
