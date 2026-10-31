import { getSpecialActionById } from "../config/special-actions.js";
import { stableStringify, documentStateFingerprint } from "../../utils/authority-proxy/shared.js";

export const SPECIAL_ACTION_OPERATION_VERSION = 1;

/** Read receipt stages whether dotted keys are stored flat or expanded by Foundry. */
export function specialActionStageEntries(stages) {
  const entries = new Map();
  const visit = (value, prefix) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (prefix && typeof value.status === "string") {
      const previous = entries.get(prefix);
      entries.set(prefix, previous && stableStringify(previous) !== stableStringify(value)
        ? { status: "partial", error: "Conflicting representations of this stage require GM review." } : value);
      return;
    }
    const children = Object.entries(value).sort(([a], [b]) => Number(a.includes(".")) - Number(b.includes(".")));
    for (const [key, child] of children) visit(child, prefix ? `${prefix}.${key}` : key);
  };
  visit(stages, "");
  return Array.from(entries);
}

export function getSpecialActionStage(stages, key) {
  return specialActionStageEntries(stages).find(([name]) => name === key)?.[1] ?? null;
}

/** Plain-data contracts only. Document access and writes belong to the outcome service. */
export function specialActionIntent(payload = {}) {
  payload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  return {
    specialActionId: String(payload.specialActionId ?? ""),
    actorUuid: String(payload.actorUuid ?? ""),
    targetUuid: payload.targetUuid || null,
    actorTokenUuid: payload.actorTokenUuid || null,
    targetTokenUuid: payload.targetTokenUuid || null,
    isAutoWin: payload.isAutoWin === true,
    opposedResult: payload.opposedResult ? {
      winner: payload.opposedResult.winner ?? null,
      degrees: payload.opposedResult.degrees ?? payload.opposedResult.degree ?? 0,
    } : null,
    followUp: payload.followUp ?? null,
    launch: payload.launch ?? null,
    activation: payload.activation ?? null,
    ...(payload.snare ? { snare: payload.snare } : {}),
  };
}

export function specialActionOperationId({ sourceUuid, sourceKind, resultRevision, slot, intent }) {
  return ["special", sourceUuid, sourceKind, resultRevision, slot, intent.specialActionId].map(value => encodeURIComponent(String(value))).join(":");
}

export function createSpecialActionOperation({ sourceUuid, sourceKind = "standalone", resultRevision = 1, slot = "action", signature = "", payload, legacy = null }) {
  if (!sourceUuid || !Number.isSafeInteger(resultRevision) || resultRevision < 1 || !getSpecialActionById(payload?.specialActionId)) {
    throw new TypeError("A special action requires a source, a positive result revision and a registered action.");
  }
  const intent = structuredClone(specialActionIntent(payload));
  const operation = { version: SPECIAL_ACTION_OPERATION_VERSION, sourceUuid, sourceKind, resultRevision, slot: String(slot), signature, intent };
  return { ...operation, id: specialActionOperationId(operation), ...(legacy ? { legacy } : {}) };
}

export function validateSpecialActionOperation(outcome, receipt = null) {
  const operation = outcome?.operation;
  if (!operation || operation.version !== SPECIAL_ACTION_OPERATION_VERSION) return "Unsupported or historical special-action operation.";
  if (!Number.isSafeInteger(operation.resultRevision) || operation.resultRevision < 1
    || !operation.sourceUuid || !operation.slot || !getSpecialActionById(operation.intent?.specialActionId)) return "Malformed special-action identity.";
  const payload = outcome.payload ?? {};
  if (!payload.actorUuid || !["standalone", "skillOpposed", "specialActionOpposed", "advantage.attacker", "advantage.defender"].includes(operation.sourceKind)
    || typeof operation.signature !== "string" || payload.followUp && payload.followUp !== "inCloseFailure"
    || payload.launch && (!["free", "autowin"].includes(payload.launch.mode) || ![0, 1].includes(payload.launch.apCost))
    || payload.activation && (payload.specialActionId !== "arise" || !["action", "secondary", "reaction", "free"].includes(payload.activation.actionType))) return "Unsupported special-action choices.";
  if (!payload.targetUuid && !["arise", "resist"].includes(payload.specialActionId)) return "A required Special Action target is missing.";
  if (outcome.id !== operation.id || operation.id !== specialActionOperationId(operation)
    || stableStringify(operation.intent) !== stableStringify(specialActionIntent(outcome.payload))) return "The operation ID is bound to different choices.";
  if (receipt?.operation && stableStringify(receipt.operation) !== stableStringify(operation)) return "The recorded operation has different choices.";
  if (receipt && !receipt.operation) return "The existing receipt has no matching operation identity.";
  return null;
}

/** Excludes content, timestamps and the card's general-purpose update sequence. */
export function specialActionResolutionSignature(state = {}) {
  state = state && typeof state === "object" ? state : {};
  const side = value => ({ actorUuid: value?.actorUuid ?? "", tokenUuid: value?.tokenUuid ?? null,
    rollMessageId: value?.rollMessageId ?? null, result: value?.result ? Object.fromEntries(
      ["rollTotal", "target", "isSuccess", "degree", "isCriticalSuccess", "isCriticalFailure"].map(key => [key, value.result[key] ?? null])) : null });
  return stableStringify({
    specialActionId: state.specialActionContext?.id ?? state.specialActionId ?? "",
    attacker: side(state.attacker), defender: side(state.defender),
    outcome: state.outcome ? { winner: state.outcome.winner, degrees: state.outcome.degrees ?? state.outcome.degree ?? 0 } : null,
    rollOff: state.context?.rollOff?.attempts ?? null,
    ...((state.specialActionContext?.snareRangeSnapshot ?? state.snareRangeSnapshot) ? {
      snare: { weaponUuid: state.specialActionContext?.snareWeaponUuid ?? state.snareWeaponUuid,
        rangeSnapshot: state.specialActionContext?.snareRangeSnapshot ?? state.snareRangeSnapshot }
    } : {}),
  });
}

export function specialActionEligibility(payload = {}) {
  if (!payload || typeof payload !== "object") return "unavailable";
  if (!getSpecialActionById(payload.specialActionId)) return "unavailable";
  if (payload.launch?.mode === "free") return "launch";
  if (payload.followUp === "inCloseFailure") return payload.specialActionId === "inClose" && payload.opposedResult?.winner === "defender" ? "reaction" : "none";
  return payload.isAutoWin === true || payload.opposedResult?.winner === "attacker" ? "effect" : "none";
}

/** Plan identities before the source result is persisted; never prepare rolls here. */
export function planSpecialActionSource({ sourceUuid, sourceKind, state, entries = [], autoEligible = false, legacy = null }) {
  const specialActionId = state?.specialActionContext?.id ?? state?.specialActionId;
  if (!specialActionId || !state?.outcome || !getSpecialActionById(specialActionId)) return [];
  if (!state.attacker?.result || !state.defender?.result) legacy = "review";
  const payload = { specialActionId, actorUuid: state.attacker?.actorUuid, targetUuid: state.defender?.actorUuid ?? null,
    actorTokenUuid: state.attacker?.tokenUuid ?? null, targetTokenUuid: state.defender?.tokenUuid ?? null,
    isAutoWin: false, opposedResult: { winner: state.outcome.winner, degrees: state.outcome.degrees ?? state.outcome.degree ?? 0 },
    ...(specialActionId === "inClose" && state.outcome.winner === "defender" ? { followUp: "inCloseFailure" } : {}) };
  const weaponUuid = state.specialActionContext?.snareWeaponUuid ?? state.snareWeaponUuid;
  if (weaponUuid) payload.snare = { weaponUuid, rangeSnapshot: state.specialActionContext?.snareRangeSnapshot ?? state.snareRangeSnapshot ?? null };
  if (!payload.actorUuid || specialActionEligibility(payload) === "none") return [];
  const signature = specialActionResolutionSignature(state);
  const prior = entries.filter(entry => entry?.operation?.sourceUuid === sourceUuid && entry.operation.sourceKind === sourceKind);
  if (prior.some(entry => entry.operation.version !== 1 || !Number.isSafeInteger(entry.operation.resultRevision))) return [];
  const latest = prior.reduce((last, entry) => !last || entry.operation.resultRevision > last.operation.resultRevision ? entry : last, null);
  if (latest?.operation.signature === signature) return [];
  const operation = createSpecialActionOperation({ sourceUuid, sourceKind, signature, payload, legacy,
    resultRevision: (latest?.operation.resultRevision ?? 0) + 1 });
  return [{ operation, payload, autoEligible, targetUuid: ["arise", "resist"].includes(specialActionId)
    ? payload.actorUuid : payload.targetUuid ?? payload.actorUuid,
  status: legacy === "complete" ? "applied" : legacy ? "partial" : "pending" }];
}

/** A selected Advantage with no recorded mode/application is evidence for review, not permission to replay it. */
export function planSpecialAdvantageSource({ sourceUuid, state, role, specialActionId, index, actorUuid, opponentUuid,
  actorTokenUuid = null, opponentTokenUuid = null, entries = [] }) {
  if (!sourceUuid || !actorUuid || !Number.isSafeInteger(index) || index < 0 || !getSpecialActionById(specialActionId) || !["attacker", "defender"].includes(role)) return null;
  const sourceKind = `advantage.${role}`;
  const slot = `${role}:${opponentTokenUuid ?? opponentUuid ?? ""}:${index}`;
  const signature = specialActionResolutionSignature({ ...state, specialActionId });
  const previous = entries.filter(entry => entry?.operation?.sourceKind === sourceKind && entry.operation.slot === slot);
  if (previous.some(entry => entry.operation.version !== 1 || !Number.isSafeInteger(entry.operation.resultRevision))) return null;
  if (previous.some(entry => entry.operation.signature === signature)) return null;
  const payload = specialActionIntent({ specialActionId, actorUuid, targetUuid: opponentUuid, actorTokenUuid,
    targetTokenUuid: opponentTokenUuid, opposedResult: { winner: role } });
  const operation = createSpecialActionOperation({ sourceUuid, sourceKind, slot, signature, payload, legacy: "review",
    resultRevision: Math.max(0, ...previous.map(entry => entry.operation.resultRevision)) + 1 });
  return { operation, payload, targetUuid: ["arise", "resist"].includes(specialActionId) ? actorUuid : opponentUuid ?? actorUuid,
    status: "partial", autoEligible: false };
}

/** Recovery is based on evidence, never the current AP/condition values or a timeout. */
export function specialActionRecoveryDecision({ outcome, receipt = null, processorUserId, processorSession, hasTarget = true, current = true } = {}) {
  if (receipt?.status === "applied") {
    const error = outcome?.operation ? validateSpecialActionOperation(outcome, receipt) : null;
    if (error) return { action: "review", reason: error };
    if (!receipt.reconciliation && specialActionStageEntries(receipt.stages).some(([, stage]) => ["started", "partial"].includes(stage.status))) {
      return { action: "review", reason: "A completed receipt contains an uncertain or conflicting stage." };
    }
    return { action: "replay" };
  }
  if (outcome?.status === "applied" && !receipt) return { action: "review", reason: "The completed card has no matching Actor receipt." };
  const error = validateSpecialActionOperation(outcome, receipt);
  if (error) return { action: "review", reason: error };
  if (outcome.operation.legacy || outcome.status === "partial" || receipt?.status === "partial") return { action: "review", reason: "Historical or uncertain application requires GM reconciliation." };
  if (!receipt && ["processing", "waitingGM"].includes(outcome.status)) return { action: "review", reason: "The source checkpoint has no matching Actor receipt." };
  if (!hasTarget) return { action: "review", reason: "An affected actor is unavailable." };
  const stages = specialActionStageEntries(receipt?.stages);
  const uncertain = stages.some(([, stage]) => ["started", "partial"].includes(stage.status));
  if (receipt?.status === "processing") return receipt.processorUserId === processorUserId && receipt.processorSession === processorSession
    ? { action: "processing" } : { action: "review", reason: "The processor changed during an unfinished application." };
  if (uncertain) return { action: "review", reason: "A previously started stage has no confirmed completion." };
  if (!current) return receipt && stages.some(([, stage]) => stage.status === "applied" && !stage.result?.skipped)
    ? { action: "review", reason: "The result changed after consequences began." } : { action: "superseded" };
  return { action: "apply" };
}

export function specialActionReviewSignature(outcome, receipt) {
  return documentStateFingerprint({ operation: outcome?.operation ?? null, payload: outcome?.payload ?? null,
    status: outcome?.status, revision: outcome?.revision, receipt });
}

export function validateSpecialActionReconciliation({ isGM, reason, processorStopped, disposition, expected, actual }) {
  if (!isGM) return "Only a GM may reconcile a special action.";
  if (!processorStopped || String(reason ?? "").trim().length < 3 || !["resolved", "abandoned"].includes(disposition)) return "A reason, disposition and stopped-processor confirmation are required.";
  if (expected !== actual) return "The operation changed; reopen its review.";
  return null;
}
