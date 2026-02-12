/**
 * src/utils/dev/debug-settings.js
 *
 * Foundry v13 (non-ApplicationV2) debug settings submenu.
 *
 * Rationale:
 *  - Keep System Settings uncluttered for normal play.
 *  - Centralize diagnostics toggles used during development/testing.
 */

const NAMESPACE = "uesrpg-3ev4";

/**
 * @returns {boolean}
 */
function _isGM() {
  return Boolean(game.user?.isGM);
}

export class DebugSettingsApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "uesrpg-debug-settings",
      title: "UESRPG — Debugging",
      template: "systems/uesrpg-3ev4/templates/dev/debug-settings.hbs",
      width: 520,
      height: "auto",
      closeOnSubmit: true,
      submitOnChange: false,
    });
  }

  /** @override */
  getData(options) {
    const world = {
      debugEnabled: game.settings.get(NAMESPACE, "debugEnabled"),
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

  /** @override */
  async _updateObject(_event, formData) {
    // FormApplication gives us flattened keys.
    // We keep the mapping explicit for safety.
    const setIfPresent = async (scope, key) => {
      const full = `${scope}.${key}`;
      if (!(full in formData)) return;
      const value = Boolean(formData[full]);
      await game.settings.set(NAMESPACE, key, value);
    };

    // World settings: GM only.
    if (_isGM()) {
      await setIfPresent("world", "debugEnabled");
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

export function registerDebugSettingsMenu() {
  // Register once.
  if (game.settings?.menus?.get(`${NAMESPACE}.debugSettings`)) return;

  game.settings.registerMenu(NAMESPACE, "debugSettings", {
    name: "Debugging",
    label: "Configure Debugging",
    hint: "Diagnostics and development-only toggles for UESRPG.",
    icon: "fas fa-bug",
    restricted: true,
    type: DebugSettingsApp,
  });
}
