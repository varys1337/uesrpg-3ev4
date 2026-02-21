/**
 * src/ui/apps/v2/talents-settings.js
 *
 * ApplicationV2 talents settings panel.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = "uesrpg-3ev4";

export class TalentsSettingsAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-talents-settings",
    tag: "form",
    form: {
      handler: TalentsSettingsAppV2._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
    window: {
      title: "UESRPG — Talents",
    },
    position: {
      width: 520,
    },
    classes: ["uesrpg"],
  };

  static PARTS = {
    form: {
      template: "systems/uesrpg-3ev4/templates/v2/apps/talents-settings.hbs",
    },
  };

  async _prepareContext(options) {
    return {
      enableMightyCleave: game.settings.get(NAMESPACE, "enableMightyCleave"),
      enableFollowUpStrike: game.settings.get(NAMESPACE, "enableFollowUpStrike"),
      gladiatorAutomationMode: game.settings.get(NAMESPACE, "gladiatorAutomationMode"),
      talentLearningMode: game.settings.get(NAMESPACE, "talentLearningMode"),
      talentNoGoverningCostRule: game.settings.get(NAMESPACE, "talentNoGoverningCostRule"),
      talentLearningNoticeMode: game.settings.get(NAMESPACE, "talentLearningNoticeMode"),
      chapter4AuditStartupMode: game.settings.get(NAMESPACE, "chapter4AuditStartupMode"),
      enforceCharGenMilestones: game.settings.get(NAMESPACE, "enforceCharGenMilestones"),
      passiveTransferItemTypes: game.settings.get(NAMESPACE, "passiveTransferItemTypes"),
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = formData.object;
    const toBool = (v) => Boolean(v);
    const toGladiatorMode = (v) => {
      const key = String(v ?? "").toLowerCase();
      if (key === "disabled" || key === "original" || key === "updated") return key;
      if (v === false) return "disabled";
      if (v === true) return "original";
      return "original";
    };

    if ("enableMightyCleave" in data) await game.settings.set(NAMESPACE, "enableMightyCleave", toBool(data.enableMightyCleave));
    if ("enableFollowUpStrike" in data) await game.settings.set(NAMESPACE, "enableFollowUpStrike", toBool(data.enableFollowUpStrike));
    if ("gladiatorAutomationMode" in data) await game.settings.set(NAMESPACE, "gladiatorAutomationMode", toGladiatorMode(data.gladiatorAutomationMode));
    if ("talentLearningMode" in data) await game.settings.set(NAMESPACE, "talentLearningMode", String(data.talentLearningMode ?? "warn"));
    if ("talentNoGoverningCostRule" in data) await game.settings.set(NAMESPACE, "talentNoGoverningCostRule", String(data.talentNoGoverningCostRule ?? "discounted"));
    if ("talentLearningNoticeMode" in data) await game.settings.set(NAMESPACE, "talentLearningNoticeMode", String(data.talentLearningNoticeMode ?? "problems"));
    if ("chapter4AuditStartupMode" in data) await game.settings.set(NAMESPACE, "chapter4AuditStartupMode", String(data.chapter4AuditStartupMode ?? "off"));
    if ("enforceCharGenMilestones" in data) await game.settings.set(NAMESPACE, "enforceCharGenMilestones", toBool(data.enforceCharGenMilestones));
    if ("passiveTransferItemTypes" in data) await game.settings.set(NAMESPACE, "passiveTransferItemTypes", String(data.passiveTransferItemTypes ?? "talent,trait,power,skill").trim());
  }
}
