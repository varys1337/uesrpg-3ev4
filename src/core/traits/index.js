/**
 * @module traits
 * @description Public API barrel for the traits & talents subsystem.
 *
 * Re-exports all externally consumed symbols from the traits modules,
 * plus the existing sub-barrels for `features/` and `weapon-expertise/`.
 *
 * **`_primitives.js` is intentionally excluded** — it is internal-only
 * (underscore prefix convention) and has zero external consumers.
 *
 * Target: Foundry VTT v13.351
 */

// ── talents-api.js ───────────────────────────────────────────────────
export {
  normalizeTalentKey,
  resolveTalentSlug,
  canonicalizeTalentKey,
  listKnownTalentSlugs,
  getTalentItem,
  hasTalent,
  getNamedItemRank,
  getSkillRank,
  getCombatStyleRank,
} from "./talents-api.js";

// ── trait-registry.js ────────────────────────────────────────────────
export {
  TRAIT_REGISTRY,
  applyTraitDerived,
  collectTraitDamageModifiers,
  getResistanceKeyForTraitType,
  getActorTraitDamageProfile,
  getActorTraitValue,
  hasActorTrait,
  isActorUndead,
  isActorUndeadBloodless,
  isActorSkeletal,
  isActorIncorporeal,
  isActorImmuneToDamageType,
  isActorImmuneToCondition,
  getDiseaseResistancePercent,
  getResistanceBonusOptions,
} from "./trait-registry.js";

// ── trait-resistance-ui.js ───────────────────────────────────────────
export {
  buildResistanceBonusSection,
  readResistanceBonusSelections,
  buildResistanceBonusMods,
} from "./trait-resistance-ui.js";

// ── trait-automation.js ──────────────────────────────────────────────
export {
  postDiseasedCheckCard,
  postRegenerationPrompt,
} from "./trait-automation.js";

// ── awareness-talents.js ─────────────────────────────────────────────
export {
  adjustSensePenalty,
  applySenseLossPenaltyAdjustments,
  applyKeenIntuitionToResult,
  applyHyperAwarenessToResult,
} from "./awareness-talents.js";

// ── combat-proximity.js ──────────────────────────────────────────────
export {
  getActorCanvasToken,
  getMeleeReachMeters,
  isWithinMeleeRange,
  countOpponentsInMeleeRange,
  anyOtherTokensInMeleeOfEither,
  hasAllyWithTalentInMeleeOfOpponent,
  hasOpponentWithTalentInMeleeRange,
} from "./combat-proximity.js";

// ── combat-talents.js ────────────────────────────────────────────────
export {
  applyAttackerTalentPreTN,
  getDefenseTalentOverrides,
  getEvadeOverrideContext,
  promptDoSReplacement,
  applyDefenderTalentTNMods,
  applyCombatTalentDoSAdjustments,
  applyCombatTalentDoSAdjustmentsUnopposed,
  getEnemyWoundThresholdDelta,
  applyTalentDamageModifiers,
} from "./combat-talents.js";

// ── intellectual-talents.js ──────────────────────────────────────────
export {
  applyIntellectualTalentDoSOverrides,
  getPredictionInitiativeAgiBonus,
  listGroupActorsForMember,
  listTacticianInitiativeProvidersForActor,
} from "./intellectual-talents.js";

// ── mobility-talents.js ──────────────────────────────────────────────
export {
  getArmoredAgilityAcrobaticsBonus,
  shouldDeferEvadeApForStepAside,
  activateHardTargetEffect,
  recordAssassinStrikeAoOBlock,
  isActorBlockedFromAoOAgainstTarget,
} from "./mobility-talents.js";

// ── resilience-talents.js ────────────────────────────────────────────
export {
  getWallOfSteelArmorItemBonus,
  getWallOfSteelShieldBlockBonus,
  applyIronWillReroll,
} from "./resilience-talents.js";

// ── social-talents.js ────────────────────────────────────────────────
export {
  validateInspireHeroismAvailability,
  handleInspireHeroismActivation,
} from "./social-talents.js";

// ── general-talents.js ───────────────────────────────────────────────
export {
  hasGrandmasterForSkill,
  getGeneralTalentRerollEligibility,
  rerollSkillTestFromChatMessage,
} from "./general-talents.js";

// ── racial-talents.js ────────────────────────────────────────────────
export {
  registerRacialTalentsAutomation,
  canApplyCharGenGatedImperialTalents,
  clearRacialTalentUsageOnRest,
  applyRacialTalentDerivedBonuses,
  applyRacialTalentPostSpeedDerived,
  validateRacialActivationAvailability,
  handleRacialTalentActivation,
  handleRacialPowerActivation,
  applyRacialTalentAttackPreTN,
} from "./racial-talents.js";

// ── spellcasting-talents.js ──────────────────────────────────────────
export {
  registerSpellcastingTalentHooks,
  isActivatableSpellcastingTalent,
  activateSpellcastingTalent,
  getSpellcastingTalentState,
  setSpellcastingPrimedState,
  clearSpellcastingPrimedState,
  applySpellcastingTalentModifiers,
  applyTalentSummaryToProfile,
  handlePostCastTalentConsumption,
} from "./spellcasting-talents.js";

// ── chapter4-catalog.js ───────────────────────────────────────────────────────
export {
  CHAPTER4_AUTOMATION_CLASS,
  CHAPTER4_CATALOG,
  getChapter4Catalog,
  getChapter4TalentEntry,
} from "./chapter4-catalog.js";

// ── talent-learning.js ────────────────────────────────────────────────────────
export {
  TALENT_LEARNING_MODE,
  TALENT_NO_GOVERNING_COST_RULE,
  getTalentLearningMode,
  getTalentNoGoverningCostRule,
  normalizeTalentLevel,
  parseGoverningCharacteristics,
  parseTalentRequirements,
  validateTalentLearning,
  notifyTalentLearningResult,
  applyTalentLearningXpCost,
} from "./talent-learning.js";

// ── _primitives.js (public-facing helpers) ──────────────────────────
export { _canPromptForActor } from "./_primitives.js";

// ── Sub-barrels ──────────────────────────────────────────────────────
export * from "./features/index.js";
export * from "./weapon-expertise/index.js";
