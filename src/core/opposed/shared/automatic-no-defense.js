import { getDefenderCommitAvailability } from "./defense-availability.js";
import { _resolveActorViaToken } from "../../combat/opposed/helpers/docs.js";
import { canUserRollActor } from "../../../utils/permissions.js";
import { FLAG_SCOPE } from "../../system/namespace.js";

const _pendingReconciliations = new Map();

/** Read flags, never rendered HTML. Completed/rolling cards cannot be reconciled. */
export function getPendingDefenseState(message) {
  const flags = message?.flags?.[FLAG_SCOPE];
  const raw = flags?.opposed ?? flags?.magicOpposed;
  const data = raw?.state ?? raw;
  if (!data || data.status === "resolved" || data.context?.autoRollStarted
    || data.context?.autoRollAborted || data.context?.unopposed || data.context?.noDefenseUnopposed) return null;
  const mode = flags?.opposed ? "combat" : "magic";
  if (data.context?.bankChoicesEnabled !== true) return null;
  return { data, mode, defenders: data.defenders?.length ? data.defenders : [data.defender].filter(Boolean) };
}

/** Route through the existing permission-gated No Defense action and updater.
 * Duplicate hooks share one task; each action rechecks availability inside its
 * serialized fresh-state mutation before changing a lane.
 */
export async function reconcileUnavailableDefenses(message, workflow) {
  if (!message?.id || !workflow) return;
  const key = message.uuid ?? message.id;
  if (_pendingReconciliations.has(key)) return _pendingReconciliations.get(key);
  const task = (async () => {
    const activeGM = game.users?.activeGM;
    if (activeGM && game.user?.id !== activeGM.id) return;
    const pending = getPendingDefenseState(game.messages?.get(message.id) ?? message);
    if (!pending) return;
    for (let index = 0; index < pending.defenders.length; index++) {
      const lane = pending.defenders[index];
      if (!lane || lane.result || lane.noDefense || lane.banked?.committed) continue;
      const actor = _resolveActorViaToken(lane.actorUuid, lane.tokenUuid);
      if (!canUserRollActor(game.user, actor)) continue;
      const gate = getDefenderCommitAvailability({ data: pending.data, defenderData: lane, defenderActor: actor, messageId: message.id, mode: pending.mode });
      if (gate.insufficientAP) await workflow.handleAction(message, "defender-commit-nodefense", {
        defenderIndex: index, automaticNoDefense: true
      });
    }
  })();
  _pendingReconciliations.set(key, task);
  try { return await task; } finally { if (_pendingReconciliations.get(key) === task) _pendingReconciliations.delete(key); }
}
