import { SYSTEM_ID } from "../../../core/system/namespace.js";
import { invalidateCachedSetting } from "../../../core/config/settings-cache.js";
import { localizeSettingConfig } from "../../../utils/i18n.js";
import {
  TALENT_LEARNING_MODE,
  TALENT_NO_GOVERNING_COST_RULE,
  TALENT_LEARNING_NOTICE_MODE,
} from "../../../core/traits/talent-learning.js";

function _reg(key, config) {
  if (game.settings.settings?.has(`${SYSTEM_ID}.${key}`)) {
    console.warn(`UESRPG | Settings: duplicate key "${key}" — skipping.`);
    return;
  }
  game.settings.register(SYSTEM_ID, key, localizeSettingConfig("Talents", key, config));
}

export function registerTalentsSettings() {
  // Hidden GM rules/system policy: talent automation and enforcement semantics.
  _reg("enableMightyCleave", {
    name: "Talents: Enable Mighty Cleave automation",
    hint: "When enabled, Mighty Cleave can create a follow-up attack button on opposed cards (requires the talent). Disabled by default to avoid changing table enforcement assumptions.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  _reg("enableFollowUpStrike", {
    name: "Talents: Enable Follow-up Strike automation",
    hint: "When enabled, Follow-up Strike can create a free follow-up attack button on opposed cards (requires the talent). Disabled by default to avoid changing table enforcement assumptions.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  _reg("gladiatorAutomationMode", {
    name: "Talents: Gladiator automation mode",
    hint: "Controls Gladiator free-defense behavior (Disabled, Original/Make, Updated/Can).",
    scope: "world",
    config: false,
    default: "original",
    type: String,
    choices: {
      disabled: "Disabled",
      original: "Original (Make)",
      updated: "Updated (Can)",
    },
  });

  _reg("talentLearningMode", {
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

  _reg("talentNoGoverningCostRule", {
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

  _reg("talentLearningNoticeMode", {
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

  _reg("chapter4AuditStartupMode", {
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

  _reg("enforceCharGenMilestones", {
    name: "Enforce Character Generation Milestones",
    hint: "When enabled, Imperial racial talent automation (Red Diamond / Imperial Luck) applies only if the actor has flags.uesrpg.charGen.completed = true.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  _reg("enableCharGenSlashCommand", {
    name: "Enable /char Slash Command",
    hint: "When enabled, `/char` opens the Character Generation Wizard.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  _reg("useRawChargenWizard", {
    name: "Character Generation: Use RAW Wizard Button",
    hint: "When enabled, actor sheets show a Character Creation (RAW) button that runs the RAW chargen flow.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    requiresReload: false,
    onChange: () => invalidateCachedSetting("useRawChargenWizard"),
  });

  _reg("chargenMagicPurchaseMode", {
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

  _reg("chargenSpellLearningLogCap", {
    name: "Character Generation: Spell Learning Log Cap",
    hint: "0 = unlimited. Otherwise, keep only the most recent N spell learning log entries.",
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    range: {
      min: 0,
      max: 5000,
      step: 10,
    },
    requiresReload: false,
  });

  _reg("passiveTransferItemTypes", {
    name: "Passive Transfer Item Types",
    hint: "Comma-separated item types whose transfer Active Effects apply passively while the item is in an actor's inventory.",
    scope: "world",
    config: false,
    type: String,
    default: "talent,trait,power,skill",
    requiresReload: true
  });

  // Rule-element runtime master switch (phase-gated substrate rollout).
  // Spell Recipes (Experimental) — hidden by default
  _reg("enableSpellRecipes", {
    name: "Spell Recipes (Experimental)",
    hint: "When enabled, shows the Effect Recipes UI on spell sheets. This feature is experimental and may not fully integrate with ActiveEffect creation.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Skill roll UI QoL (client-scoped)
  _reg("skillRollLastOptions", {
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

  _reg("skillRollQuickShift", {
    name: "Skill Roll: Shift Quick Roll",
    hint: "When enabled, holding Shift will bypass the roll options dialog and use remembered/default options.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true
  });
}
