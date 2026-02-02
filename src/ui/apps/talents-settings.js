const NAMESPACE = "uesrpg-3ev4";

export class TalentsSettingsApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "uesrpg-talents-settings",
      title: "UESRPG — Talents",
      template: "systems/uesrpg-3ev4/templates/apps/talents-settings.hbs",
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
      enableMightyCleave: game.settings.get(NAMESPACE, "enableMightyCleave"),
      enableFollowUpStrike: game.settings.get(NAMESPACE, "enableFollowUpStrike"),
      gladiatorAutomationMode: game.settings.get(NAMESPACE, "gladiatorAutomationMode"),
    };
  }

  /** @override */
  async _updateObject(_event, formData) {
    const toBool = (v) => Boolean(v);
    const toGladiatorMode = (v) => {
      const key = String(v ?? "").toLowerCase();
      if (key === "disabled" || key === "original" || key === "updated") return key;
      if (v === false) return "disabled";
      if (v === true) return "original";
      return "original";
    };

    if ("enableMightyCleave" in formData) await game.settings.set(NAMESPACE, "enableMightyCleave", toBool(formData.enableMightyCleave));
    if ("enableFollowUpStrike" in formData) await game.settings.set(NAMESPACE, "enableFollowUpStrike", toBool(formData.enableFollowUpStrike));
    if ("gladiatorAutomationMode" in formData) await game.settings.set(NAMESPACE, "gladiatorAutomationMode", toGladiatorMode(formData.gladiatorAutomationMode));
  }
}

export function registerTalentsSettingsMenu() {
  if (game.settings?.menus?.get(`${NAMESPACE}.talentsSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "talentsSettings", {
    name: "Talents",
    label: "Configure Talents",
    hint: "Talent automation toggles.",
    icon: "fas fa-user-ninja",
    restricted: true,
    type: TalentsSettingsApp,
  });
}
