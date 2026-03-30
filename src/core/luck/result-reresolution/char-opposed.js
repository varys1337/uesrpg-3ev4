import { cloneFlagState } from "../../../utils/clone.js";
import { SYSTEM_ID } from "../../constants.js";
import { _updateCard as updateCharOpposedCard } from "../../characteristics/opposed/card-updater.js";
import { _resolveOutcome as resolveCharOutcome } from "../../characteristics/opposed/helpers.js";
import { _resolveActor as resolveCharActor } from "../../characteristics/opposed/docs.js";
import { _maybeResolveBothCritSuccessRollOff as resolveCharRollOff } from "../../characteristics/opposed-workflow.js";
import { applyExtraLuckContext, didPersistLuckResult, getLiveLuckMessage } from "./shared.js";

export async function applyLuckCharOpposedMutation(message, side, newResult, extraContext, classifyMessage) {
  const live = getLiveLuckMessage(message);
  const raw = live?.flags?.[SYSTEM_ID]?.charOpposed;
  if (!raw) return false;
  const data = cloneFlagState(raw.state ?? raw);
  if (side.role === "attacker") data.attacker.result = newResult;
  else if (data.defender) data.defender.result = newResult;
  else return false;

  data.outcome = null;
  data.context = data.context ?? {};
  if (data.context.rollOff) delete data.context.rollOff;
  if (data.context.resolvedAt) delete data.context.resolvedAt;

  if (data.attacker?.result && data.defender?.result) {
    data.outcome = resolveCharOutcome(data);
    await resolveCharRollOff({
      message: live,
      data,
      attacker: resolveCharActor(data.attacker.actorUuid),
      defender: resolveCharActor(data.defender.actorUuid),
    });
    data.status = "resolved";
    data.context.phase = "resolved";
    if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
  } else {
    data.status = "pending";
    data.context.phase = "resolving";
  }

  applyExtraLuckContext(data, extraContext);
  await updateCharOpposedCard(live, data);
  return didPersistLuckResult(live, "charOpposed", side, newResult, classifyMessage);
}
