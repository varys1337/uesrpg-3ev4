/**
 * src/core/time/effect-duration.js
 *
 * Central helpers for building Active Effect duration objects.
 *
 * Foundry duration semantics (EffectDurationData):
 *  - Real-time: { startTime, seconds }
 *  - Combat-time: { combat, startRound, startTurn, rounds?, turns? }
 */

function _num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function _getActorCombatant(combat, actor) {
  if (!combat || !actor) return null;

  // Prefer the documented helper when present.
  if (typeof combat.getCombatantsByActor === "function") {
    const arr = combat.getCombatantsByActor(actor);
    return Array.isArray(arr) ? (arr[0] ?? null) : null;
  }

  const combatants = Array.from(combat.combatants ?? []);
  const found = combatants.find(c => c?.actor?.id === actor.id || c?.actorId === actor.id);
  return found ?? null;
}

/**
 * Build a Foundry Active Effect duration object.
 *
 * @param {object} params
 * @param {Actor} params.actor
 * @param {number|null} [params.seconds]
 * @param {number|null} [params.rounds]
 * @param {number|null} [params.turns]
 * @param {boolean} [params.preferCombat=true] If combat is active and the actor is a combatant, anchor to combat.
 * @returns {object} EffectDurationData-compatible object
 */
export function buildEffectDuration({ actor, seconds = null, rounds = null, turns = null, preferCombat = true } = {}) {
  const dur = {};

  const sec = seconds == null ? null : _num(seconds, null);
  const rnd = rounds == null ? null : _num(rounds, null);
  const trn = turns == null ? null : _num(turns, null);

  const combat = preferCombat ? (game?.combat ?? null) : null;
  const inCombat = Boolean(combat?.started);

  if (inCombat && actor) {
    const combatant = _getActorCombatant(combat, actor);
    if (combatant) {
      dur.combat = combat.id ?? null;
      dur.startRound = _num(combat.round, 0);
      dur.startTurn = _num(combat.turn, 0);

      if (rnd != null && Number.isFinite(rnd) && rnd > 0) dur.rounds = rnd;
      if (trn != null && Number.isFinite(trn) && trn > 0) dur.turns = trn;

      // Combat-anchored durations ignore seconds.
      return dur;
    }
  }

  // Real-time anchor
  dur.startTime = _num(game?.time?.worldTime, 0);
  if (sec != null && Number.isFinite(sec) && sec > 0) dur.seconds = sec;
  return dur;
}
