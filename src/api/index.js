/**
 * src/api/index.js — Public API barrel for UESRPG 3ev4
 *
 * Single-import entry point for macros, modules, and downstream consumers.
 * Re-exports canonical implementations from their source modules.
 *
 * Usage (from a Foundry macro or external module):
 *   import { AttackTracker, requestUpdateDocument } from "systems/uesrpg-3ev4/src/api/index.js";
 *
 * Runtime namespace (game.uesrpg.*) continues to be populated in
 * src/system.js ("ready") and src/hooks/init.js ("init") for console /
 * non-ESM access.  This barrel provides the static-import equivalent.
 */

// ─── Authority Proxy (permission-safe mutations) ───────────────────────────
export {
  registerAuthorityProxy,
  requestUpdateDocument,
  requestCreateActiveEffect,
  requestCreateEmbeddedDocuments,
  requestUpdateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
  requestUpdateChatMessage,
  getMessageAuthorId,
  canUserUpdateChatMessage,
  sanitizeChatMessageUpdatePayload,
  isChatMessageUpdateFresh
} from "../utils/authority-proxy.js";

// ─── Documents ─────────────────────────────────────────────────────────────
export { SimpleActor } from "../core/documents/actor.js";
export { SimpleItem } from "../core/documents/item.js";

// ─── Combat ────────────────────────────────────────────────────────────────
export { AttackTracker } from "../core/combat/attack-tracker.js";
export { DAMAGE_TYPES } from "../core/combat/damage-automation.js";

// ─── Stamina ───────────────────────────────────────────────────────────────
export {
  openStaminaDialog,
  getActiveStaminaEffect,
  consumeStaminaEffect,
  STAMINA_EFFECT_KEYS
} from "../core/stamina/stamina-dialog.js";

export {
  applyPhysicalExertionBonus,
  applyPowerAttackBonus,
  applySprintBonus,
  applyPowerDrawBonus,
  applyPowerBlockBonus,
  applyPhysicalExertionToSkill,
  hasStaminaEffect
} from "../core/stamina/stamina-integration-hooks.js";

// ─── Magic ─────────────────────────────────────────────────────────────────
export {
  resolveSpellProfile,
  summarizeSpellProfile
} from "../core/magic/spell-profile.js";

export { SpellCastingService } from "../core/magic/casting-service.js";

// ─── Active Effects ────────────────────────────────────────────────────────
export { evaluateAEModifierKeys } from "../core/active-effects/modifier-evaluator.js";

// ─── Skills ────────────────────────────────────────────────────────────────
export { computeSkillTN } from "../core/skills/skill-tn.js";

// ─── Coercion Helpers ──────────────────────────────────────────────────────
export { _num, _numOrNull, _bool, _str, _strTrim, _lower } from "../utils/coerce.js";

// ─── Rules Engine ──────────────────────────────────────────────────────────
export { isPredicate, evaluatePredicate } from "../core/rules/predicate.js";
