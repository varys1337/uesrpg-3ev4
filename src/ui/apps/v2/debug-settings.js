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
      handler: DebugSettingsAppV2.#onSubmit,
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
    const world = {
      debugEnabled: game.settings.get(NAMESPACE, "debugEnabled"),
      showFeatureInspector: game.settings.get(NAMESPACE, "showFeatureInspector"),
      opposedDebug: game.settings.get(NAMESPACE, "opposedDebug"),
      effectsProxyDebug: game.settings.get(NAMESPACE, "effectsProxyDebug"),
      opposedDebugFormula: game.settings.get(NAMESPACE, "opposedDebugFormula"),
      opposedShowResolutionDetails: game.settings.get(NAMESPACE, "opposedShowResolutionDetails"),
      opposedShowStatusLine: game.settings.get(NAMESPACE, "opposedShowStatusLine"),
      skillRollDebug: game.settings.get(NAMESPACE, "skillRollDebug"),
      spellCastingDebug: game.settings.get(NAMESPACE, "spellCastingDebug"),
      debugMagicRouting: game.settings.get(NAMESPACE, "debugMagicRouting"),
      activationDebug: game.settings.get(NAMESPACE, "activationDebug"),
      woundsDebug: game.settings.get(NAMESPACE, "woundsDebug"),
    };

    const ruleElements = {
      enableRuleElementsRuntime: game.settings.get(NAMESPACE, "enableRuleElementsRuntime"),
      enableRuleElementsRuntimeSkill: game.settings.get(NAMESPACE, "enableRuleElementsRuntimeSkill"),
      enableRuleElementsRuntimeCharacteristic: game.settings.get(NAMESPACE, "enableRuleElementsRuntimeCharacteristic"),
      enableRuleElementsRuntimeCombat: game.settings.get(NAMESPACE, "enableRuleElementsRuntimeCombat"),
      enableRuleElementsRuntimeMagic: game.settings.get(NAMESPACE, "enableRuleElementsRuntimeMagic"),
      ruleElementDebug: game.settings.get(NAMESPACE, "ruleElementDebug"),
    };

    const client = {
      aeLifecycleDebug: game.settings.get(NAMESPACE, "aeLifecycleDebug"),
      debugSkillTN: game.settings.get(NAMESPACE, "debugSkillTN"),
      sheetDiagnostics: game.settings.get(NAMESPACE, "sheetDiagnostics"),
      debugAim: game.settings.get(NAMESPACE, "debugAim"),
      debugActorSelect: game.settings.get(NAMESPACE, "debugActorSelect"),
    };

    return {
      isGM: _isGM(),
      world,
      ruleElements,
      client,
    };
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);

    const setIfPresent = async (scope, key) => {
      const value = data?.[scope]?.[key];
      if (value === undefined) return;
      await game.settings.set(NAMESPACE, key, Boolean(value));
    };

    // World settings: GM only.
    if (_isGM()) {
      await setIfPresent("world", "debugEnabled");
      await setIfPresent("world", "showFeatureInspector");
      await setIfPresent("world", "opposedDebug");
      await setIfPresent("world", "effectsProxyDebug");
      await setIfPresent("world", "opposedDebugFormula");
      await setIfPresent("world", "opposedShowResolutionDetails");
      await setIfPresent("world", "opposedShowStatusLine");
      await setIfPresent("world", "skillRollDebug");
      await setIfPresent("world", "spellCastingDebug");
      await setIfPresent("world", "debugMagicRouting");
      await setIfPresent("world", "activationDebug");
      await setIfPresent("world", "woundsDebug");

      // Rule Elements Runtime toggles.
      await setIfPresent("ruleElements", "enableRuleElementsRuntime");
      await setIfPresent("ruleElements", "enableRuleElementsRuntimeSkill");
      await setIfPresent("ruleElements", "enableRuleElementsRuntimeCharacteristic");
      await setIfPresent("ruleElements", "enableRuleElementsRuntimeCombat");
      await setIfPresent("ruleElements", "enableRuleElementsRuntimeMagic");
      await setIfPresent("ruleElements", "ruleElementDebug");
    }

    // Client settings: anyone can set their own client toggles.
    await setIfPresent("client", "aeLifecycleDebug");
    await setIfPresent("client", "debugSkillTN");
    await setIfPresent("client", "sheetDiagnostics");
    await setIfPresent("client", "debugAim");
    await setIfPresent("client", "debugActorSelect");
  }
}
