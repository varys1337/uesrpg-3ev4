/**
 * UESRPG Active Effect Modifier Evaluator facade.
 *
 * Public API is preserved for all existing imports.
 * Internal implementation is split across:
 * - collect.js
 * - conditions.js
 * - evaluate.js
 */

export { collectApplicableEffects, getApplicableEffectsCached } from "./collect.js";
export { getActorCapabilityFlag } from "./capability-flags.js";
export {
  evaluateAEModifierKeys,
  evaluateAEModifierKeysDetailed,
  buildAEBreakdownEntries
} from "./evaluate.js";
