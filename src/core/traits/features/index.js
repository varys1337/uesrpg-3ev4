/**
 * @module traits/features
 * @description Public API surface for the Feature Automation framework.
 */

export { FEATURE_DOMAINS, STACKING_MODES, makeFeatureMod, normalizeFeatureKey } from "./feature-mod.js";
export { reduceByStacking, reduceAllByStacking } from "./stacking.js";
export { collectFeatureMods, applyFeatureModTotals, filterModsForApplication, applyWeaknessToResistance } from "./collect-feature-mods.js";
export { runFeatureAutomation } from "./feature-dispatcher.js";
export { TRAIT_STACKING_META } from "./contributors.js";
export {
  getFeatureConfig,
  getFeatureConfigOptions,
  getFeatureConfigCapabilities,
  DEFAULT_FEATURE_CONFIG,
  APPLY_MODE_OPTIONS,
  STACKING_OVERRIDE_OPTIONS,
  TARGET_POLICY_OPTIONS
} from "./feature-config.js";
export {
  RULE_ELEMENT_TYPES,
  CONDITION_TYPES,
  RULE_ELEMENT_RUNTIME_SUPPORT,
  getRuleElements,
  setRuleElements,
  createRuleElement,
  createCondition,
  getRuleElementOptions,
  getRuleElementTypesByFamily,
  getRuleElementRuntimeSupport,
  normalizeRuleElement,
  validateRuleElement,
  isREAuthoritative,
  shouldYieldToRE,
} from "./rule-elements.js";
export { compileConditionsToPredicate } from "./conditions-to-predicate.js";
export {
  isRuleElementRuntimeEnabled,
  getRuleElementRuntimeSettingsState,
  evaluateRuleElementsRuntime,
  getRuntimeTnDelta,
  applyRuntimePreRollToTN,
  applyRuntimePostRollToResult,
  selfTestRuleElementRuntime
} from "./rule-element-runtime.js";
