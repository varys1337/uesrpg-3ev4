import { resolveCombatantForActor } from "../../utils/document-resolution.js";

function _str(value) {
  return String(value ?? "").trim();
}

/**
 * Determine whether a Combat document is the active started encounter.
 *
 * Foundry v14 documents Combat#started and Combat#isActive. Treat a missing
 * isActive value as usable for test harnesses, but never treat an explicit
 * false as active.
 *
 * @param {Combat|null} combat
 * @returns {boolean}
 */
export function isStartedActiveCombat(combat = game?.combat ?? null) {
  return Boolean(combat?.id && combat?.started === true && combat?.isActive !== false);
}

/**
 * Determine whether AP and attack-count economy should apply to this actor.
 *
 * @param {Actor|null} actor
 * @param {{combat?: Combat|null, tokenUuid?: string|null, combatantId?: string|null, actorUuid?: string|null}} options
 * @returns {boolean}
 */
export function isActorInStartedCombatEncounter(actor, {
  combat = game?.combat ?? null,
  tokenUuid = null,
  combatantId = null,
  actorUuid = null
} = {}) {
  if (!actor || !isStartedActiveCombat(combat)) return false;

  const combatant = resolveCombatantForActor(combat, actor, {
    tokenUuid: _str(tokenUuid) || null,
    combatantId: _str(combatantId) || null,
    actorUuid: _str(actorUuid) || _str(actor?.uuid) || null,
    combatId: _str(combat?.id) || null
  });

  return Boolean(combatant);
}

/** Capture the active combat step relevant to an actor, or null outside that encounter. */
export function getActorCombatStep(actor, { combat = game?.combat ?? null } = {}) {
  if (!isActorInStartedCombatEncounter(actor, { combat })) return null;
  return { id: combat.id, round: combat.round, turn: combat.turn, combatantId: combat.combatant?.id ?? null };
}

/** Compare a saved step with the current tracked step; null means outside tracked combat. */
export function isActorCombatStepCurrent(actor, step) {
  const current = getActorCombatStep(actor);
  if (!step) return current === null;
  return Boolean(current && current.id === step.id && current.round === step.round
    && current.turn === step.turn && current.combatantId === step.combatantId);
}
