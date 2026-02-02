const NAMESPACE = "uesrpg-3ev4";

export class CombatSettingsApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "uesrpg-combat-settings",
      title: "UESRPG — Combat",
      template: "systems/uesrpg-3ev4/templates/apps/combat-settings.hbs",
      width: 520,
      height: "auto",
      closeOnSubmit: true,
      submitOnChange: false,
    });
  }

  /** @override */
  getData(options) {
    return {
      ...super.getData(options),
      enableActionEconomyUI: game.settings.get(NAMESPACE, "enableActionEconomyUI"),
    };
  }

  /** @override */
  async _updateObject(_event, formData) {
    const toBool = (v) => Boolean(v);
    if ("enableActionEconomyUI" in formData) await game.settings.set(NAMESPACE, "enableActionEconomyUI", toBool(formData.enableActionEconomyUI));
  }
}

export function registerCombatSettingsMenu() {
  if (game.settings?.menus?.get(`${NAMESPACE}.combatSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "combatSettings", {
    name: "Combat",
    label: "Configure Combat",
    hint: "Combat UI settings.",
    icon: "fas fa-swords",
    restricted: true,
    type: CombatSettingsApp,
  });
}

