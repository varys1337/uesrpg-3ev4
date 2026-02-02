const NAMESPACE = "uesrpg-3ev4";

export class InterfaceSettingsApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "uesrpg-interface-settings",
      title: "UESRPG — Interface",
      template: "systems/uesrpg-3ev4/templates/apps/interface-settings.hbs",
      width: 520,
      height: "auto",
      closeOnSubmit: true,
      submitOnChange: false,
    });
  }

  /** @override */
  getData(options) {
    const fontSetting = game.settings?.settings?.get?.(`${NAMESPACE}.changeUiFont`) ?? null;
    const fontChoices = fontSetting?.choices ?? {
      Cyrodiil: "Cyrodiil - Default",
      "Magic-Cyr": "Magic-Cyr",
    };

    return {
      ...super.getData(options),
      changeUiFont: game.settings.get(NAMESPACE, "changeUiFont"),
      fontChoices,
      noStartUpDialog: game.settings.get(NAMESPACE, "noStartUpDialog"),
      sortAlpha: game.settings.get(NAMESPACE, "sortAlpha"),
      enableLoadouts: game.settings.get(NAMESPACE, "enableLoadouts"),
    };
  }

  /** @override */
  async _updateObject(_event, formData) {
    const toBool = (v) => Boolean(v);
    const toString = (v) => String(v ?? "").trim();

    if ("changeUiFont" in formData) await game.settings.set(NAMESPACE, "changeUiFont", toString(formData.changeUiFont));
    if ("noStartUpDialog" in formData) await game.settings.set(NAMESPACE, "noStartUpDialog", toBool(formData.noStartUpDialog));
    if ("sortAlpha" in formData) await game.settings.set(NAMESPACE, "sortAlpha", toBool(formData.sortAlpha));
    if ("enableLoadouts" in formData) await game.settings.set(NAMESPACE, "enableLoadouts", toBool(formData.enableLoadouts));
  }
}

export function registerInterfaceSettingsMenu() {
  if (game.settings?.menus?.get(`${NAMESPACE}.interfaceSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "interfaceSettings", {
    name: "Interface",
    label: "Configure Interface",
    hint: "Interface and sheet presentation settings.",
    icon: "fas fa-desktop",
    restricted: true,
    type: InterfaceSettingsApp,
  });
}

