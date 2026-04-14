import { SYSTEM_ID, templatePath } from "../../constants.js";
/**
 * src/ui/apps/v2/talents-settings.js
 *
 * ApplicationV2 talents settings panel.
 */

import { getSettingPresentation, t } from "../../../utils/i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = SYSTEM_ID;

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
      title: "UESRPG - Talents",
    },
    position: {
      width: 520,
    },
    classes: ["uesrpg"],
  };

  static PARTS = {
    form: {
      template: templatePath("v2/apps/talents-settings.hbs"),
    },
  };

  get title() {
    return t("UESRPG.Apps.Menus.talentsSettings.Name", "Talents");
  }

  async _prepareContext(options) {
    return {
      settings: {
        enableMightyCleave: getSettingPresentation(NAMESPACE, "enableMightyCleave"),
        enableFollowUpStrike: getSettingPresentation(NAMESPACE, "enableFollowUpStrike"),
        gladiatorAutomationMode: getSettingPresentation(NAMESPACE, "gladiatorAutomationMode"),
        talentLearningMode: getSettingPresentation(NAMESPACE, "talentLearningMode"),
        talentNoGoverningCostRule: getSettingPresentation(NAMESPACE, "talentNoGoverningCostRule"),
        talentLearningNoticeMode: getSettingPresentation(NAMESPACE, "talentLearningNoticeMode"),
        chapter4AuditStartupMode: getSettingPresentation(NAMESPACE, "chapter4AuditStartupMode"),
        enforceCharGenMilestones: getSettingPresentation(NAMESPACE, "enforceCharGenMilestones"),
        chargenSpellLearningLogCap: getSettingPresentation(NAMESPACE, "chargenSpellLearningLogCap"),
        passiveTransferItemTypes: getSettingPresentation(NAMESPACE, "passiveTransferItemTypes"),
      },
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
    if ("chargenSpellLearningLogCap" in data) await game.settings.set(NAMESPACE, "chargenSpellLearningLogCap", Math.max(0, Math.trunc(Number(data.chargenSpellLearningLogCap) || 0)));
    if ("passiveTransferItemTypes" in data) await game.settings.set(NAMESPACE, "passiveTransferItemTypes", String(data.passiveTransferItemTypes ?? "talent,trait,power,skill").trim());
  }
}
