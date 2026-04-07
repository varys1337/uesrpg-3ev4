/**
 * src/core/mass-warfare/index.js
 *
 * Public barrel for the Mass Warfare profile subsystem.
 */

export {
  registerWarfareProfile,
  resolveWarfareProfile,
  listWarfareProfiles,
  DEFAULT_PROFILE_ID,
} from "./profile-registry.js";

export {
  UESRPG_0_2_PROFILE,
  RANKS,
  CATEGORIES,
  TRADITIONS,
  APPAREL,
  GEAR_TIERS,
  MOUNTS,
  RACIAL_PRESETS,
  EQUIPMENT_CATALOG,
  IMPLEMENT_CATALOG,
} from "./profiles/uesrpg-0_2.js";
export { LEGACY_STUB_PROFILE } from "./profiles/legacy-stub.js";

export { resolveClash }             from "./clash/engine.js";
export { renderClashCard }          from "./clash/card.js";
export { createClashPending, readClashState } from "./clash/pending.js";
export { handleClashCommit }        from "./clash/commit.js";
export { maybeAutoRollClash }       from "./clash/auto-roll.js";
export { registerClashChatActions } from "./clash/chat-actions.js";
export { rollDisciplineForUnit }    from "./clash/discipline-roll.js";
export { buildWarfareDisciplineTN } from "./tn.js";
export {
  resolveWarfareUnitReference,
  resolveWarfareConditionTarget,
  applyWarfareConditionDelta,
  maybeInitializeWarfareCondition,
  WARFARE_CONDITION_INIT_FLAG,
} from "./condition-target.js";
export {
  handleWarfareAction,
  rollWarfareRangedAttack,
  castWarfareSpell,
  startMixedWarfareOpposed,
  transformWarfareActionEntries,
  hasWarfareActionEffect,
  consumeJoinFrayNextClash,
  consumeHoldNextDefend,
  hasHoldNextDefend,
  clearCommanderAttachment,
  registerWarfareAttachmentHooks,
  WARFARE_EFFECT_KEYS,
} from "./actions.js";
