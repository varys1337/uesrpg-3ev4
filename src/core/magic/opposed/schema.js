/**
 * @module magic/opposed/schema
 *
 * src/core/magic/opposed/schema.js
 *
 * State access, manipulation helpers, and generic utilities for magic opposed workflow.
 * Provides consistent access to the nested flag structure storing card state,
 * plus document/actor/token resolution helpers.
 */

/**
 * Action/outcome context passed between opposed workflow handlers.
 *
 * Constructed by `dispatchAction()` and consumed by `handleDefenderRoll`,
 * `handleBlockResolve`, `resolveOutcome`, etc.
 *
 * @typedef {object} MagicOpposedContext
 * @property {ChatMessage}  message        - The chat message document
 * @property {object}       data           - The magic opposed card state ({@link MagicOpposedCardState})
 * @property {Actor}        attacker       - Resolved attacker actor
 * @property {object}       defender       - Selected defender entry from card state
 * @property {Actor}        defenderActor  - Resolved defender actor
 * @property {number}       defenderIndex  - Index of selected defender in defenders array
 * @property {Array}        defenders      - Full defenders array from card state
 * @property {boolean}      isMulti        - Whether multi-defender scenario
 * @property {boolean}      bankMode       - Whether bank choices are enabled
 * @property {object}       opts           - Original action options passed to dispatchAction
 * @property {object}       workflow       - Reference to MagicOpposedWorkflow object
 * @property {Item|null}    spell          - Resolved spell item
 * @property {Function}     resolveActor   - schema.resolveActor utility
 * @property {Function}     _updateCard    - (msg, data) => Promise — update the chat card
 * @property {Function}     _markResolutionPhase   - schema.markResolutionPhase utility
 * @property {Function}     _allDefendersCommitted - schema.allDefendersCommitted utility
 */

/**
 * Persisted card state for a magic opposed workflow.
 *
 * Stored as `ChatMessage.flags["uesrpg-3ev4"].magicOpposed`.
 *
 * @typedef {object} MagicOpposedCardState
 * @property {object}  context    - Workflow metadata (schema version, phase, timestamps, AoE config)
 * @property {string}  status     - "pending" | "resolved"
 * @property {string}  mode       - Always "magic"
 * @property {object}  attacker   - Attacker state (actor/token UUIDs, spell info, roll result, TN)
 * @property {Array<object>} defenders - Defender entries (actor UUID, defense type, roll, outcome)
 * @property {object|null}   defender  - First/selected defender entry (single-defender shorthand)
 * @property {object|null}   outcome   - Outcome data (single-defender mode only)
 */

import { canUserRollActor } from "../../../utils/permissions.js";
import { cloneFlagState } from "../../../utils/clone.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { getActorFromResolvedDocument, resolveUuidSync } from "../../../utils/uuid-cache.js";

const _FLAG_NS = FLAG_SCOPE;
const _FLAG_KEY = "magicOpposed";

/**
 * Get the persistent state from a chat message.
 * @param {ChatMessage} message
 * @returns {object|null}
 */
export function getMessageState(message) {
  const raw = message?.flags?.[_FLAG_NS]?.[_FLAG_KEY];
  if (!raw || typeof raw !== "object") return null;
  if (Number(raw.version) >= 1 && raw.state) return cloneFlagState(raw.state);
  if (raw.attacker && raw.defender) return cloneFlagState(raw);
  return null;
}

/**
 * Get array of defender entries from data.
 * @param {object} data
 * @returns {Array}
 */
export function getDefenderEntries(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.defenders) && data.defenders.length) return data.defenders;
  if (data.defender && typeof data.defender === "object") return [data.defender];
  return [];
}

/**
 * Check if data has multiple defenders.
 * @param {object} data
 * @returns {boolean}
 */
export function isMultiDefender(data) {
  const list = getDefenderEntries(data);
  return list.length > 1;
}

/**
 * Resolve defender index from opts.
 * @param {object} data
 * @param {object} opts
 * @returns {number|null}
 */
export function resolveDefenderIndex(data, opts = {}) {
  const list = getDefenderEntries(data);
  if (!list.length) return null;

  const idx = Number(opts.defenderIndex ?? opts.defenderIdx ?? NaN);
  if (Number.isInteger(idx) && idx >= 0 && idx < list.length) return idx;

  const tokenUuid = String(opts.defenderTokenUuid ?? "").trim();
  if (tokenUuid) {
    const tokenIndex = list.findIndex(def => String(def?.tokenUuid ?? "") === tokenUuid);
    if (tokenIndex >= 0) return tokenIndex;
  }

  const actorUuid = String(opts.defenderActorUuid ?? opts.defenderUuid ?? "").trim();
  if (actorUuid) {
    const actorIndex = list.findIndex(def => String(def?.actorUuid ?? "") === actorUuid);
    if (actorIndex >= 0) return actorIndex;
  }

  return 0;
}

/**
 * Select defender entry and related metadata.
 * @param {object} data
 * @param {object} opts
 * @returns {{defender: object|null, defenderIndex: number|null, defenders: Array, isMulti: boolean}}
 */
export function selectDefenderEntry(data, opts = {}) {
  const defenders = getDefenderEntries(data);
  const isMulti = isMultiDefender(data);
  const defenderIndex = resolveDefenderIndex(data, opts);
  const defender = (defenderIndex != null) ? defenders[defenderIndex] : null;
  if (defender) data.defender = defender;
  return { defender, defenderIndex, defenders, isMulti };
}

/**
 * Get outcome for a specific defender.
 * @param {object} data
 * @param {object} defender
 * @returns {object|null}
 */
export function getDefenderOutcome(data, defender) {
  return isMultiDefender(data) ? (defender?.outcome ?? null) : (data?.outcome ?? null);
}

/**
 * Set outcome for a specific defender.
 * @param {object} data
 * @param {object} defender
 * @param {object} outcome
 */
export function setDefenderOutcome(data, defender, outcome) {
  if (isMultiDefender(data)) {
    if (defender) defender.outcome = outcome;
  } else {
    data.outcome = outcome;
  }
}

/**
 * Get stored damage data for a specific defender.
 * @param {object} data - Card state
 * @param {object} defender - Defender entry
 * @returns {object|null}
 */
export function getMagicDefenderDamage(data, defender) {
  return isMultiDefender(data) ? (defender?.damage ?? null) : (data?.damage ?? null);
}

/**
 * Store damage data on a specific defender entry (or top-level for single-defender).
 * @param {object} data - Card state
 * @param {object} defender - Defender entry
 * @param {object} damageObj - Damage data object for inline panel rendering
 */
export function setMagicDefenderDamage(data, defender, damageObj) {
  if (isMultiDefender(data)) {
    if (defender) defender.damage = damageObj;
  } else {
    data.damage = damageObj;
  }
}

/**
 * Mark resolution phase based on all defenders having outcomes.
 * @param {object} data
 */
export function markResolutionPhase(data) {
  const allResolved = getDefenderEntries(data).every(def => Boolean(getDefenderOutcome(data, def)));
  data.context = data.context ?? {};
  data.context.phase = allResolved ? "resolved" : "awaiting-defense";
}

/**
 * Check if bank choices are enabled for this card.
 * @param {object} data
 * @returns {boolean}
 */
export function isBankChoicesEnabledForData(data) {
  // Magic banked choices enabled by default (same as combat)
  return true;
}

/**
 * Ensure banked scaffold exists in data.
 * @param {object} data
 * @returns {object}
 */
export function ensureBankedScaffold(data) {
  data.context = data.context ?? {};
  data.attacker = data.attacker ?? {};
  data.defender = data.defender ?? {};
  if (!Array.isArray(data.defenders)) {
    data.defenders = (data.defender && typeof data.defender === "object") ? [data.defender] : [];
  }

  data.attacker.banked = (data.attacker.banked && typeof data.attacker.banked === "object") 
    ? data.attacker.banked 
    : { committed: false, committedAt: null, committedBy: null };

  const defenders = getDefenderEntries(data);
  for (const def of defenders) {
    def.banked = (def.banked && typeof def.banked === "object") 
      ? def.banked 
      : { committed: false, committedAt: null, committedBy: null };
  }

  return data;
}

function _attackerEffectivelyCommitted(data) {
  return Boolean(data?.attacker?.banked?.committed || data?.attacker?.result);
}

function _defenderEffectivelyCommitted(data, defender = null) {
  const def = defender ?? data?.defender;
  if (!def) return false;
  return Boolean(
    def?.banked?.committed ||
    def?.noDefense ||
    def?.result ||
    getDefenderOutcome(data, def)
  );
}

/**
 * Get bank commit state for attacker and defender.
 * @param {object} data
 * @param {object} defender
 * @returns {{aCommitted: boolean, dCommitted: boolean, bothCommitted: boolean}}
 */
export function getBankCommitState(data, defender = null) {
  ensureBankedScaffold(data);
  
  const aCommitted = _attackerEffectivelyCommitted(data);
  const def = defender ?? data.defender;
  // Use explicit commit flag and noDefense — NOT defenseType, which may
  // be pre-populated at card creation (e.g. characteristic-save).
  const dCommitted = _defenderEffectivelyCommitted(data, def);
  
  return {
    aCommitted,
    dCommitted,
    bothCommitted: aCommitted && dCommitted
  };
}

/**
 * Check if all defenders have committed.
 * @param {object} data
 * @returns {boolean}
 */
export function allDefendersCommitted(data) {
  if (!isMultiDefender(data)) {
    // Single defender: use standard bothCommitted check
    const state = getBankCommitState(data);
    return state.bothCommitted;
  }
  
  // Multi-defender: attacker must be committed AND all defenders must be committed
  const aCommitted = _attackerEffectivelyCommitted(data);
  if (!aCommitted) return false;
  
  const defenders = getDefenderEntries(data);
  return defenders.every(def => {
    if (!def) return true; // Skip null entries
    return _defenderEffectivelyCommitted(data, def);
  });
}

// ── Document Resolution Utilities (merged from util.js) ──────────────────────

/**
 * Resolve a UUID to a document.
 * @param {string} uuid
 * @returns {Document|null}
 */
export function resolveDoc(uuid) {
  return resolveUuidSync(uuid);
}

/**
 * Resolve a document or UUID to an Actor.
 * @param {Document|string} docOrUuid
 * @returns {Actor|null}
 */
export function resolveActor(docOrUuid) {
  const doc = typeof docOrUuid === "string" ? resolveDoc(docOrUuid) : docOrUuid;
  return getActorFromResolvedDocument(doc);
}

/**
 * Resolve a document or UUID to a Token.
 * @param {Document|string} docOrUuid
 * @returns {Token|null}
 */
export function resolveToken(docOrUuid) {
  const doc = typeof docOrUuid === "string" ? resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  if (doc.documentName === "Token") return doc;
  if (doc.documentName === "TokenDocument") return doc.object ?? null;
  return null;
}

/**
 * Require user has permission to roll for actor (with notification).
 * @param {User} user
 * @param {Actor} actor
 * @returns {boolean}
 */
export function requireUserCanRollActor(user, actor) {
  if (!canUserRollActor(user, actor)) {
    ui.notifications.warn("You do not have permission to perform this action.");
    return false;
  }
  return true;
}
