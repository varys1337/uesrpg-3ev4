/**
 * @module magic
 * @description
 * Barrel re-export for the magic subsystem.
 *
 * This module exposes the **stable public API** of `src/core/magic/`.
 * It intentionally **excludes**:
 *
 * - `initialize*()` bootstrapper functions (boot-order-sensitive; imported
 *   directly by `system.js` or peer modules)
 * - `_primitives.js` (internal shared helpers with `_`-prefixed symbols)
 * - Backward-compat re-exports already covered by the canonical source
 *
 * Consumers outside the magic folder should prefer importing from this barrel.
 * Internal magic modules should continue importing from siblings directly.
 *
 * @see docs/Coding/MAGIC_FOLDER_ARCHITECTURE.md (if created)
 *
 * Target: Foundry VTT v14.359+
 */

// ──────────────────────────────────────────────
//  Backfire
// ──────────────────────────────────────────────
export {
  shouldBackfire,
  triggerBackfire,
} from "./backfire.js";

// ──────────────────────────────────────────────
//  Casting Service
// ──────────────────────────────────────────────
export { SpellCastingService } from "./casting-service.js";

// ──────────────────────────────────────────────
//  Characteristic Defense
// ──────────────────────────────────────────────
export {
  isCharacteristicDefense,
  computeCharacteristicDefenseTN,
  executeCharacteristicDefense,
  processCharacteristicDefenseOutcome,
  applyConsequences,
  formatConsequenceReport,
} from "./characteristic-defense-service.js";

// ──────────────────────────────────────────────
//  Damage Application
// ──────────────────────────────────────────────
export {
  applyMagicDamage,
  applyMagicHealing,
} from "./damage-application.js";

// ──────────────────────────────────────────────
//  Magic Modifiers
// ──────────────────────────────────────────────
export {
  actorHasTalent,
  actorHasTrait,
  getActorWillpowerBonus,
  isSpellConventional,
  isSpellUnconventional,
  isElementalDamageType,
  computeSpellRestraintReduction,
  canOverloadWhileRestrained,
  computeElementalDamageBonus,
  canUseMasterOfMagicka,
} from "./magic-modifiers.js";

// ──────────────────────────────────────────────
//  Magicka Utilities
// ──────────────────────────────────────────────
export {
  getSpellLevel,
  getSpellScalingLevels,
  getSpellScalingEntry,
  getSpellCost,
  getSpellDamageFormula,
  getSpellDamageType,
  isHealingSpell,
  getActorMagicka,
  computeSpellMagickaCost,
  computeSpellAttemptMagickaCost,
  applySpellRestraintRefund,
  consumeSpellMagicka,
  rollSpellDamage,
  computeSpellOverloadBonusDamage,
  rollSpellHealing,
  getMaxSpellDamage,
  getMagicSkillLevel,
  isActorTrainedInMagicSchool,
  computeMagicCastingTN,
} from "./magicka-utils.js";

// ──────────────────────────────────────────────
//  Opposed Workflow (facade)
// ──────────────────────────────────────────────
export { MagicOpposedWorkflow } from "./opposed-workflow.js";

// ──────────────────────────────────────────────
//  Spell Configuration & Validation
// ──────────────────────────────────────────────
export {
  validateScalingLevels,
  formatValidationMessage,
  validateSpellConfig,
  formatSpellValidationMessage,
  getSpellCoverageReport,
  normalizeSpellConfig,
  getEngineDefaults,
  getStackingPolicyOptions,
  getOwnershipPolicyOptions,
  getDispelStrengthOptions,
  getTargetingModeOptions,
  getEffectRecipeModeOptions,
  getConjureModeOptions,
  getDisintegrateTargetOptions,
  getDrainTypeOptions,
  getBindingCharacteristicOptions,
  getDefenseModelOptions,
  getCharacteristicDefenseSuccessOptions,
  getCharacteristicDefenseFailureOptions,
  getConsequenceConditionOptions,
} from "./spell-config.js";

// ──────────────────────────────────────────────
//  Spell Profile
// ──────────────────────────────────────────────
export {
  resolveSpellProfile,
  summarizeSpellProfile,
} from "./spell-profile.js";

// ──────────────────────────────────────────────
//  Spell Range & AoE
// ──────────────────────────────────────────────
export {
  parseMeters,
  getSpellRangeType,
  getSpellMaxRangeMeters,
  getSpellAoEConfig,
  filterTargetsBySpellRange,
} from "./spell-range.js";

// ──────────────────────────────────────────────
//  Spell Runtime & Hooks
// ──────────────────────────────────────────────
export {
  emitPreCast,
  emitCastResolved,
  emitEffectApplied,
  classifySpellForRouting,
  getUserSpellTargets,
  shouldUseTargetedSpellWorkflow,
  shouldUseModernSpellWorkflow,
  debugMagicRoutingLog,
  getSpellReflectThreshold,
  trySpellReflect,
  linkAreaToOriginAE,
  getTokensInArea,
  linkTemplateToOriginAE,
  getTokensInTemplate,
  getActiveSpellZones,
} from "./spell-runtime.js";

// ──────────────────────────────────────────────
//  Timekeeping
// ──────────────────────────────────────────────
export { MagicTimekeeping } from "./timekeeping-helper.js";

// ──────────────────────────────────────────────
//  Upkeep Workflow
// ──────────────────────────────────────────────
export {
  handleUpkeepGroupConfirm,
  handleUpkeepGroupCancel,
} from "./upkeep-workflow.js";

// ──────────────────────────────────────────────
//  Conjuration
// ──────────────────────────────────────────────
export {
  pickCanvasLocation,
} from "./conjuration/conjuration-runtime.js";

export {
  spawnSummon,
  getSummonedTokens,
  getSummonedTokensByOrigin,
  showSummonActorPicker,
} from "./conjuration/summon-service.js";

// ──────────────────────────────────────────────
//  Effects
// ──────────────────────────────────────────────
// Authoritative spell lifecycle modules live under ./effects/*.
// Import and patch those files first when working on spell timing/upkeep/Origin AE behavior.
export {
  spellRequiresOriginAE,
  createOriginAE,
  registerLinkedEntity,
  registerTargetAEs,
  teardownOriginAE,
  findOriginAE,
  getOriginAEs,
  isLinkedTargetAE,
  refreshOriginAEUpkeep,
  cancelOriginAEUpkeep,
  findOriginAEByGroupKey,
} from "./effects/origin-effect.js";

export {
  isEffectExpiredByWorldTime,
  isEffectExpiredByCombat,
} from "./effects/spell-effect-expiration.js";

export {
  applySpellEffectsToTarget,
} from "./effects/spell-effects.js";

// ──────────────────────────────────────────────
//  Services
// ──────────────────────────────────────────────
export {
  breakInvisibility,
} from "./services/condition-triggers.js";

export {
  applyDamagedQuality,
} from "./services/disintegrate-service.js";

export {
  enumerateDispellableEffects,
  dispelEffects,
  showDispelDialog,
} from "./services/dispel-service.js";

export {
  drainMagicka,
  drainHealth,
} from "./services/drain-service.js";

export {
  isRuneOriginAE,
  getActiveRunes,
  detonateRune,
} from "./services/rune-trigger-service.js";

// ──────────────────────────────────────────────
//  Ticks & OverTime
// ──────────────────────────────────────────────
export {
  OVERTIME_CHANGE_KEY,
  buildOverTimeChange,
  createOverTimeConfig,
  hasOverTimeConfig,
  getOverTimeConfig,
} from "./ticks/overtime-engine.js";

export {
  registerSpellTickHandler,
  unregisterSpellTickHandler,
  registerZoneTickHandler,
} from "./ticks/spell-tick-engine.js";

// ──────────────────────────────────────────────
//  Opposed Internals
//  (exposed for advanced consumers; prefer MagicOpposedWorkflow facade)
// ──────────────────────────────────────────────
export {
  getMessageState,
  getDefenderEntries,
  isMultiDefender,
  resolveDefenderIndex,
  selectDefenderEntry,
  getDefenderOutcome,
  setDefenderOutcome,
  markResolutionPhase,
  isBankChoicesEnabledForData,
  ensureBankedScaffold,
  getBankCommitState,
  allDefendersCommitted,
  resolveDoc,
  resolveActor,
  resolveToken,
  requireUserCanRollActor,
} from "./opposed/schema.js";

export {
  renderUnopposedCard,
  renderCard,
} from "./opposed/render.js";

export {
  resolveDirectUndefendable,
  resolveDirectNoTest,
  resolveHealingDirect,
  resolveOpposedTest,
  resolveOutcome,
} from "./opposed/outcome-resolution.js";

export {
  dispatchAction,
  autoRollBanked,
  handleDefenderRoll,
  handleDefenderNoDefense,
  handleDefenderCharacteristicTest,
  handleDefenderCommit,
  handleBlockResolve,
  handleWardResolve,
  computeEvadeTNWithBreakdown,
  computeBlockTNWithBreakdown,
} from "./opposed/actions.js";

export {
  spellHasFiniteDuration,
  spellNeedsEffectApplication,
  getBlockingNoDurationUpkeep,
  isHealingType,
  isTemporaryHealingType,
  shouldShareSpellDamage,
  computeSpellDamageShared,
  getOrCreateSharedSpellDamage,
  promptAoEEvadeEscape,
  maybeResolveAoEEvadeEscape,
} from "./opposed/spell-helpers.js";

export {
  handleAttackerCommit,
  handleAttackerRoll,
} from "./opposed/actions/attacker.js";
