/**
 * src/ui/apps/v2/debug-settings.js
 *
 * ApplicationV2 debug settings panel.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = "uesrpg-3ev4";

function _isGM() {
  return Boolean(game.user?.isGM);
}

export class DebugSettingsAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-debug-settings",
    tag: "form",
    form: {
      handler: DebugSettingsAppV2._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
    window: {
      title: "UESRPG — Debugging",
    },
    position: {
      width: 520,
    },
    classes: ["uesrpg"],
  };

  static PARTS = {
    form: {
      template: "systems/uesrpg-3ev4/templates/v2/apps/debug-settings.hbs",
    },
  };

  async _prepareContext(options) {
    return {
      isGM: _isGM(),
      world: {
        debugEnabled: game.settings.get(NAMESPACE, "debugEnabled"),
      },
      client: {
        debugClientEnabled: game.settings.get(NAMESPACE, "debugClientEnabled"),
      },
    };
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
        "ruleElementDebug", "showFeatureInspector",
      ];
      for (const key of worldKeys) {
        await game.settings.set(NAMESPACE, key, worldEnabled);
      }
    }

    // Client settings: fan-out master value to all individual client debug lanes.
    const clientEnabled = Boolean(data?.client?.debugClientEnabled);
    await game.settings.set(NAMESPACE, "debugClientEnabled", clientEnabled);
    const clientKeys = [
      "aeLifecycleDebug", "perfDebug", "debugSkillTN",
      "debugAim", "debugActorSelect", "sheetDiagnostics", "sheetPerfTrace",
    ];
    for (const key of clientKeys) {
      await game.settings.set(NAMESPACE, key, clientEnabled);
    }
  }
}
