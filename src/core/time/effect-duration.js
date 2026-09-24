/**
 * src/core/time/effect-duration.js
 *
 * Central helpers for building Active Effect duration objects.
 *
 * Foundry v14 duration semantics (EffectDurationData):
 *  - { value, units, expiry }
 * Effect start anchors are owned by the ActiveEffect `start` schema.
 */

import { _num } from "../../utils/coerce.js";
import { normalizeActiveEffectDurationV14 } from "../active-effects/effect-duration-v14.js";

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
  const sec = seconds == null ? null : _num(seconds, null);
  const rnd = rounds == null ? null : _num(rounds, null);
  const trn = turns == null ? null : _num(turns, null);

  const combat = preferCombat ? (game?.combat ?? null) : null;
  const inCombat = Boolean(combat?.started);

  if (inCombat && actor) {
    const combatant = _getActorCombatant(combat, actor);
    if (combatant) {
      if (rnd != null && Number.isFinite(rnd) && rnd > 0) {
        return normalizeActiveEffectDurationV14({ value: rnd, units: "rounds", expiry: "turnEnd" });
      }
      if (trn != null && Number.isFinite(trn) && trn > 0) {
        return normalizeActiveEffectDurationV14({ value: trn, units: "turns", expiry: "turnEnd" });
      }
    }
  }

  if (sec != null && Number.isFinite(sec) && sec > 0) {
    return normalizeActiveEffectDurationV14({ value: sec, units: "seconds", expiry: null });
  }
  if (rnd != null && Number.isFinite(rnd) && rnd > 0) {
    return normalizeActiveEffectDurationV14({ value: rnd, units: "rounds", expiry: "turnEnd" });
  }
  if (trn != null && Number.isFinite(trn) && trn > 0) {
    return normalizeActiveEffectDurationV14({ value: trn, units: "turns", expiry: "turnEnd" });
  }
  return normalizeActiveEffectDurationV14({});
}
