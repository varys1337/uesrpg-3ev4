import { SYSTEM_ID, templatePath } from "../../constants.js";
import { getSettingPresentation, t } from "../../../utils/i18n.js";
import { collectSupportReport } from "../../../utils/dev/collect-support-report.js";
/**
 * src/ui/apps/v2/debug-settings.js
 *
 * ApplicationV2 debug settings panel.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = SYSTEM_ID;

function _isGM() {
  return Boolean(game.user?.isGM);
}

function _settingExists(key) {
  try {
    return game.settings?.settings?.has?.(`${NAMESPACE}.${key}`) === true;
  } catch (_e) {
    return false;
  }
}

export class DebugSettingsAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-debug-settings",
    actions: { exportSupportReport: DebugSettingsAppV2._onExportSupportReport },
    tag: "form",
    form: {
      handler: DebugSettingsAppV2._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
    window: { resizable: true },
    position: {
      width: 520,
    },
    classes: ["standard-form", "uesrpg-settings-app"],
  };

  static PARTS = {
    form: {
      template: templatePath("v2/apps/debug-settings.hbs"),
      scrollable: [".uesrpg-settings__body"],
    },
  };

  get title() {
    return t("UESRPG.Apps.DebugSettings.Title", "Debugging");
  }

  async _prepareContext(options) {
    return {
      isGM: _isGM(),
      world: {
        debugEnabled: getSettingPresentation(NAMESPACE, "debugEnabled"),
      },
      client: {
        debugClientEnabled: getSettingPresentation(NAMESPACE, "debugClientEnabled"),
      },
    };
  }

  static _onExportSupportReport() {
    if (!_isGM()) return;
    try {
      const includeModules = new FormData(this.form).has("support.includeModules");
      const report = collectSupportReport({ includeModules });
      foundry.utils.saveDataToFile(JSON.stringify(report, null, 2), "application/json", "uesrpg-support-report.json");
      ui.notifications.info(t("UESRPG.Apps.DebugSettings.Export.Requested", "Support report download requested."));
    } catch (_error) {
      ui.notifications.error(t("UESRPG.Apps.DebugSettings.Export.Failed", "The support report could not be downloaded."));
    }
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);

    // World settings: GM only. Fan-out master value to all individual world debug lanes.
    if (_isGM()) {
      const worldEnabled = Boolean(data?.world?.debugEnabled);
      const worldKeys = [
        "debugEnabled",
        "opposedDebug", "effectsProxyDebug", "debugMagicRouting",
        "opposedDebugFormula", "opposedShowResolutionDetails", "opposedShowStatusLine",
        "skillRollDebug", "spellCastingDebug", "activationDebug",
        "woundsDebug", "spellTickDebug", "overTimeDebug",
        "ruleElementDebug", "showFeatureInspector", "shieldDebug",
      ];
      for (const key of worldKeys) {
        if (!_settingExists(key)) continue;
        await game.settings.set(NAMESPACE, key, worldEnabled);
      }
    }

    // Client settings: fan-out master value to all individual client debug lanes.
    const clientEnabled = Boolean(data?.client?.debugClientEnabled);
    await game.settings.set(NAMESPACE, "debugClientEnabled", clientEnabled);
    const clientKeys = [
      "aeLifecycleDebug", "perfDebug", "debugSkillTN",
      "debugAim", "debugActorSelect", "sheetDiagnostics", "sheetPerfTrace",
      "dndDebugEnabled", "dndDebugVerbose", "dndDebugNotifyOnFailure",
      "dndDebugDomEvents", "dndDebugCacheFallbackEnabled", "containerDebug",
    ];
    for (const key of clientKeys) {
      if (!_settingExists(key)) continue;
      await game.settings.set(NAMESPACE, key, clientEnabled);
    }
  }
}
