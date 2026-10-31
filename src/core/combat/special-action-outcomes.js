import { createChatOutcome, getOutcomeApplicationMode } from "../config/outcome-application-policy.js";
import { planSpecialActionSource, planSpecialAdvantageSource } from "./special-action-operations.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { getSpecialActionById } from "../config/special-actions.js";
import { _getDefenderEntries, _getDefenderOutcome, _getDefenderResolutionState } from "./opposed/schema.js";

export function materializeSpecialActionOutcome(plan) {
  return { ...createChatOutcome({ adapter: "combat.special", kind: "effect", sourceActorUuid: plan.payload.actorUuid,
    targetUuid: plan.targetUuid, payload: plan.payload, label: getSpecialActionById(plan.payload.specialActionId)?.name ?? plan.payload.specialActionId }),
  id: plan.operation.id, operation: plan.operation, status: plan.status ?? "pending", autoEligible: plan.autoEligible === true,
  ...(plan.operation.legacy === "review" ? { error: "Historical execution has no reliable effect receipt; GM review is required." } : {}) };
}

export function discoverSpecialActionOutcomes(message, flags = message?.flags?.[SYSTEM_ID] ?? {}) {
  const entries = flags.chatOutcomes?.version === 1 && Array.isArray(flags.chatOutcomes.entries) ? flags.chatOutcomes.entries : [];
  const added = [];
  for (const sourceKind of ["skillOpposed", "specialActionOpposed"]) {
    const state = flags[sourceKind]?.state;
    if (!state?.outcome) continue;
    const legacy = state.context?.specialActionOperationsVersion === 1 ? null
      : flags.specialActionOutcomeAutomation?.status === "complete"
        && Number(flags.specialActionOutcomeAutomation.revision) === Number(state.context?.updatedSeq ?? state.context?.updatedAt ?? 0) ? "complete" : "review";
    added.push(...planSpecialActionSource({ sourceUuid: message.uuid ?? `ChatMessage.${message.id}`, sourceKind, state,
      entries: [...entries, ...added], autoEligible: getOutcomeApplicationMode() === "automatic", legacy }).map(materializeSpecialActionOutcome));
  }
  // The selection is saved before the mode prompt. A disconnect in that gap
  // must remain visible, without inventing whether AP or a child card existed.
  if (flags.opposed) {
    const data = foundry.utils.deepClone(flags.opposed);
    for (const defender of _getDefenderEntries(data)) {
      const resolution = _getDefenderResolutionState(data, defender);
      for (const role of ["attacker", "defender"]) {
        const selected = role === "attacker" ? resolution.advantageResolution.attacker?.specialActionsSelected
          : resolution.defenderAdvantage.choice?.specialActionsSelected;
        const actor = role === "attacker" ? data.attacker : defender;
        const opponent = role === "attacker" ? defender : data.attacker;
        for (const [index, specialActionId] of (Array.isArray(selected) ? selected : []).entries()) {
          const plan = planSpecialAdvantageSource({ sourceUuid: message.uuid ?? `ChatMessage.${message.id}`,
            state: { ...data, defender, outcome: _getDefenderOutcome(data, defender) }, role, specialActionId, index,
            actorUuid: actor?.actorUuid, opponentUuid: opponent?.actorUuid, actorTokenUuid: actor?.tokenUuid,
            opponentTokenUuid: opponent?.tokenUuid, entries: [...entries, ...added] });
          if (plan) added.push(materializeSpecialActionOutcome(plan));
        }
      }
    }
  }
  return added;
}

/** Used by native and sealed card writes, after permission/revision validation. */
export function stampSpecialActionCardUpdate(message, payload) {
  const patch = payload.flags?.[SYSTEM_ID];
  if (!patch || !["skillOpposed", "specialActionOpposed"].some(key => patch[key])) return payload;
  const previous = message.flags?.[SYSTEM_ID] ?? {};
  const envelope = patch.chatOutcomes ?? previous.chatOutcomes;
  if (envelope && (envelope.version !== 1 || !Array.isArray(envelope.entries))) throw new Error("Unsupported outcome envelope; it was not overwritten.");
  const before = discoverSpecialActionOutcomes(message, previous);
  const flags = { ...previous, ...patch, chatOutcomes: { version: 1, entries: [...(envelope?.entries ?? []), ...before] } };
  const added = [...before, ...discoverSpecialActionOutcomes(message, flags)];
  if (added.length) payload.flags[SYSTEM_ID].chatOutcomes = { version: 1,
    revision: Number(envelope?.revision ?? 0) + 1, entries: [...(envelope?.entries ?? []), ...added] };
  return payload;
}
