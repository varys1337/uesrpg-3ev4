import {
  TALENT_LEARNING_MODE,
  TALENT_NO_GOVERNING_COST_RULE,
  TALENT_LEARNING_NOTICE_MODE,
} from "../../core/traits/talent-learning.js";

import { registerDebugSettingsMenu } from "../../utils/dev/debug-settings.js";
import { registerInterfaceSettingsMenu } from "../../ui/apps/interface-settings.js";
import { registerTalentsSettingsMenu } from "../../ui/apps/talents-settings.js";
import { registerCombatSettingsMenu } from "../../ui/apps/combat-settings.js";
import {
  registerReachVisualizerSettingsMenu,
  registerReachVisualizerSettingsStorage
} from "../../ui/apps/reach-visualizer-settings.js";
import { registerHomebrewSettingsMenu } from "../../ui/apps/homebrew-settings.js";
import { invalidateCachedSetting } from "../../core/config/settings-cache.js";
import {
  scheduleEngagementFlankingRefresh,
  clearFlankedConditions,
} from "../../core/homebrew/engagement-flanking/index.js";

export async function registerSettings() {
  // Register system settings
  
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

  // UI: Custom cursor (passive/active) akin to WFRP4e.
  // Note: Foundry applies CONFIG.cursors for canvas interaction states.
  // We gate this behind a world setting and require reload to apply cleanly.
  game.settings.register("uesrpg-3ev4", "customCursor", {
    name: "Custom Cursor",
    hint: "Use the UESRPG stylized cursor (requires reload).",
    scope: "world",
    config: false,
    requiresReload: true,
    default: true,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "autoResizeSheets", {
    name: "Auto-resize Actor/Item Sheets",
    hint: "Automatically resize AppV2 actor and item sheets to fit content (clamped to screen height). Disable to restore fixed sizing behavior.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register("uesrpg-3ev4", "sheetPerfTrace", {
    name: "Sheet Performance Trace",
    hint: "Log AppV2 sheet timing traces for _prepareContext, _onRender, _attachPartListeners, and _onClose.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register("uesrpg-3ev4", "dndDebugEnabled", {
    name: "DnD Debug Logging",
    hint: "Log detailed drag-and-drop payload parsing and resolution diagnostics for sheet item transfers.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register("uesrpg-3ev4", "dndDebugVerbose", {
    name: "DnD Debug Verbose Groups",
    hint: "Use grouped console output for drag-and-drop diagnostics (requires DnD Debug Logging).",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register("uesrpg-3ev4", "dndDebugNotifyOnFailure", {
    name: "DnD Debug Failure Notifications",
    hint: "Show user warnings for terminal drag-and-drop failures with correlation IDs.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register("uesrpg-3ev4", "dndDebugDomEvents", {
    name: "DnD Debug DOM Events",
    hint: "Log low-level DOM dragstart/drop observer events (high volume).",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register("uesrpg-3ev4", "dndDebugKeepRecentCount", {
    name: "DnD Debug Recent Trace Count",
    hint: "How many recent in-memory DnD trace events to keep for dumpDndTrace helpers.",
    scope: "client",
    config: false,
    type: Number,
    default: 100,
  });

  game.settings.register("uesrpg-3ev4", "dndDebugCacheFallbackEnabled", {
    name: "DnD Cache Fallback Enabled",
    hint: "Allow last-drag payload cache fallback when drop payload parsing is incomplete.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
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

  game.settings.register("uesrpg-3ev4", "enableCharGenSlashCommand", {
    name: "Enable /char Slash Command",
    hint: "When enabled, `/char` opens the Character Generation Wizard.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  game.settings.register("uesrpg-3ev4", "useRawChargenWizard", {
    name: "Character Generation: Use RAW Wizard Button",
    hint: "When enabled, actor sheets show a Character Creation (RAW) button that runs the RAW chargen flow.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    requiresReload: false,
    onChange: () => invalidateCachedSetting("useRawChargenWizard"),
  });

  game.settings.register("uesrpg-3ev4", "chargenMagicPurchaseMode", {
    name: "Character Generation: Spell Purchase Mode",
    hint: "Controls allowed payment resources for spell learning in RAW chargen.",
    scope: "world",
    config: false,
    type: String,
    default: "both",
    choices: {
      both: "Both (XP or Drakes where available)",
      xpOnly: "XP Only",
      drakesOnly: "Drakes Only",
    },
    requiresReload: false,
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
    requiresReload: true,
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

  // Migration state payload used by system migrations (JSON string).
  game.settings.register("uesrpg-3ev4", "migrationState", {
    name: "Migration State",
    hint: "Internal migration state payload.",
    scope: "world",
    config: false,
    default: "{}",
    type: String,
  });

  // Global master gate for all world-scope debug lanes.
  game.settings.register("uesrpg-3ev4", "debugEnabled", {
    name: "Enable World Debug Logging",
    hint: "Enables all UESRPG world-level debug logging. Covers opposed workflows, spell casting, talents, wounds, and more.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Client-scope master gate for all client debug lanes.
  game.settings.register("uesrpg-3ev4", "debugClientEnabled", {
    name: "Enable Client Debug Logging",
    hint: "Enables all UESRPG client-level debug logging for this user. Covers AE lifecycle, aim, sheet diagnostics, performance traces, and more.",
    scope: "client",
    config: false,
    default: false,
    type: Boolean,
  });

  // Feature Inspector visibility toggle (debug/provenance panel on actor sheets)
  game.settings.register("uesrpg-3ev4", "showFeatureInspector", {
    name: "Show Feature Inspector",
    hint: "When enabled, shows the Feature Inspector provenance panel on PC and NPC actor sheets. Debug tool — hidden by default.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
    onChange: () => invalidateCachedSetting("showFeatureInspector"),
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
    requiresReload: true
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

  game.settings.register("uesrpg-3ev4", "woundsMode", {
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

  game.settings.register("uesrpg-3ev4", "talentLearningMode", {
    name: "Talents: Learning Enforcement Mode",
    hint: "Off: no checks. Warn: allow but show RAW violations. Enforce: block invalid talent acquisition and auto-deduct XP on success.",
    scope: "world",
    config: false,
    default: TALENT_LEARNING_MODE.WARN,
    type: String,
    choices: {
      [TALENT_LEARNING_MODE.OFF]: "Off",
      [TALENT_LEARNING_MODE.WARN]: "Warn",
      [TALENT_LEARNING_MODE.ENFORCE]: "Enforce",
    },
  });

  game.settings.register("uesrpg-3ev4", "talentNoGoverningCostRule", {
    name: "Talents: No-Governing XP Rule",
    hint: "How to price talents that have no governing characteristic.",
    scope: "world",
    config: false,
    default: TALENT_NO_GOVERNING_COST_RULE.DISCOUNTED,
    type: String,
    choices: {
      [TALENT_NO_GOVERNING_COST_RULE.DISCOUNTED]: "Discounted (75%, round down to 5)",
      [TALENT_NO_GOVERNING_COST_RULE.BASE]: "Base Cost",
    },
  });

  game.settings.register("uesrpg-3ev4", "talentLearningNoticeMode", {
    name: "Talents: Learning Notification Mode",
    hint: "Controls GM/player notification verbosity for talent learning checks.",
    scope: "world",
    config: false,
    default: TALENT_LEARNING_NOTICE_MODE.PROBLEMS,
    type: String,
    choices: {
      [TALENT_LEARNING_NOTICE_MODE.OFF]: "Off",
      [TALENT_LEARNING_NOTICE_MODE.PROBLEMS]: "Problems Only",
      [TALENT_LEARNING_NOTICE_MODE.VERBOSE]: "Verbose (includes successful checks)",
    },
  });

  game.settings.register("uesrpg-3ev4", "chapter4AuditStartupMode", {
    name: "Talents: Chapter 4 Audit at Startup",
    hint: "Run catalog-based Chapter 4 compliance audit when world loads for GMs.",
    scope: "world",
    config: false,
    default: "off",
    type: String,
    choices: {
      off: "Off",
      summary: "Summary",
      full: "Full (include entries + console log)",
    },
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

  // ── Enchanting Workshop ─────────────────────────────────────────────────────

  // NOTE: The Workshop is a core system element.
  // This setting remains for backward-compatibility with existing worlds, but
  // the runtime no longer gates the Workshop UI on this value.
  game.settings.register("uesrpg-3ev4", "enchanting.enableWorkshop", {
    name: "Enchanting: Enable Workshop",
    hint: "Legacy toggle (no longer used as a gate). The Enchanting Workshop is a core system element and is enabled by default.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Strike-on-hit runtime (optional, default off — applies strike effects automatically after a confirmed hit).
  game.settings.register("uesrpg-3ev4", "enchanting.enableStrikeRuntime", {
    name: "Enchanting: Enable Strike Runtime",
    hint: "When enabled, strike enchantment effects (elemental damage, conditions, drains, etc.) fire automatically on a confirmed hit. Requires enableWorkshop.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Cast enchantment runtime (default on).
  game.settings.register("uesrpg-3ev4", "enchanting.enableCastEnchantmentRuntime", {
    name: "Enchanting: Enable Cast Enchantment Runtime",
    hint: "When enabled, cast enchantments can cast stored spells using Soul Energy from the enchanted item pool.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Wear-limit enforcement (optional, default off — can conflict with manual equip decisions).
  game.settings.register("uesrpg-3ev4", "enchanting.enforceWearLimits", {
    name: "Enchanting: Enforce Wear Limits",
    hint: "When enabled, RAW enchanted-item wear limits are enforced (1 enchanted item per hit location, jewelry limits, 1 enchanted wielded per hand).",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Charged Strike variant (optional, default off).
  game.settings.register("uesrpg-3ev4", "enchanting.enableChargedStrikeVariant", {
    name: "Enchanting: Charged Strike Variant",
    hint: "When enabled, strike enchantments can use a charge pool (cost / 10 charges). Optional rule.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Conjure instability (optional, default off).
  game.settings.register("uesrpg-3ev4", "enchanting.enableConjureInstability", {
    name: "Enchanting: Conjure Instability",
    hint: "When enabled, bound-item enchantments that overlap an equipped slot cause instability wounds each turn per RAW. Optional rule.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Cursed constant enchantments (optional, default off).
  game.settings.register("uesrpg-3ev4", "enchanting.enableCursedConstant", {
    name: "Enchanting: Cursed Constant Enchantments",
    hint: "When enabled, constant enchantments can be marked Cursed (cannot be disabled; special failure cadence per RAW). Optional rule.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // ── Alchemy Workshop (always enabled — default: true) ───────────────────────

  // The Workshop is a core system element (same tier as the Enchanting Workshop).
  // Setting retained for backward-compatibility; the runtime no longer hard-gates on it.
  game.settings.register("uesrpg-3ev4", "alchemy.enableWorkshop", {
    name: "Alchemy: Enable Workshop",
    hint: "Core system element — always available. Toggle retained for backward-compatibility.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Runtime gate: enables drink/apply/on-hit/round-tick hooks.
  game.settings.register("uesrpg-3ev4", "alchemy.enableRuntime", {
    name: "Alchemy: Enable Runtime Automation",
    hint: "When enabled, drinking potions, applying poisons/toxins, on-hit resolution, and round tick-down are automated. Requires enableWorkshop.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // RAW: require an Alchemy Lab item in inventory to brew.
  game.settings.register("uesrpg-3ev4", "alchemy.requireLab", {
    name: "Alchemy: Require Alchemy Lab",
    hint: "When enabled (RAW), the actor must have an Alchemy Lab item in their inventory to brew potions, poisons, or toxins.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Optional: gathering ingredient helper UI.
  game.settings.register("uesrpg-3ev4", "alchemy.enableGatheringHelper", {
    name: "Alchemy: Enable Gathering Helper",
    hint: "When enabled, the Workshop includes a Gather Ingredients mode to roll for and record gathered alchemical ingredients.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // ─────────────────────────────────────────────────────────────────────────────

  // ── Homebrew ──────────────────────────────────────────────────────────────────

  game.settings.register("uesrpg-3ev4", "homebrew.speedFormulaSBAB", {
    name: "Homebrew: Speed Formula (SB + AB)",
    hint: "When enabled, base Speed is computed as SB + AB (instead of SB + 2×AB). Requires a reload to apply consistently.",
    scope: "world",
    config: false,
    requiresReload: true,
    default: false,
    type: Boolean,
  });

  // ── Homebrew: Reach & Length Overhaul ─────────────────────────────────────

  game.settings.register("uesrpg-3ev4", "homebrew.reachLength.enabled", {
    name: "Homebrew: Reach & Length Overhaul (Harnmaster-inspired)",
    hint: "When enabled, weapons gain explicit Length (LNG) values and model-specific homebrew reach overrides. Unlocks Length Penalty automation and the In Close condition. Requires a reload to apply consistently.",
    scope: "world",
    config: false,
    requiresReload: true,
    default: false,
    type: Boolean,
  });

  game.settings.register("uesrpg-3ev4", "homebrew.reachLength.reachModel", {
    name: "Homebrew: Reach Model",
    hint: "Classic: min/max reach values per weapon (Harnmaster-style). Simplified: max reach only (d20-style, no minimum reach gating).",
    scope: "world",
    config: false,
    requiresReload: false,
    default: "classic",
    type: String,
    choices: {
      classic: "Classic (Min + Max Reach)",
      simplified: "Simplified (Max Reach Only)",
    },
  });

  game.settings.register("uesrpg-3ev4", "homebrew.engagementFlanking.enabled", {
    name: "Homebrew: Engagement & Flanking",
    hint: "Automatically computes Flanked (X) from engagement pressure and defensive training. Melee attackers gain +5 TN per Flanked point.",
    scope: "world",
    config: false,
    requiresReload: false,
    default: false,
    type: Boolean,
    onChange: async (enabled) => {
      try {
        if (enabled) scheduleEngagementFlankingRefresh();
        else if (game.user?.isGM) await clearFlankedConditions();
      } catch (err) {
        console.warn("UESRPG | Engagement & Flanking onChange failed", err);
      }
    },
  });

  game.settings.register("uesrpg-3ev4", "homebrew.engagementFlanking.onlyInCombat", {
    name: "Homebrew: Engagement & Flanking (Only In Combat)",
    hint: "When enabled, Flanked (X) automation runs only while combat is started.",
    scope: "world",
    config: false,
    requiresReload: false,
    default: true,
    type: Boolean,
    onChange: () => {
      try {
        scheduleEngagementFlankingRefresh();
      } catch (err) {
        console.warn("UESRPG | Engagement & Flanking onlyInCombat onChange failed", err);
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────

  // Register a dedicated Debugging menu to avoid clutter in System Settings.
  registerDebugSettingsMenu();

  // Subcategory menus to keep System Settings uncluttered.
  registerInterfaceSettingsMenu();
  registerTalentsSettingsMenu();
  registerCombatSettingsMenu();

  // Reach Visualizer submenu (client scoped)
  registerReachVisualizerSettingsStorage();
  registerReachVisualizerSettingsMenu();

  // Homebrew submenu (GM-restricted, world-scoped house rules)
  registerHomebrewSettingsMenu();

}
