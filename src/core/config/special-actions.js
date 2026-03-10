/**
 * src/core/config/special-actions.js
 *
 * Canonical Special Actions registry (UESRPG 3ev4, Chapter 5 - Advanced Mechanics).
 *
 * Rules used by automation:
 * - All Special Actions are always available from the sheet "Special Actions" list.
 * - Only Special Actions marked as known in the actor's *active combat style* may be offered
 *   as Advantage spend options.
 * - Action type matters:
 *   - Primary: only usable on the actor's own turn.
 *   - Secondary: usable on the actor's own turn OR as a reaction.
 */

/** @typedef {"primary"|"secondary"} SpecialActionType */

/**
 * @type {Readonly<Array<Readonly<{id: string, name: string, actionType: SpecialActionType}>>>}
 */
export const SPECIAL_ACTIONS = Object.freeze([
  Object.freeze({ id: "arise", name: "Arise", actionType: "secondary" }),
  Object.freeze({ id: "bash", name: "Bash", actionType: "primary" }),
  // Chapter 5: user-confirmed Secondary
  Object.freeze({ id: "blindOpponent", name: "Blind Opponent", actionType: "secondary" }),
  Object.freeze({ id: "disarm", name: "Disarm", actionType: "primary" }),
  Object.freeze({ id: "feint", name: "Feint", actionType: "primary" }),
  Object.freeze({ id: "forceMovement", name: "Force Movement", actionType: "primary" }),
  Object.freeze({ id: "grapple", name: "Grapple", actionType: "primary" }),
  Object.freeze({ id: "resist", name: "Resist", actionType: "secondary" }),
  Object.freeze({ id: "trip", name: "Trip", actionType: "secondary" }),
  // Homebrew — Reach & Length Overhaul
  Object.freeze({ id: "inClose", name: "In Close", actionType: "secondary" })
]);

// Build O(1) lookup; warn on duplicate IDs (guards against future registry corruption).
const _byId = Object.create(null);
for (const sa of SPECIAL_ACTIONS) {
  if (_byId[sa.id] !== undefined) {
    console.warn(`UESRPG | Special Actions: duplicate id "${sa.id}" detected in registry.`);
  }
  _byId[sa.id] = sa;
}

/**
 * Frozen null-prototype object for O(1) id → entry lookups.
 * @type {Readonly<Record<string, Readonly<{id:string,name:string,actionType:SpecialActionType}>>>}
 */
export const SPECIAL_ACTIONS_BY_ID = Object.freeze(_byId);

/**
 * @param {string} id
 * @returns {Readonly<{id:string,name:string,actionType:SpecialActionType}>|null}
 */
export function getSpecialActionById(id) {
  const key = String(id ?? "").trim();
  if (!key) return null;
  return SPECIAL_ACTIONS_BY_ID[key] ?? null;
}
