import { UESRPG } from "../core/constants.js";
import { SimpleActor } from "../core/documents/actor.js";
import { SimpleItem } from "../core/documents/item.js";
import { npcSheet } from "../ui/sheets/npc-sheet.js";
import { SimpleActorSheet } from "../ui/sheets/actor-sheet.js";
import { GroupSheet } from "../ui/sheets/group-sheet.js";
import { SimpleItemSheet } from "../ui/sheets/item-sheet.js";

import { SystemCombat } from "../core/documents/combat.js";
import { initializeChatHandlers, registerCombatChatHooks } from "../core/combat/chat-handlers.js";
import { registerSkillTNDebug } from "../utils/dev/skill-tn-debug.js";
import { registerActorSelectDebug } from "../utils/dev/actor-select-debug.js";
import { registerDebugSettingsMenu } from "../utils/dev/debug-settings.js";
import { registerReachVisualizerSettingsMenu, registerReachVisualizerSettingsStorage } from "../ui/apps/reach-visualizer-settings.js";
import { registerInterfaceSettingsMenu } from "../ui/apps/interface-settings.js";
import { registerTalentsSettingsMenu } from "../ui/apps/talents-settings.js";
import { registerCombatSettingsMenu } from "../ui/apps/combat-settings.js";
import { registerOpposedDiagnostics } from "../utils/dev/opposed-diagnostics.js";
import { registerConditions } from "../core/conditions/index.js";
import { registerWounds } from "../core/wounds/index.js";
import { registerFrenzied, FrenziedAPI } from "../core/conditions/frenzied.js";
import { applyDamage, applyHealing, DAMAGE_TYPES } from "../core/combat/damage-automation.js";
import { applyDamageResolved } from "../core/combat/damage-resolver.js";
import { registerChatMessageSocket } from "../utils/chat-message-socket.js";
import { registerAuthorityProxy } from "../utils/authority-proxy.js";
import { registerReachVisualizer } from "../ui/canvas/reach-visualizer.js";
import { registerRacialTalentsAutomation } from "../core/traits/racial-talents.js";
import { registerSpellcastingTalentHooks } from "../core/traits/spellcasting-talents.js";
import { registerActivationStateHooks } from "../core/combat/activation-state-flags.js";
import { CharOpposedWorkflow } from "../core/characteristics/opposed-workflow.js";
import { isDebugEnabled } from "../utils/debug.js";
import { evaluatePredicate, isPredicate, selfTestPredicate } from "../core/rules/predicate.js";
import { normalizeRollOption, buildBaseRollOptions } from "../core/rules/roll-options.js";
import { buildRollContext } from "../core/rules/roll-context.js";
import { compileConditionsToPredicate } from "../core/traits/features/conditions-to-predicate.js";
import { getRuleElementRuntimeSupport } from "../core/traits/features/rule-elements.js";
import { selfTestRuleElementRuntime } from "../core/traits/features/rule-element-runtime.js";

/**
 * Preload Handlebars partials used by system sheets.
 *
 * Foundry requires partial templates to be loaded before they can be referenced via {{> }}.
 */
async function preloadHandlebarsTemplates() {
  const templatePaths = [
    "systems/uesrpg-3ev4/templates/partials/sheets/fixed-header.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/feature-inspector.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/effects-tab.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/feature-config-tab.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/automation-tab.hbs",
  ];

  try {
    // Foundry v13: use the namespaced template loader.
    // Avoid touching the deprecated global loadTemplates to keep the console clean.
    const loader = foundry?.applications?.handlebars?.loadTemplates;
    if (typeof loader !== "function") {
      throw new Error("foundry.applications.handlebars.loadTemplates is not available");
    }
    await loader(templatePaths);
  } catch (err) {
    console.error("UESRPG | Failed to preload Handlebars templates", err);
  }
}

async function registerSettings() {
  // Register system settings
  function delayedReload() {
    window.setTimeout(() => location.reload(), 500);
  }
  
  game.settings.register("uesrpg-3ev4", "changeUiFont", {
    name: "System Font",
    hint: "Changes main Font",
    scope: "world",
    requiresReload: true,
    config: false,
    type: String,
    choices: {
      "Cyrodiil": "Сyrodiil - Default",
      "Magic-Cyr": "Magic-Cyr",
      "Dorovar Carolus": "Dorovar Carolus",
      "Futura Condensed Medium": "Futura Condensed Medium",
      "Kingthings Petrock": "Kingthings Petrock",
      "Morris Roman Black": "Morris Roman Black",
      "Morris Roman Black Alternate": "Morris Roman Black Alternate"
    },
    default: "Cyrodiil"
  });

  game.settings.register("uesrpg-3ev4", "noStartUpDialog", {
    name: "Do Not Show Dialog on Startup",
    hint: "Checking this box hides the startup popup dialog informing the user on additional game resources.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "actionPointAutomation", {
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
  });

  game.settings.register("uesrpg-3ev4", "aeLifecycleDebug", {
    name: "Active Effect Lifecycle Debug",
    hint: "Log all AE fetch/delete operations (for troubleshooting only). Helps diagnose 'does not exist' errors.",
    scope: "client",
    // Keep this out of the main System Settings list; expose it via the Debugging submenu.
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register("uesrpg-3ev4", "perfDebug", {
    name: "Performance Profiling",
    hint: "Log console.time/timeEnd markers for getData(), rule element evaluation, and opposed resolution.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register("uesrpg-3ev4", "spellTickDebug", {
    name: "Spell Tick Engine: Debug Logging",
    hint: "When enabled, the spell tick engine logs turn/round/worldTime tick events and handler invocations.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "overTimeDebug", {
    name: "OverTime Effects: Debug Logging",
    hint: "When enabled, the OverTime effects engine logs effect collection, cadence gating, payload execution, and state updates.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "enforceCharGenMilestones", {
    name: "Enforce Character Generation Milestones",
    hint: "When enabled, Imperial racial talent automation (Red Diamond / Imperial Luck) applies only if the actor has flags.uesrpg.charGen.completed = true.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register("uesrpg-3ev4", "passiveTransferItemTypes", {
    name: "Passive Transfer Item Types",
    hint: "Comma-separated item types whose transfer Active Effects apply passively while the item is in an actor's inventory.",
    scope: "world",
    config: false,
    type: String,
    default: "talent,trait,power,skill",
    requiresReload: true
  });

  game.settings.register("uesrpg-3ev4", "sortAlpha", {
    name: "Sort Actor Items Alphabetically",
    hint: "If checked, Actor items are automatically sorted alphabetically. Otherwise, items are not sorted and are organized manually.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
    onChange: delayedReload,
  });

  // World data version stamp for the new-world-only compatibility gate.
  game.settings.register("uesrpg-3ev4", "worldDataVersion", {
    name: "World Data Version",
    hint: "Records the system version that last initialized this world. Used by the compatibility gate.",
    scope: "world",
    config: false,
    default: "",
    type: String,
  });

  // Global master gate for all diagnostics/debug lanes.
  // If disabled, all debug logs are suppressed even if individual lanes are enabled.
  game.settings.register("uesrpg-3ev4", "debugEnabled", {
    name: "Debug Logging: Master Enable",
    hint: "Global master switch for all UESRPG debug logging. Disable to suppress all debug console output.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Opposed workflow diagnostics
  game.settings.register("uesrpg-3ev4", "opposedDebug", {
    name: "Opposed Debug Logging",
    hint: "When enabled, the opposed-roll workflow logs detailed diagnostic information to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Authority proxy diagnostics (GM/owner proxy mutations)
  game.settings.register("uesrpg-3ev4", "effectsProxyDebug", {
    name: "Effects/Proxy Debug Logging",
    hint: "When enabled, the authority proxy (ChatMessage updates + target-side ActiveEffect application) logs concise diagnostics to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });
  // Magic workflow routing diagnostics
  game.settings.register("uesrpg-3ev4", "debugMagicRouting", {
    name: "Magic: Routing Debug Logging",
    hint: "When enabled, spell routing decisions (targeted vs unopposed vs legacy) are logged to the browser console. Recommended only for testing.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "opposedDebugFormula", {
    name: "Opposed Debug: Formula Normalization",
    hint: "When enabled (testing), logs when a roll formula is normalized or rejected before evaluation.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "spellCastingDebug", {
    name: "Spell Casting: Workflow Debug Logging",
    hint: "When enabled, spell casting workflow logs comprehensive diagnostic information including spell data, dialog construction, and scaling level processing. Recommended only for debugging scaling dropdown issues.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "activationDebug", {
    name: "Activation/Talent: Debug Logging",
    hint: "When enabled, activation and talent automation workflows log detailed diagnostics to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Rule-element runtime master switch (phase-gated substrate rollout).
  game.settings.register("uesrpg-3ev4", "enableRuleElementsRuntime", {
    name: "Rule Elements Runtime (Experimental)",
    hint: "Enable runtime evaluation of Rule Elements (experimental).",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "enableRuleElementsRuntimeSkill", {
    name: "Rule Elements Runtime: Skill Opposed",
    hint: "Enable Rule Elements runtime on skill opposed workflows.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "enableRuleElementsRuntimeCharacteristic", {
    name: "Rule Elements Runtime: Characteristic Opposed",
    hint: "Enable Rule Elements runtime on characteristic opposed workflows.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "enableRuleElementsRuntimeCombat", {
    name: "Rule Elements Runtime: Combat Opposed",
    hint: "Enable Rule Elements runtime on combat opposed workflows.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "enableRuleElementsRuntimeMagic", {
    name: "Rule Elements Runtime: Magic Opposed",
    hint: "Enable Rule Elements runtime on magic opposed workflows.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Dedicated debug lane for predicate/runtime traces.
  game.settings.register("uesrpg-3ev4", "ruleElementDebug", {
    name: "Rule Elements: Debug Logging",
    hint: "When enabled, predicate and rule-element runtime diagnostics are logged to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "opposedShowResolutionDetails", {
    name: "Opposed: Show Resolution Details",
    hint: "When enabled, opposed-roll chat cards include an additional expandable section with detailed resolution data. Recommended for testing; disable for normal play.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });



  game.settings.register("uesrpg-3ev4", "opposedShowStatusLine", {
    name: "Opposed: Show Status Line",
    hint: "When enabled, opposed-roll chat cards include Status lines (Committed/Rolled/Resolved). Intended for debugging/testing.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Opposed workflow: banking choices before rolling is now core system behavior.
  // Keep the setting registered (backward compatible for any stored world value), but hide it from the UI.
  game.settings.register("uesrpg-3ev4", "opposedBankChoices", {
    name: "Opposed: Bank Choices Before Rolling",
    hint: "Bank attacker/defender choices before rolling.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });


  // Skill roll diagnostics
  game.settings.register("uesrpg-3ev4", "skillRollDebug", {
    name: "Skill Roll Debug Logging",
    hint: "When enabled, skill rolls and skill-opposed workflows log structured diagnostic information to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });


  // Skill roll UI QoL (client-scoped)
  game.settings.register("uesrpg-3ev4", "skillRollLastOptions", {
    name: "Skill Roll: Remember Last Options",
    hint: "Stores the last-used skill roll options (difficulty, manual modifier, specialization toggle, and last selected skill per actor) for this user only.",
    scope: "client",
    config: false,
    type: Object,
    default: {
      difficultyKey: "average",
      manualMod: 0,
      useSpec: false,
      lastSkillUuidByActor: {}
    }
  });

  game.settings.register("uesrpg-3ev4", "skillRollQuickShift", {
    name: "Skill Roll: Shift Quick Roll",
    hint: "When enabled, holding Shift will bypass the roll options dialog and use remembered/default options.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register("uesrpg-3ev4", "debugSkillTN", {
    name: "Debug: Skill TN Macro",
    hint: "When enabled (GM only), exposes game.uesrpg.debugSkillTN(...) for diagnosing skill TN computation.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
    onChange: delayedReload
  });

  game.settings.register("uesrpg-3ev4", "debugAim", {
  name: "Aim: Debug Audit Logging",
  hint: "When enabled, logs Aim apply/stack, break, and consume events to the browser console.",
  scope: "client",
  config: false,
  type: Boolean,
  default: false
});

  game.settings.register("uesrpg-3ev4", "debugActorSelect", {
    name: "Actor Select: Debug Logging",
    hint: "When enabled (client-only), logs TN-relevant actor context whenever you control a token (developer utility).",
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register("uesrpg-3ev4", "woundsDebug", {
    name: "Wounds: Debug Logging",
    hint: "When enabled, wound automation logs structured diagnostic information to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean
  });


  // Combat sheet UI: optional Action Economy gating for quick actions
  game.settings.register("uesrpg-3ev4", "enableActionEconomyUI", {
    name: "Combat Sheet: Action Economy UI",
    hint: "When enabled, Combat tab quick action buttons are disabled when the actor has 0 Action Points.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Items tab: per-user loadouts (equipment snapshots)
  game.settings.register("uesrpg-3ev4", "enableLoadouts", {
    name: "Sheets: Enable Equipment Loadouts",
    hint: "When enabled, the Items tab shows a per-user Loadout bar (save/apply equipped-state snapshots).",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "tokenRangeMeasurement", {
    name: "Combat: Token Range Measurement Mode",
    hint: "How to measure distance between tokens. 'Center Point': Always measure center-to-center (legacy, treats all tokens as 1×1). 'Edge to Edge': Measure from nearest edges for tokens larger than 1×1 (D&D/PF2e standard).",
    scope: "world",
    config: false,
    default: "center",
    type: String,
    choices: {
      "center": "Center Point (Legacy)",
      "edge": "Edge to Edge (D&D/PF2e)"
    }
  });

  game.settings.register("uesrpg-3ev4", "aoeContainmentMode", {
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

  game.settings.register("uesrpg-3ev4", "aoeOriginMeasurement", {
    name: "Combat: AoE Range Origin",
    hint: "How to measure range from the caster to an AoE placement or spell target. 'Center': from token center (legacy). 'Nearest Edge': from the closest edge of the caster token. 'Match Token': use the Token Range Measurement setting.",
    scope: "world",
    config: false,
    default: "center",
    type: String,
    choices: {
      "center": "Center Point",
      "edge": "Nearest Edge",
      "match-token": "Match Token Range Setting"
    }
  });

  // Talents automation: optional enforcement toggles (Chapter 4)
  game.settings.register("uesrpg-3ev4", "enableMightyCleave", {
    name: "Talents: Enable Mighty Cleave automation",
    hint: "When enabled, Mighty Cleave can create a follow-up attack button on opposed cards (requires the talent). Disabled by default to avoid changing table enforcement assumptions.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "enableFollowUpStrike", {
    name: "Talents: Enable Follow-up Strike automation",
    hint: "When enabled, Follow-up Strike can create a free follow-up attack button on opposed cards (requires the talent). Disabled by default to avoid changing table enforcement assumptions.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "gladiatorAutomationMode", {
    name: "Talents: Gladiator automation mode",
    hint: "Controls Gladiator free-defense behavior (Disabled, Original/Make, Updated/Can).",
    scope: "world",
    config: false,
    default: "original",
    type: String,
  });

  // Client-only diagnostics panel on actor sheets (used for testing)
  game.settings.register("uesrpg-3ev4", "sheetDiagnostics", {
    name: "Debug: Sheet Diagnostics Panel",
    hint: "When enabled, actor sheets show a small diagnostics panel (client only).",
    scope: "client",
    config: false,
    default: false,
    type: Boolean,
  });

  // Spell Recipes (Experimental) — hidden by default
  game.settings.register("uesrpg-3ev4", "enableSpellRecipes", {
    name: "Spell Recipes (Experimental)",
    hint: "When enabled, shows the Effect Recipes UI on spell sheets. This feature is experimental and may not fully integrate with ActiveEffect creation.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Register a dedicated Debugging menu to avoid clutter in System Settings.
  registerDebugSettingsMenu();

  // Subcategory menus to keep System Settings uncluttered.
  registerInterfaceSettingsMenu();
  registerTalentsSettingsMenu();
  registerCombatSettingsMenu();

  // Reach Visualizer submenu (client scoped)
  registerReachVisualizerSettingsStorage();
  registerReachVisualizerSettingsMenu();

}

/**
 * Register Handlebars helpers used by the system.
 */
function registerHandlebarsHelpers() {
  // Greater than or equal helper for attack counter styling
  Handlebars.registerHelper('gte', function(a, b) {
    return a >= b;
  });

  // Equality helper for template comparisons
  Handlebars.registerHelper('eq', function(a, b) {
    return a === b;
  });

  Handlebars.registerHelper('includes', function(arr, value) {
    return Array.isArray(arr) ? arr.includes(value) : false;
  });

  Handlebars.registerHelper('json', function(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch (_e) {
      return "";
    }
  });
}

async function registerSheets () {
    // Register sheet application classes
foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);

foundry.documents.collections.Actors.registerSheet("uesrpg-3ev4", SimpleActorSheet, {
  types: ["Player Character"],
  makeDefault: true,
  label: "Default UESRPG Character Sheet",
});

foundry.documents.collections.Actors.registerSheet("uesrpg-3ev4", GroupSheet, {
  types: ["Group"],
  makeDefault: true,
  label: "Default UESRPG Group Sheet",
});
foundry.documents.collections.Items.registerSheet("uesrpg-3ev4", SimpleItemSheet, {
  makeDefault: true,
  label: "Default UESRPG Item Sheet",
});
foundry.documents.collections.Actors.registerSheet("uesrpg-3ev4", npcSheet, {
  types: ["NPC"],
  makeDefault: true,
  label: "Default UESRPG NPC Sheet",
});
}

export default async function initHandler() {

  // DEFAULT_ITEM_AE_TRANSFER_POLICY_V3
  // Default newly created Item Active Effects to transfer=true ("Apply Effect to Actor"), unless explicitly set.
  // We register these hooks once per session.
  if (!game.uesrpg) game.uesrpg = {};
  if (!game.uesrpg.rules) game.uesrpg.rules = {};
  game.uesrpg.rules.predicate = {
    isPredicate,
    evaluatePredicate,
    selfTest: selfTestPredicate
  };
  game.uesrpg.rules.rollOptions = {
    normalize: normalizeRollOption,
    buildBase: buildBaseRollOptions
  };
  game.uesrpg.rules.rollContext = {
    build: buildRollContext
  };
  game.uesrpg.rules.conditions = {
    compileToPredicate: compileConditionsToPredicate
  };
  game.uesrpg.rules.ruleElements = {
    getSupportMatrix: getRuleElementRuntimeSupport,
    selfTestRuntime: selfTestRuleElementRuntime
  };

  // Opposed workflow diagnostics helpers (per-client trace ring buffer + console dump utilities)
  // Safe: no schema changes; GM-only dump functions.
  try {
    registerOpposedDiagnostics();
  } catch (err) {
    console.warn("UESRPG | Failed to register opposed diagnostics", err);
  }

  // Racial talent/power automation hooks (Chapter 4): registered once.
  try {
    registerRacialTalentsAutomation();
  } catch (err) {
    console.warn("UESRPG | Failed to register racial talent automation", err);
  }

  // Spellcasting talent hooks (Chapter 4 Spellcasting): registered once.
  try {
    registerSpellcastingTalentHooks();
  } catch (err) {
    console.warn("UESRPG | Failed to register spellcasting talent hooks", err);
  }

// COMBAT_API_EXPORTS_V1
// Provide stable access points for macros and downstream system automation without relying on dynamic imports.
// This avoids incorrect relative import roots (e.g. "/scripts/systems/...") in Foundry macro contexts.
if (!game.uesrpg.combat) game.uesrpg.combat = {};
game.uesrpg.combat.applyDamage = applyDamage;
game.uesrpg.combat.applyDamageResolved = applyDamageResolved;
game.uesrpg.combat.DAMAGE_TYPES = DAMAGE_TYPES;

// Canonical Healing wrapper (Package 5)
// Ensures all healing callers use the unified pipeline (bleeding reduction, forestall, etc.).
game.uesrpg.combat.applyHealing = async (actor, amount, options = {}) => {
  const src = options?.source ?? "Healing";
  return applyHealing(actor, amount, { ...options, source: src });
};

// Characteristic Opposed Workflow — exposed for macros/downstream consumers.
if (!game.uesrpg.characteristics) game.uesrpg.characteristics = {};
game.uesrpg.characteristics.CharOpposedWorkflow = CharOpposedWorkflow;

  if (!game.uesrpg._defaultItemAETransferHook) {
    game.uesrpg._defaultItemAETransferHook = true;

    Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
      try {
        if (game.userId !== userId) return;

        const parent = effect?.parent ?? options?.parent ?? null;
        if (!parent || parent.documentName !== "Item") return;

        // Respect explicit setting
        if (data?.transfer !== undefined) return;

        // Ensure we can mutate the pending create data
        if (foundry?.utils?.mergeObject) {
          foundry.utils.mergeObject(data, { transfer: true }, { inplace: true });
        } else {
          data.transfer = true;
        }

        // Add constant enchantment metadata flags for Item Active Effects
        // Constant enchantments are Item Active Effects with transfer=true
        const FLAG_SCOPE = "uesrpg-3ev4";
        const existingFlags = data?.flags ?? {};
        const scopeFlags = existingFlags[FLAG_SCOPE] ?? {};
        
        // Ensure standardized metadata flags are present for constant enchantments
        // effectGroup uses item UUID to ensure uniqueness per item
        const itemUuid = parent?.uuid ?? parent?.id ?? "";
        const effectName = String(data?.name ?? "").trim().toLowerCase().replace(/\s+/g, "-") || "effect";
        const effectGroup = `enchantment.${itemUuid}.${effectName}`;
        
        const enhancedFlags = {
          ...existingFlags,
          [FLAG_SCOPE]: {
            ...scopeFlags,
            constant: true, // Mark as constant enchantment
            owner: scopeFlags.owner ?? "item",
            effectGroup: scopeFlags.effectGroup ?? effectGroup,
            stackRule: scopeFlags.stackRule ?? "override", // Constant enchantments typically override
            source: scopeFlags.source ?? "enchantment",
            // Preserve cursed flag if present
            cursed: scopeFlags.cursed ?? false
          }
        };
        
        if (foundry?.utils?.mergeObject) {
          foundry.utils.mergeObject(data, { flags: enhancedFlags }, { inplace: true });
        } else {
          data.flags = enhancedFlags;
        }
      } catch (err) {
        console.error("UESRPG | Default Item AE transfer preCreate failed", err);
      }
    });

    // Fallback: if some creation path bypasses preCreate mutation, enforce immediately after create.
    // For feature types (talent/trait/power), respect the explicit transfer value so users
    // can control the passive (transfer:true) vs activation (transfer:false) distinction.
    Hooks.on("createActiveEffect", async (effect, options, userId) => {
      try {
        if (game.userId !== userId) return;
        const parent = effect?.parent;
        if (!parent || parent.documentName !== "Item") return;

        if (effect.transfer) return;

        // Feature types use transfer:false semantically to mean "activation-only effect".
        // Do NOT override it — the user intentionally left it as transfer:false.
        const itemType = String(parent.type ?? "").toLowerCase();
        if (itemType === "talent" || itemType === "trait" || itemType === "power") return;

        // Only force if it looks like a default-created effect (no explicit choice).
        await effect.update({ transfer: true });
      } catch (err) {
        console.error("UESRPG | Default Item AE transfer create fallback failed", err);
      }
    });
  }

  if (!game.uesrpg._upkeepDeleteGuardHook) {
    game.uesrpg._upkeepDeleteGuardHook = true;
    Hooks.on("preDeleteActiveEffect", (effect, options) => {
      try {
        const flags = effect?.flags?.["uesrpg-3ev4"];
        if (!flags?.spellEffect || !flags?.hasUpkeep) return;
        if (!flags?.upkeepAwaiting) return;
        if (options?.uesrpgAllowUpkeepDelete) return;

        // Only block deletions explicitly marked as automated expiration
        // sweeps that could race with the upkeep prompt.  All other
        // deletions (manual UI, upkeep-cancel, etc.) are allowed through.
        if (!options?.uesrpgExpirationSweep) return;

        return false;
      } catch (err) {
        console.error("UESRPG | Upkeep delete guard failed", err);
      }
    });
  }

  // Buffer cleanup on effect deletion
  if (!game.uesrpg._bufferCleanupHook) {
    game.uesrpg._bufferCleanupHook = true;
    Hooks.on("deleteActiveEffect", async (effect, _options, userId) => {
      try {
        // Only run on the initiating client to avoid duplicate processing
        if (game.userId !== userId) return;

        const flags = effect?.flags?.["uesrpg-3ev4"];
        if (!flags?.bufferApplied || !flags?.bufferType) return;

        const targetActor = effect.parent;
        if (!targetActor || targetActor.documentName !== "Actor") return;

        const bufferType = flags.bufferType; // "physical", "magical", or "elemental"
        const bufferPath = `system.buffers.${bufferType}`;

        // Check if there are other active effects still providing this buffer type
        const otherBufferEffects = targetActor.effects?.filter(ef => 
          ef.id !== effect.id && 
          ef.flags?.["uesrpg-3ev4"]?.bufferApplied && 
          ef.flags?.["uesrpg-3ev4"]?.bufferType === bufferType
        ) ?? [];

        // If no other effects provide this buffer type, clear it
        if (otherBufferEffects.length === 0) {
          const { requestUpdateDocument } = await import("../utils/authority-proxy.js");
          await requestUpdateDocument(targetActor, { [bufferPath]: 0 });

          const debugEnabled = game.settings.get("uesrpg-3ev4", "spellCastingDebug");
          if (debugEnabled) {
            console.log(`UESRPG | Buffer cleanup: Cleared ${bufferType} buffer on ${targetActor.name} (effect ${effect.name} deleted)`);
          }
        } else {
          // Recalculate buffer to the max of remaining effects
          const maxBuffer = Math.max(...otherBufferEffects.map(ef => 
            Number(ef.flags?.["uesrpg-3ev4"]?.bufferOriginalValue ?? 0)
          ));
          const { requestUpdateDocument } = await import("../utils/authority-proxy.js");
          await requestUpdateDocument(targetActor, { [bufferPath]: maxBuffer });

          const debugEnabled = game.settings.get("uesrpg-3ev4", "spellCastingDebug");
          if (debugEnabled) {
            console.log(`UESRPG | Buffer cleanup: Recalculated ${bufferType} buffer to ${maxBuffer} on ${targetActor.name}`);
          }
        }
      } catch (err) {
        console.error("UESRPG | Buffer cleanup failed", err);
      }
    });
  }


  // NOTE: Spell Item Active Effects use the same deterministic transfer semantics as other item types.
  // See src/core/active-effects/transfer.js for activation gating (spells require an explicit "Active" toggle).


  /**
   * Set an initiative formula for the system
   * @type {String}
   */
  CONFIG.Combat.initiative = {
    // Use the derived initiative value so Active Effects can influence initiative reliably.
    formula: "1d6 + @initiative.value",
    decimals: 0,
  };

  // Set up custom combat functionality for the system.
  CONFIG.Combat.documentClass = SystemCombat;

  // Record Configuration Values
  CONFIG.UESRPG = UESRPG;

  // Define custom Entity classes
  CONFIG.Actor.documentClass = SimpleActor;
  CONFIG.Item.documentClass = SimpleItem;
  
  // Register Handlebars helpers
  registerHandlebarsHelpers();

  // Preload sheet partials after the Handlebars application namespace is fully initialized.
  // Running this too early causes Foundry to fall back to deprecated global loaders.
  Hooks.once("setup", preloadHandlebarsTemplates);

  await registerSettings();

  await registerSheets();

  // Initialize combat automation chat handlers
  initializeChatHandlers();
  registerCombatChatHooks();
  registerActivationStateHooks();
  registerChatMessageSocket();
  registerAuthorityProxy();
  // Canvas tool: visualize melee reach for controlled tokens.
  registerReachVisualizer();

  // DERIVED_DATA_CACHE_INVALIDATION_V1
  // Ensure edits to embedded Item bonuses (Talents / Traits / Powers, but also any other embedded
  // item that contributes to derived data) immediately reflect on the Actor.
  //
  // Root cause: SimpleActor#_aggregateItemStats caches aggregated embedded-item stats on the Actor
  // instance (this._aggCache) and reuses them across prepare cycles when its lightweight signature
  // does not change. Some non-encumbrance bonus fields (e.g., system.hpBonus) were not represented
  // in that signature, causing stale derived data until a full server refresh recreated documents.
  //
  // Fix: invalidate the cache whenever an embedded Item is created, updated, or deleted.
  if (!game.uesrpg._aggCacheInvalidationHooks) {
    game.uesrpg._aggCacheInvalidationHooks = true;

    /**
     * Clear per-actor aggregation caches so derived data recomputes on the next prepare.
     * @param {Item} item
     */
    const invalidateActorAggCacheFromItem = (item) => {
      const actor = item?.parent;
      if (!actor || actor.documentName !== "Actor") return;
      if (Object.prototype.hasOwnProperty.call(actor, "_aggCache")) actor._aggCache = null;
    };

    Hooks.on("preUpdateItem", (item, _changes, _options, _userId) => invalidateActorAggCacheFromItem(item));
    Hooks.on("updateItem", (item, _changes, _options, _userId) => invalidateActorAggCacheFromItem(item));
    Hooks.on("createItem", (item, _options, _userId) => invalidateActorAggCacheFromItem(item));
    Hooks.on("deleteItem", (item, _options, _userId) => invalidateActorAggCacheFromItem(item));
  }

  // Chapter 5: conditions + wounds automation (AE-backed, deterministic)
  registerConditions();
  registerWounds();

  // Frenzied condition automation (Chapter 5)
  try {
    registerFrenzied();
    if (!game.uesrpg.conditions) game.uesrpg.conditions = {};
    game.uesrpg.conditions.frenzied = FrenziedAPI;
  } catch (err) {
    console.warn("UESRPG | Failed to register Frenzied automation", err);
  }

// Applying Font to system
function applyFont(fontFamily) {
  document.documentElement.style.setProperty("--main-font-family", fontFamily);
}

//Hook for changing font on startup


Hooks.once("ready", async () => {
  const fontFamily = game.settings.get("uesrpg-3ev4", "changeUiFont");
  applyFont(fontFamily);


  // Developer-only: expose a skill TN debug helper for the GM.
  if (game.user?.isGM && isDebugEnabled("debugSkillTN")) {
    registerSkillTNDebug();
  }

  // Developer-only: token control TN-context logger.
  // Register unconditionally; it is inert unless the client toggle is enabled.
  registerActorSelectDebug();
});

// Auto-execute Special Action outcomes when skill opposed test resolves
Hooks.on("createChatMessage", async (message) => {
  const state = message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
  if (!state?.outcome || !state?.specialActionId) return;

  try {
    const { executeSpecialAction } = await import("../core/combat/special-actions-helper.js");
    
    const attacker = fromUuidSync(state.attacker?.actorUuid);
    const defender = fromUuidSync(state.defender?.actorUuid);
    
    // Attacker is always required; defender is required for all opposed actions
    // (Arise is handled separately and doesn't trigger this hook)
    if (!attacker) return;
    
    // Most Special Actions require a defender, but be defensive
    const target = defender ?? null;

    const result = await executeSpecialAction({
      specialActionId: state.specialActionId,
      actor: attacker,
      target,
      isAutoWin: false,
      opposedResult: state.outcome
    });

    if (result.success) {
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        content: `<div class="uesrpg-special-action-outcome"><b>Special Action Outcome:</b><p>${result.message}</p></div>`,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    }
  } catch (err) {
    console.error("UESRPG | Failed to execute Special Action outcome automation", err);
  }
});
}
