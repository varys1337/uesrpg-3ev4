import { SYSTEM_ID } from "../../../core/system/namespace.js";
import {
  scheduleEngagementFlankingRefresh,
  clearFlankedConditions,
} from "../../../core/homebrew/engagement-flanking/index.js";

function _reg(key, config) {
  if (game.settings.settings?.has(`${SYSTEM_ID}.${key}`)) {
    console.warn(`UESRPG | Settings: duplicate key "${key}" вЂ” skipping.`);
    return;
  }
  game.settings.register(SYSTEM_ID, key, config);
}

export function registerHomebrewSettings() {
  // Hidden GM rules/system policy: long-term table rules that intentionally branch runtime behavior.
  _reg("homebrew.speedFormulaSBAB", {
    name: "Homebrew: Speed Formula (SB + AB)",
    hint: "When enabled, base Speed is computed as SB + AB (instead of SB + 2Г—AB). Requires a reload to apply consistently.",
    scope: "world",
    config: false,
    requiresReload: true,
    default: false,
    type: Boolean,
  });

  _reg("homebrew.reachLength.enabled", {
    name: "Homebrew: Reach & Length Overhaul (Harnmaster-inspired)",
    hint: "When enabled, weapons gain explicit Length (LNG) values and model-specific homebrew reach overrides. Unlocks Length Penalty automation and the In Close condition. Requires a reload to apply consistently.",
    scope: "world",
    config: false,
    requiresReload: true,
    default: false,
    type: Boolean,
  });

  _reg("homebrew.reachLength.reachModel", {
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

  _reg("homebrew.reachLength.attackerAdvantageOnly", {
    name: "Homebrew: Length Advantage (Attacker Only)",
    hint: "When enabled, Length TN modifiers apply only to the attacker side. Defender-side Length bonuses and penalties are both suppressed.",
    scope: "world",
    config: false,
    requiresReload: false,
    default: false,
    type: Boolean,
  });

  _reg("homebrew.engagementFlanking.enabled", {
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

  _reg("homebrew.engagementFlanking.onlyInCombat", {
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

  // ── Mass Combat (Warfare Unit) ────────────────────────────────────────
  _reg("homebrew.massCombat.enabled", {
    name: "Homebrew: Mass Combat System",
    hint: "Enables the Warfare Unit actor type and mass combat UI. When disabled, existing Warfare Unit actors remain openable but new ones cannot be created.",
    scope: "world",
    config: false,
    requiresReload: false,
    default: false,
    type: Boolean,
  });
}
