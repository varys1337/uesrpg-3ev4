import { SYSTEM_ID } from "../../../core/system/namespace.js";
import { invalidateCachedSetting } from "../../../core/config/settings-cache.js";
import { localizeSettingConfig } from "../../../utils/i18n.js";

function _reg(key, config) {
  if (game.settings.settings?.has(`${SYSTEM_ID}.${key}`)) {
    console.warn(`UESRPG | Settings: duplicate key "${key}" — skipping.`);
    return;
  }
  game.settings.register(SYSTEM_ID, key, localizeSettingConfig("Combat", key, config));
}

export function registerCombatSettings() {
  // Hidden GM rules/system policy: combat automation and measurement semantics.
  _reg("actionPointAutomation", {
    name: "Action Point Automation",
    hint: "Round-Based: AP is set to max at the start of each round. Turn-Based: Ap is set to max at the start of each turn, except the first round in which all combatants start with max AP. None: No automation.",
    scope: "world",
    config: false,
    type: String,
    default: "round",
    choices: {
      round: "Round-Based",
      turn: "Turn-Based",
      none: "None",
    },
    onChange: () => invalidateCachedSetting("actionPointAutomation"),
  });

  // Combat sheet UI: optional Action Economy gating for quick actions
  _reg("enableActionEconomyUI", {
    name: "Combat Sheet: Action Economy UI",
    hint: "When enabled, Combat tab quick action buttons are disabled when the actor has 0 Action Points.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("tokenRangeMeasurement", {
    name: "Combat: Token Range Measurement Mode",
    hint: "How to measure distance between tokens. 'Center Point': Always measure center-to-center (legacy, treats all tokens as 1×1). 'Edge to Edge': Measure from nearest edges for tokens larger than 1×1 (D&D/PF2e standard).",
    scope: "world",
    config: false,
    default: "center",
    type: String,
    choices: {
      "center": "Center Point (Legacy)",
      "edge": "Edge to Edge (D&D/PF2e)"
    },
    onChange: () => invalidateCachedSetting("tokenRangeMeasurement"),
  });

  _reg("aoeContainmentMode", {
    name: "Combat: AoE Containment Mode",
    hint: "How to determine if a token is inside an Area of Effect template. 'True Radius': geometric multi-point sampling — any corner or edge midpoint inside the template counts. 'Grid-Aware': checks if the template overlaps any grid cell occupied by the token.",
    scope: "world",
    config: false,
    default: "true-radius",
    type: String,
    choices: {
      "true-radius": "True Radius (Geometric)",
      "grid-aware": "Grid-Aware (Cell Overlap)"
    }
  });

  _reg("aoeOriginMeasurement", {
    name: "Combat: AoE Range Origin",
    hint: "How to measure range from the caster to an AoE placement or spell target. 'Center': from token center. 'Nearest Edge': from the closest edge of the caster token on square/gridless scenes, with center fallback on hex grids. 'Match Token': use the Token Range Measurement setting.",
    scope: "world",
    config: false,
    default: "center",
    type: String,
    choices: {
      "center": "Center Point",
      "edge": "Nearest Edge",
      "match-token": "Match Token Range Setting"
    },
    onChange: () => invalidateCachedSetting("aoeOriginMeasurement"),
  });

  _reg("woundsMode", {
    name: "Wounds: Rules Mode",
    hint: "Standard: wound when damage exceeds WT. Alternate: wound on critical-success damage or reducing target to 0 HP.",
    scope: "world",
    config: false,
    default: "standard",
    type: String,
    choices: {
      standard: "Standard (Excess WT)",
      alternate: "Alternate (Critical / 0 HP)"
    }
  });

  _reg("dynamicInitiativeEnabled", {
    name: "Dynamic Initiative",
    hint: "When enabled, initiative is rerolled at each new round and committed atomically with the round advance so timing effects resolve against the new order.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => invalidateCachedSetting("dynamicInitiativeEnabled"),
  });

  _reg("damageAftermathBundlingEnabled", {
    name: "Damage: Aftermath Bundling",
    hint: "Custom automation profile only. When enabled, selected non-critical post-damage aftermath operations in the canonical resolved damage path are staged and committed in one ordered final pass. Rules-critical HP, wound, death, and damage hook writes remain immediate.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });
}
