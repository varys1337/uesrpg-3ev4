/**
 * src/core/characteristics/opposed/schema.js
 * State management and schema normalization for characteristic opposed workflow
 */

import { FLAG_NS, FLAG_KEY } from "./constants.js";

// ── JSDoc typedefs ────────────────────────────────────────────────────────

/**
 * @typedef {object} CharOpposedTN
 * @property {number} finalTN - The final target number after all modifiers.
 * @property {Array<{label: string, value: number}>} [breakdown] - Modifier breakdown for display.
 */

/**
 * @typedef {object} CharOpposedRollResult
 * @property {number}  rollTotal         - The d100 roll total.
 * @property {number}  target            - The TN used for this roll.
 * @property {boolean} isSuccess         - Whether the roll succeeded.
 * @property {number}  degree            - Degrees of success/failure.
 * @property {string}  textual           - Human-readable result label.
 * @property {boolean} isCriticalSuccess - Whether the result was a critical success.
 * @property {boolean} isCriticalFailure - Whether the result was a critical failure.
 */

/**
 * @typedef {object} CharOpposedSideState
 * @property {string}       actorUuid       - UUID of the actor on this side.
 * @property {string|null}  tokenUuid       - TokenDocument UUID (preferred) or Token UUID (legacy). Null when actor is not on a scene.
 * @property {string}       tokenName       - Display name (token name or actor name).
 * @property {string}       name            - Actor name.
 * @property {string}       charKey         - Characteristic key (e.g. "wp").
 * @property {string}       charLabel       - Human-readable characteristic label (e.g. "Willpower").
 * @property {{manualMod: number}|null} declared - Choices declared by the player. Null until committed.
 * @property {CharOpposedTN|null}         tn      - Computed TN object. Null until committed.
 * @property {CharOpposedRollResult|null} result  - Roll result. Null until rolled.
 * @property {number|null}  committedAt     - Timestamp (ms) when choices were committed. Null until committed.
 * @property {string}       [committedBy]   - User ID who committed choices.
 * @property {number}       [rolledAt]      - Timestamp (ms) when the roll was performed.
 * @property {string}       [rollMessageId] - Chat message ID for external roll banking.
 */

/**
 * @typedef {object} CharOpposedOutcome
 * @property {"attacker"|"defender"|"tie"} winner - Which side won.
 * @property {string} reason - Machine-readable reason for the outcome.
 * @property {string} text   - Human-readable outcome text shown on the card.
 */

/**
 * @typedef {object} CharOpposedContext
 * @property {string}   label                  - Display label for the card.
 * @property {string}   charKey                - Default characteristic key for the test.
 * @property {number}   ssModifier             - Spell Strength modifier applied to defender TN.
 * @property {number}   createdAt              - Timestamp (ms) of card creation.
 * @property {string}   createdBy              - User ID who created the card.
 * @property {object}   rollContext            - Roll context passed through opposed workflow helpers.
 * @property {string[]} rollOptions            - Roll option flags carried with the opposed workflow context.
 * @property {number}   [schemaVersion]        - Schema version stamp written by card-updater.
 * @property {number}   [updatedAt]            - Timestamp (ms) of last card update.
 * @property {string}   [updatedBy]            - User ID who performed the last update.
 * @property {number}   [updatedSeq]           - Monotonic update sequence number.
 * @property {boolean}  [autoRollStarted]      - Claim flag for banked auto-roll; prevents duplicate runs.
 * @property {string}   [autoRollClaimId]      - Unique ID for the banked auto-roll claim.
 * @property {number}   [autoRollStartedAt]    - Timestamp (ms) when banked auto-roll was claimed.
 * @property {string}   [autoRollStartedBy]    - User ID who claimed the banked auto-roll.
 * @property {string}   [autoRollStartedTrigger] - Trigger source ("hook" | "hook-no-gm" | "button").
 * @property {object}   [rollOff]              - Roll-off state for both-crit-success ties.
 */

/**
 * @typedef {object} CharOpposedState
 * @property {CharOpposedSideState}    attacker - Attacker (initiator) side state.
 * @property {CharOpposedSideState}    defender - Defender (target) side state.
 * @property {CharOpposedContext}      context  - Workflow context and card metadata.
 * @property {CharOpposedOutcome|null} outcome  - Resolved outcome. Null until both sides have rolled.
 * @property {string|null}             status   - Card status: null (pending/in-progress) or "resolved".
 */

// ── Schema helpers ────────────────────────────────────────────────────────

export function _normalizeCardFlag(raw) {
  if (raw && typeof raw === "object" && Number(raw.version) >= 1 && raw.state) {
    return { version: Number(raw.version), state: raw.state };
  }
  if (raw && typeof raw === "object" && raw.attacker && raw.defender) {
    return { version: 0, state: raw };
  }
  return { version: 0, state: null };
}

/**
 * @param {ChatMessage} message
 * @returns {CharOpposedState|null}
 */
export function _getMessageState(message) {
  const raw = message?.flags?.[FLAG_NS]?.[FLAG_KEY];
  const normalized = _normalizeCardFlag(raw);
  return normalized.state;
}

/**
 * @param {CharOpposedState} data
 * @returns {boolean}
 */
export function _bothSidesCommitted(data) {
  return Boolean(data?.attacker?.committedAt) && Boolean(data?.defender?.committedAt);
}
