/**
 * @module traits/features/feature-config
 * @description Per-item Feature Configuration model for traits, talents, and powers.
 *
 * Stores configurable automation options in `flags.uesrpg-3ev4.featureConfig`
 * to avoid schema/migration churn. Provides a central helper to read merged
 * defaults + persisted flags from any item.
 *
 * Design:
 *  - Pure data helpers — no mutations, no side-effects.
 *  - Compatible with AppV1 dot-notation formData (flag paths saved automatically).
 *  - Capability-driven: item type determines which options are relevant.
 */

const SYSTEM_ID = "uesrpg-3ev4";
const FLAG_KEY  = "featureConfig";

// ─── Default Configuration ───────────────────────────────────────────

/**
 * Default feature configuration. Every field here is safe to render
 * in a template even if no flags have been persisted yet.
 */
export const DEFAULT_FEATURE_CONFIG = Object.freeze({
  /** Master enable toggle — when false, the feature is completely inert. */
  enabled: true,

  /**
   * Apply mode governs how automation fires:
   *  - "auto"    → apply immediately when triggered (default)
   *  - "confirm" → show a confirmation dialog before applying
   *  - "manual"  → do not auto-apply; require explicit "Use" action
   */
  applyMode: "auto",

  /**
   * Prompt routing for confirmation/manual dialogs:
   *  - "owner"  → whisper to item owners
   *  - "gm"     → whisper to GM only
   *  - "both"   → whisper to GM and owners
   *  - "never"  → suppress prompts (only meaningful when applyMode="auto")
   */
  promptMode: "owner",

  /** If true, feature only activates during active combat. */
  combatOnly: false,

  /** If true, feature may be used outside combat. */
  outOfCombatAllowed: true,

  /**
   * Stacking override — overrides the canonical stacking rule for this
   * specific item instance.
   *  - "default" → use registry/canonical stacking (no override)
   *  - "none"    → do not stack (single instance)
   *  - "highest" → keep highest numeric value
   *  - "add"     → sum with other instances
   *  - "any"     → boolean OR (flags/immunities)
   */
  stackingOverride: "default",

  /**
   * Target policy — governs targeting behavior for activatable features:
   *  - "self"     → enforce self-target only
   *  - "single"   → single target selection
   *  - "multi"    → multiple target selection
   *  - "template" → place a measured template
   *  - "ask"      → prompt for target selection
   */
  targetPolicy: "self",

  /**
   * Transfer effects to target — when true, the item's AEs are cloned
   * onto targeted actors on activation (instead of only applying to self).
   */
  transferEffects: false,

  /**
   * Suppress self-application — when true, the item's transfer AEs do NOT
   * passively apply to the owning actor. Useful for effects that should
   * only affect targets, not the activator.
   */
  suppressSelfTransfer: false,

  /**
   * Effect duration mode for transferred effects:
   *  - "permanent" → no automatic expiry (manual removal)
   *  - "timed"     → uses duration fields from the activation config
   */
  effectDuration: "permanent",

  /**
   * Visibility scope:
   *  - "all"    → visible to all users in inspector/chat
   *  - "gmOnly" → visible only to GM
   */
  visibility: "all",

  /** Debug options */
  debug: Object.freeze({
    /** Show this feature in the Feature Inspector panel. */
    showInInspector: true,
  }),
});


// ─── Option lists for template selects ───────────────────────────────

/** Apply mode options { value: label } */
export const APPLY_MODE_OPTIONS = Object.freeze({
  auto:    "Automatic",
  confirm: "Confirm First",
  manual:  "Manual Only",
});

/** Prompt mode options { value: label } */
export const PROMPT_MODE_OPTIONS = Object.freeze({
  owner: "Owner",
  gm:    "GM Only",
  both:  "GM & Owner",
  never: "Never",
});

/** Stacking override options { value: label } */
export const STACKING_OVERRIDE_OPTIONS = Object.freeze({
  default: "Default (Registry)",
  none:    "No Stacking",
  highest: "Highest Value",
  add:     "Additive",
  any:     "Any (Boolean)",
});

/** Target policy options { value: label } */
export const TARGET_POLICY_OPTIONS = Object.freeze({
  self:     "Self Only",
  single:   "Single Target",
  multi:    "Multi-Target",
  template: "Template (AoE)",
  ask:      "Ask (Prompt)",
});

/** Visibility options { value: label } */
export const VISIBILITY_OPTIONS = Object.freeze({
  all:    "All Users",
  gmOnly: "GM Only",
});

/** Effect duration options { value: label } */
export const EFFECT_DURATION_OPTIONS = Object.freeze({
  permanent: "Permanent (Manual Removal)",
  timed:     "Timed (From Activation)",
});


// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Read merged feature configuration from an item.
 * Returns a plain object with all config fields guaranteed (defaults
 * merged under any persisted flag values).
 *
 * @param {Item} item - A Foundry Item document.
 * @returns {object} Merged feature config (never null/undefined).
 */
export function getFeatureConfig(item) {
  if (!item) return { ...DEFAULT_FEATURE_CONFIG, debug: { ...DEFAULT_FEATURE_CONFIG.debug } };

  const flags = item.getFlag?.(SYSTEM_ID, FLAG_KEY);
  if (!flags || typeof flags !== "object") {
    return { ...DEFAULT_FEATURE_CONFIG, debug: { ...DEFAULT_FEATURE_CONFIG.debug } };
  }

  return {
    enabled:              flags.enabled ?? DEFAULT_FEATURE_CONFIG.enabled,
    applyMode:            flags.applyMode ?? DEFAULT_FEATURE_CONFIG.applyMode,
    promptMode:           flags.promptMode ?? DEFAULT_FEATURE_CONFIG.promptMode,
    combatOnly:           flags.combatOnly ?? DEFAULT_FEATURE_CONFIG.combatOnly,
    outOfCombatAllowed:   flags.outOfCombatAllowed ?? DEFAULT_FEATURE_CONFIG.outOfCombatAllowed,
    stackingOverride:     flags.stackingOverride ?? DEFAULT_FEATURE_CONFIG.stackingOverride,
    targetPolicy:         flags.targetPolicy ?? DEFAULT_FEATURE_CONFIG.targetPolicy,
    transferEffects:      flags.transferEffects ?? DEFAULT_FEATURE_CONFIG.transferEffects,
    suppressSelfTransfer: flags.suppressSelfTransfer ?? DEFAULT_FEATURE_CONFIG.suppressSelfTransfer,
    effectDuration:       flags.effectDuration ?? DEFAULT_FEATURE_CONFIG.effectDuration,
    visibility:           flags.visibility ?? DEFAULT_FEATURE_CONFIG.visibility,
    debug: {
      showInInspector:    flags.debug?.showInInspector ?? DEFAULT_FEATURE_CONFIG.debug.showInInspector,
    },
  };
}


/**
 * Return the set of config option lists for template rendering.
 * These are provided to the template context so selects stay DRY.
 *
 * @returns {object} Named option sets.
 */
export function getFeatureConfigOptions() {
  return {
    applyModeOptions:        APPLY_MODE_OPTIONS,
    promptModeOptions:       PROMPT_MODE_OPTIONS,
    stackingOverrideOptions: STACKING_OVERRIDE_OPTIONS,
    targetPolicyOptions:     TARGET_POLICY_OPTIONS,
    visibilityOptions:       VISIBILITY_OPTIONS,
    effectDurationOptions:   EFFECT_DURATION_OPTIONS,
  };
}


/**
 * Determine which config capabilities are relevant for a given item type.
 * Used for capability-driven UI — only show controls that make sense.
 *
 * @param {string} itemType - "trait", "talent", or "power"
 * @returns {object} Boolean map of capabilities.
 */
export function getFeatureConfigCapabilities(itemType) {
  const type = String(itemType ?? "").toLowerCase();
  return {
    /** Always show core controls (enabled, applyMode, promptMode). */
    showCore: ["trait", "talent", "power"].includes(type),
    /** Show combat context controls (combatOnly, outOfCombatAllowed). */
    showCombatContext: ["trait", "talent", "power"].includes(type),
    /** Show stacking override (primarily useful for traits). */
    showStacking: type === "trait",
    /** Show target policy (all feature types). */
    showTargeting: ["trait", "talent", "power"].includes(type),
    /** Show effect transfer controls (all feature types). */
    showEffectTransfer: ["trait", "talent", "power"].includes(type),
    /** Show visibility controls (all types). */
    showVisibility: ["trait", "talent", "power"].includes(type),
    /** Show debug controls (all types, GM only). */
    showDebug: ["trait", "talent", "power"].includes(type),
  };
}
