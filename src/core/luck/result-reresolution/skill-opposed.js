import { cloneFlagState } from "../../../utils/clone.js";
import { SYSTEM_ID } from "../../constants.js";
import { _updateCard as updateSkillOpposedCard } from "../../skills/opposed-workflow/core/card-updater.js";
import { _resolveOutcome as resolveSkillOutcome } from "../../skills/opposed-workflow/core/helpers.js";
import { _maybeResolveBothCritSuccessRollOff as resolveSkillRollOff } from "../../skills/opposed-workflow/resolve.js";
import { _resolveActor as resolveSkillActor } from "../../skills/opposed-workflow/core/docs.js";
import { applyExtraLuckContext, didPersistLuckResult, getLiveLuckMessage } from "./shared.js";

export function isSkillOpposedUnsafe(data) {
  const specialActionId = String(data?.specialActionContext?.id ?? data?.specialActionId ?? "").trim();
  return Boolean(specialActionId && data?.status === "resolved");
}

export async function applyLuckSkillOpposedMutation(message, side, newResult, extraContext, classifyMessage) {
  const live = getLiveLuckMessage(message);
  const raw = live?.flags?.[SYSTEM_ID]?.skillOpposed;
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
    data.outcome = resolveSkillOutcome(data);
    await resolveSkillRollOff({
      message: live,
      data,
      attacker: resolveSkillActor(data.attacker.actorUuid),
      defender: resolveSkillActor(data.defender.actorUuid),
    });
    data.status = "resolved";
    data.context.phase = "resolved";
    if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
  } else {
    data.status = "pending";
    data.context.phase = "resolving";
  }

  applyExtraLuckContext(data, extraContext);
  await updateSkillOpposedCard(live, data);
  return didPersistLuckResult(live, "skillOpposed", side, newResult, classifyMessage);
}
