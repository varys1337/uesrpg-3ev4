import { SYSTEM_ID, templatePath } from "../../constants.js";
/**
 * src/ui/apps/v2/interface-settings.js
 *
 * ApplicationV2 interface settings panel.
 */

import { getSettingPresentation, t } from "../../../utils/i18n.js";
import { _bool, _strTrim } from "../../../utils/coerce.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = SYSTEM_ID;

const INTERFACE_SETTING_KEYS = Object.freeze([
  "changeUiFont",
  "sheetDensity",
  "hideChatFormattingToolbar",
  "encumbranceUiEnhanced",
  "dialogKeyboardEnhancements",
  "enableItemRowQuickMenu",
  "showSheetSearchBars",
  "noStartUpDialog",
  "enableLoadouts",
  "alchemy.enableGatheringHelper",
  "customCursor",
  "enableInlineRulesTooltips",
  "enableCustomJournalStyling",
]);

/** One allowlist and scope policy for both display and submitted settings. */
function getEditableInterfaceSettings() {
  return INTERFACE_SETTING_KEYS.flatMap((key) => {
    const registration = game.settings.settings.get(`${NAMESPACE}.${key}`);
    const personal = registration?.scope === "client" || registration?.scope === "user";
    const shared = registration?.scope === "world" && game.user?.isGM;
    return personal || shared ? [{ key, registration }] : [];
  });
}

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
      resizable: true,
      title: "UESRPG - Interface",
    },
    position: {
      width: 520,
    },
    classes: ["standard-form", "uesrpg-settings-app"],
  };

  static PARTS = {
    form: {
      template: templatePath("v2/apps/interface-settings.hbs"),
      scrollable: [".uesrpg-settings__body"],
    },
  };

  get title() {
    return t("UESRPG.Apps.Menus.interfaceSettings.Name", "Interface");
  }

  async _prepareContext(options) {
    return {
      settings: Object.fromEntries(getEditableInterfaceSettings().map(({ key }) => [
        key, getSettingPresentation(NAMESPACE, key),
      ])),
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object ?? {};
    // Re-check scope at submission; hidden or forged world fields are not trusted.
    for (const { key, registration } of getEditableInterfaceSettings()) {
      if (!Object.hasOwn(data, key)) continue;
      let value;
      if (registration.type === Boolean) value = _bool(data[key]);
      else if (registration.type === String) value = _strTrim(data[key]);
      else continue;
      if (registration.choices && !Object.hasOwn(registration.choices, value)) continue;
      if (value !== game.settings.get(NAMESPACE, key)) await game.settings.set(NAMESPACE, key, value);
    }
  }
}
