/**
 * Shared card-state result commit for skill opposed attacker/defender lanes.
 */

import { _getMessageState } from "../core/schema.js";
import { _resolveOutcome, _executeSpecialActionIfWinner } from "../core/helpers.js";
import { _maybeResolveBothCritSuccessRollOff } from "../resolve.js";

export async function commitLaneResult({
  message,
  data,
  side,
  res,
  lanePatch,
  attacker,
  defender,
  batchedUpdate = false,
  isCommittedRoll = false
} = {}) {
  const freshMessage = game.messages.get(message.id) ?? message;
  const freshData = (batchedUpdate && isCommittedRoll)
    ? data
    : (_getMessageState(freshMessage) ?? data);

  const otherSide = (side === "attacker") ? "defender" : "attacker";
  freshData[side] = freshData[side] ?? {};
  freshData[side].skillUuid = lanePatch?.skillUuid;
  freshData[side].skillLabel = lanePatch?.skillLabel;
  freshData[side].declared = lanePatch?.declared;
  freshData[side].tn = lanePatch?.tn;
  if (lanePatch?.request) freshData[side].request = lanePatch.request;

  freshData[side].result = {
    rollTotal: res.rollTotal,
    target: res.target,
    isSuccess: res.isSuccess,
    degree: res.degree,
    textual: res.textual,
    isCriticalSuccess: res.isCriticalSuccess,
    isCriticalFailure: res.isCriticalFailure
  };

  if (freshData[otherSide]?.result) {
    freshData.outcome = _resolveOutcome(freshData);
    await _maybeResolveBothCritSuccessRollOff({ message: freshMessage, data: freshData, attacker, defender });
    await _executeSpecialActionIfWinner(freshData);
  }

  return { freshMessage, freshData };
}

