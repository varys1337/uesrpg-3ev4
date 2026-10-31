import { SYSTEM_ID } from "../../core/system/namespace.js";
import { getOutcomeApplicationMode, createChatOutcome } from "../../core/config/outcome-application-policy.js";
import { getMessageState as getMagicState, getDefenderEntries as magicDefenders, getDefenderOutcome as getMagicDefenderOutcome, getMagicDefenderDamage } from "../../core/magic/opposed/schema.js";
import { _getDefenderEntries as combatDefenders, _getDefenderDamage, _getDefenderOutcome } from "../../core/combat/opposed/schema.js";
import { readDamageReceipts, updateDamageReceipt } from "../../core/combat/damage/post-application.js";
import { doesUserOwnActor, getActorOwnerUser, canUserUpdateChatMessage, requestUpdateChatMessage } from "../../utils/authority-proxy.js";
import { AUTHORITY_RESULT_CODES, registerAuthorityIntentCommand, registerAuthorityIntentService, requestAuthorityIntent } from "../../utils/authority-intents.js";
import { acquireLock, releaseLock, lockKeyForDoc, stableStringify } from "../../utils/authority-proxy/shared.js";
import { getActiveGMUser } from "../../utils/users.js";
import { resolveActorFromUuidSync } from "../../utils/uuid-cache.js";
import { escapeHtml } from "../../utils/html.js";
import { t } from "../../utils/i18n.js";
import { createMessageQueue } from "../../core/opposed/shared/message-queue.js";
import { isPerfEnabled, monoMs, perfRecord, perfTrackApplication, measurePerfStage } from "../../utils/perf-tracker.js";
import { discoverSpecialActionOutcomes } from "../../core/combat/special-action-outcomes.js";
import { specialActionRecoveryDecision, specialActionReviewSignature, specialActionResolutionSignature, validateSpecialActionOperation, validateSpecialActionReconciliation, specialActionStageEntries, getSpecialActionStage } from "../../core/combat/special-action-operations.js";
import { projectGmDamageExplanation, projectStandaloneDamageEvidence, projectRecordedMessageRolls } from "../../core/combat/damage/explanation.js";
import { renderStandaloneDamageDetails } from "../../ui/combat/damage-explanation.js";
import { createActionResult, getActionResult, withActionResult, actionResultFromReceipt, addActionErrorContext } from "../action-results.js";

const COMMAND = "combat.applyOutcome";
const _adapters = new Map();
const _outcomeQueue = createMessageQueue();
const _actorQueue = createMessageQueue();
// Presentation-only caches. Execution always re-reads canonical documents.
const _receiptViews = new WeakMap();
const _renderedOutcomeViews = new Map();
const _refreshIds = new Set();
let _refreshFrame = null;
let _refreshRunning = false;
let _registered = false;
let _sessionId = null;
const _managedContexts = new WeakSet();

export function isManagedChatOutcomeContext(context) {
  return _managedContexts.has(context);
}

function receiptId(message, outcome) {
  if (outcome.adapter === "combat.special" && outcome.operation?.version === 1) return `outcome:${outcome.operation.id}`;
  return `outcome:${message.id}:${outcome.id}`;
}

export function getChatOutcomeReceipt(message, outcome) {
  const actor = resolveActorFromUuidSync(outcome.targetUuid);
  if (actor && !_receiptViews.has(actor)) _receiptViews.set(actor, receiptViews(actor));
  return readDamageReceipts(actor).find(entry => entry.id === receiptId(message, outcome)) ?? null;
}

function inlineOutcomes(message, includePayload) {
  const magic = getMagicState(message);
  const data = magic ?? message.flags?.[SYSTEM_ID]?.opposed;
  if (!data) return [];
  return (magic ? magicDefenders(data) : combatDefenders(data)).flatMap(defender => {
    if (magic && getMagicDefenderOutcome(data, defender)?.needsReview === true) return [];
    const damage = magic ? getMagicDefenderDamage(data, defender) : _getDefenderDamage(data, defender);
    const payload = damage?.applyPayload;
    if (!payload?.targetUuid) return [];
    const blocked = (damage.blockResult?.blocked && !damage.blockResult.isAoE)
      || (damage.wardResult?.blocked && !damage.wardResult.isAoE);
    if (blocked) return [];
    const kind = magic
      ? (damage._magicPayload?.isHealing ? "healing" : damage._magicPayload?.isDamaging === false ? "effect" : "damage")
      : damage.mode === "healing" ? "healing" : "damage";
    return [{
      id: damage.application?.id ?? `inline:${payload.targetUuid}:${kind}`,
      adapter: "combat.inline", kind,
      targetUuid: payload.targetUuid,
      defenderTokenUuid: defender.tokenUuid ?? "",
      sourceActorUuid: damage._magicPayload?.casterUuid ?? payload.attackerActorUuid ?? data.attacker?.actorUuid ?? "",
      autoEligible: damage.application?.version === 1 && typeof damage.application.id === "string"
        && damage.application.autoEligible === true,
      status: damage.applicationStatus ?? (damage.applied ? "applied" : "pending"),
      revision: Number(data.context?.updatedSeq ?? data.context?.updatedAt ?? 0) || 0,
      ...(includePayload ? { payload: foundry.utils.deepClone(payload), damage: foundry.utils.deepClone(damage) } : {}),
      magic: Boolean(magic),
    }];
  });
}

export function getChatOutcomes(message, { includePayload = true } = {}) {
  if (!message) return [];
  const envelope = message.flags?.[SYSTEM_ID]?.chatOutcomes;
  const discovered = discoverSpecialActionOutcomes(message);
  const additional = envelope?.version === 1 && Array.isArray(envelope.entries)
      ? envelope.entries : [];
  const resolved = [...additional, ...discovered].filter(entry => entry?.id && entry?.targetUuid && _adapters.has(entry.adapter)).map(entry => ({
        ...(includePayload ? foundry.utils.deepClone(entry) : { ...entry, payload: undefined }), revision: Number(envelope?.revision ?? 0),
        kind: actualOutcomeKind(entry),
        autoEligible: entry.version === 1 && entry.autoEligible === true,
      }));
  return [...inlineOutcomes(message, includePayload), ...resolved];
}

function actualOutcomeKind(entry) {
  if (["damage.resolved", "alchemy.poison", "combat.coup", "warfare.clash"].includes(entry.adapter)) return "damage";
  if (entry.adapter === "healing") return "healing";
  if (entry.adapter === "resource.delta" && entry.payload?.resource === "hp") return Number(entry.payload.amount) < 0 ? "damage" : "healing";
  if (entry.adapter === "alchemy.spell") return entry.payload?.isDamaging ? "damage" : entry.payload?.isHealing ? "healing" : "effect";
  if (entry.adapter === "alchemy.toxin") return Number(entry.payload?.damageToApply ?? 0) > 0 ? "damage" : "effect";
  if (entry.adapter === "alchemy.potion") return ["restoreHealth", "heal"].includes(entry.payload?.effectKey) ? "healing" : "effect";
  if (entry.adapter === "magic.consequences") {
    const delta = Number(entry.payload?.consequences?.healthDelta ?? 0) * Number(entry.payload?.options?.halveFactor ?? 1);
    return delta < 0 ? "damage" : delta > 0 ? "healing" : "effect";
  }
  return "effect";
}

function findOutcome(message, data, options) {
  return getChatOutcomes(message, options).find(outcome => data?.outcomeId
    ? outcome.id === data.outcomeId
    : outcome.targetUuid === data?.targetUuid && (!data.kind || outcome.kind === data.kind
      || (data.kind === "damage" && outcome.adapter === "combat.inline" && outcome.kind === "effect"))) ?? null;
}

function authorityFor(data) {
  const gm = getActiveGMUser();
  if (gm) return gm;
  const message = game.messages?.get(data?.messageId);
  const outcome = findOutcome(message, data, { includePayload: false });
  return outcome ? getActorOwnerUser(resolveActorFromUuidSync(outcome.targetUuid)) : null;
}

export function canApplyChatOutcome(user, message, outcome, { automatic = false } = {}) {
  if (!user || !message || !outcome) return false;
  if (!user.isGM) {
    const recipients = Array.from(message.whisper ?? []).map(recipient => typeof recipient === "string" ? recipient : recipient.id);
    if (message.blind && !recipients.includes(user.id)) return false;
    if (recipients.length && !recipients.includes(user.id) && message.author?.id !== user.id) return false;
  }
  const target = resolveActorFromUuidSync(outcome.targetUuid);
  if (!target) return false;
  const mode = getOutcomeApplicationMode();
  if (automatic) {
    return mode === "automatic" && outcome.autoEligible
      && authorityFor({ messageId: message.id, outcomeId: outcome.id })?.id === user.id;
  }
  if (user.isGM) return true;
  if (mode !== "owners") return false;
  const ownsTarget = doesUserOwnActor(user, target);
  if (!getActiveGMUser()) return ownsTarget;
  return ownsTarget || (outcome.kind !== "damage"
    && doesUserOwnActor(user, resolveActorFromUuidSync(outcome.sourceActorUuid)));
}

function compactResult(result) {
  if (result === false) return { ok: false };
  const saved = {};
  for (const key of ["ok", "success", "skipped", "cancelled", "message", "execution", "gmDamageReport", "components", "spellAbsorbed", "damage", "healing", "granted", "settledHP", "settledTempHP", "effectsApplied", "castContext", "handledDomains", "failed", "pendingStages", "deltas", "conditionName", "resourceChanges", "effectUuids", "prepared", "paid", "messageId", "left", "tokenUuids", "reconciled", "disposition"]) {
    if (result?.[key] !== undefined) saved[key] = foundry.utils.deepClone(result[key]);
  }
  if (result?.effects) {
    saved.effectsApplied = result.effects.length > 0;
    saved.effectUuids = Array.from(result.effects).map(effect => effect?.uuid).filter(Boolean);
  }
  return saved;
}

function captureStageActors(documents) {
  const actors = new Map(documents.filter(document => document.documentName === "Actor").map(actor => [actor.uuid, actor]));
  return [...Array.from(actors.values(), actor => ({
    actor, system: snapshotActorSystem(actor),
    effects: new Map(Array.from(actor.effects ?? [], effect => [effect.uuid, effect.toObject()])),
  })), ...documents.filter(document => document.documentName === "Token").map(token => ({ token, flags: foundry.utils.deepClone(token.toObject().flags ?? {}) }))];
}

function snapshotActorSystem(actor) {
  const system = actor.system;
  return typeof system?.toObject === "function" ? system.toObject(true) : foundry.utils.deepClone(system ?? {});
}

/** Record observed changes for review, never as instructions to replay a stage. */
function observeStageChanges(snapshots) {
  return snapshots.map(({ actor, system, effects, token, flags }) => {
    if (token) return { tokenUuid: token.uuid, system: {}, flags: foundry.utils.diffObject(flags, token.toObject().flags ?? {}), effectsCreated: [], effectsDeleted: [], effectsUpdated: [] };
    const current = new Map(Array.from(actor.effects ?? [], effect => [effect.uuid, effect.toObject()]));
    return {
      actorUuid: actor.uuid,
      system: foundry.utils.diffObject(system, snapshotActorSystem(actor)),
      effectsCreated: Array.from(current.keys()).filter(id => !effects.has(id)),
      effectsDeleted: Array.from(effects.keys()).filter(id => !current.has(id)),
      effectsUpdated: Array.from(current.keys()).filter(id => effects.has(id)
        && Object.keys(foundry.utils.diffObject(effects.get(id), current.get(id))).length),
    };
  }).filter(change => Object.keys(change.system).length || Object.keys(change.flags ?? {}).length || change.effectsCreated.length
    || change.effectsDeleted.length || change.effectsUpdated.length);
}

function interrupted(message, options = {}) {
  return Object.assign(new Error(message), options);
}

async function synchronize(message, outcome, receipt, { reconciliation = false } = {}) {
  if (!canUserUpdateChatMessage(message, game.user)) return false;
  if (outcome.adapter === "combat.inline") {
    const { synchronizeInlineChatOutcome } = await import("../../core/combat/chat-handlers/combat-chat-apply.js");
    await synchronizeInlineChatOutcome(message, outcome, receipt);
  } else {
    const lockKey = `ChatMessage:${message.id}`;
    await acquireLock(lockKey);
    try {
      const envelope = foundry.utils.deepClone(game.messages.get(message.id)?.flags?.[SYSTEM_ID]?.chatOutcomes);
      const entry = envelope?.entries?.find(candidate => candidate.id === outcome.id);
      if (!entry) return false;
      const next = { ...entry, status: receipt.status, error: receipt.error ?? "", result: receipt.result ?? null,
        ...(outcome.adapter === "combat.special" ? { checkpoint: { version: 1, receiptId: receipt.id,
          processorUserId: receipt.processorUserId ?? null, processorSession: receipt.processorSession ?? null,
          stages: Object.fromEntries(specialActionStageEntries(receipt.stages).map(([key, stage]) => [key, stage.status])) },
        ...(receipt.reconciliation ? { reconciliation: receipt.reconciliation } : {}) } : {}) };
      if (Object.keys(foundry.utils.diffObject(entry, next)).length) {
        Object.assign(entry, next);
        envelope.revision = Number(envelope.revision ?? 0) + 1;
        if (!await requestUpdateChatMessage(message, { [`flags.${SYSTEM_ID}.chatOutcomes`]: envelope }, {
          reconcileSpecial: reconciliation || outcome.adapter === "combat.special" && receipt.status === "applied" && !validateSpecialActionOperation(outcome, receipt),
        })) return false;
      }
    } finally { releaseLock(lockKey); }
  }
  if (["applied", "partial", "failed"].includes(receipt.status)) {
    const actor = resolveActorFromUuidSync(outcome.targetUuid);
    if (doesUserOwnActor(game.user, actor)) await updateDamageReceipt(actor, receipt.id, current => ({ ...current, cardSynchronized: true }));
  }
  return true;
}

async function execute(request, { queuedAt = null } = {}) {
  const startedAt = isPerfEnabled() ? queuedAt ?? monoMs() : null;
  const message = game.messages?.get(String(request.data?.messageId ?? ""));
  const outcome = findOutcome(message, request.data);
  if (!outcome) return outcomeResponse({ ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST }, message, outcome);
  return _actorQueue(outcome.targetUuid, async () => {
    const queueWaitMs = startedAt === null ? null : monoMs() - startedAt;
    let result;
    try {
      result = await executeOutcome(request, { startedAt });
      return outcomeResponse(result, message, outcome);
    } catch (error) {
      throw addActionErrorContext(error, { owner: "chatOutcomes", scope: "application", status: "needsReview", commitment: "uncertain",
        references: { messageId: message.id, outcomeId: outcome.id, targetUuid: outcome.targetUuid }, reason: String(error.message ?? error) });
    } finally {
      if (startedAt !== null) perfRecord({ event: "outcome.application", kind: outcome.kind,
        messageId: message.id, outcomeId: outcome.id, actorUuid: outcome.targetUuid,
        automatic: request.data.automatic === true, mode: getOutcomeApplicationMode(),
        ok: result?.ok === true, code: result?.code ?? null, queueWaitMs, durationMs: monoMs() - startedAt });
    }
  });
}

/** Project existing evidence without copying the receipt into a transport response. */
export function describeChatOutcome(message, outcome) {
  const references = { messageId: message?.id, outcomeId: outcome?.id, operationId: outcome?.operation?.id,
    targetUuid: outcome?.targetUuid, receiptId: message && outcome ? receiptId(message, outcome) : null };
  const receipt = message && outcome ? getChatOutcomeReceipt(message, outcome) : null;
  if (message && outcome?.adapter === "combat.special") {
    const full = findOutcome(message, { outcomeId: outcome.id }) ?? outcome;
    const decision = specialActionRecoveryDecision({ outcome: full, receipt, processorUserId: game.user.id,
      processorSession: _sessionId, hasTarget: Boolean(resolveActorFromUuidSync(full.targetUuid)), current: specialOutcomeIsCurrent(message, full) });
    if (decision.action === "review") return createActionResult({ owner: "chatOutcomes", scope: "application", status: "needsReview",
      commitment: "uncertain", accepted: true, references, reason: decision.reason });
  }
  if (outcome?.adapter === "combat.special" && receipt?.status === "applied" && receipt.result?.skipped === true
    && getSpecialActionStage(receipt.stages, "advantage.ap")?.result?.paid === false) {
    return createActionResult({ owner: "chatOutcomes", scope: "application", status: "blocked", accepted: true,
      references, reason: receipt.result.message ?? "Insufficient Action Points." });
  }
  if (receipt) return actionResultFromReceipt(receipt, { owner: "chatOutcomes", scope: "application", references,
    // These are existing confirmed adapter results, not observed current state.
    confirmed: specialActionStageEntries(receipt.stages).some(([, stage]) => stage.status === "applied" && stage.result?.skipped !== true
      && (stage.result?.paid === true || stage.result?.resourceChanges?.length > 0 || stage.result?.effectUuids?.length > 0
        || stage.result?.tokenUuids?.length > 0 || stage.result?.effectsApplied === true)) });
  const status = outcome?.status === "applied" ? "complete" : outcome?.status === "partial" ? "needsReview"
    : outcome?.status === "processing" ? "processing" : outcome?.status === "failed" ? "rejected" : "pending";
  return createActionResult({ owner: "chatOutcomes", scope: "application", status,
    commitment: status === "needsReview" ? "uncertain" : "none", accepted: Boolean(outcome), references });
}

function outcomeResponse(result, message, outcome) {
  const denied = [AUTHORITY_RESULT_CODES.UNAUTHORIZED, AUTHORITY_RESULT_CODES.INVALID_REQUEST, AUTHORITY_RESULT_CODES.STALE_REVISION].includes(result.code);
  const evidence = outcome && !denied ? describeChatOutcome(message, findOutcome(game.messages.get(message.id) ?? message, { outcomeId: outcome.id }) ?? outcome) : null;
  const status = result.status ?? (result.ok ? evidence?.status ?? "complete" : evidence?.status ?? "rejected");
  const descriptor = createActionResult({ owner: "chatOutcomes", scope: "application",
    status: ["failed", "waitingGM", "applied"].includes(status) ? ({ failed: "rejected", waitingGM: "pending", applied: "complete" })[status] : status,
    commitment: evidence?.commitment ?? "none", accepted: result.ok || evidence?.accepted || false,
    references: evidence?.references ?? { messageId: message?.id }, code: result.code, reason: result.reason ?? evidence?.reason });
  const response = withActionResult(result, descriptor);
  // The authority envelope intentionally only carries commandResult.data.
  response.data = { ...result.data, actionResult: response.actionResult,
    ...(result.cancelled ? { cancelled: true, reason: result.reason } : {}) };
  return response;
}

function specialOutcomeIsCurrent(message, outcome) {
  const operation = outcome?.operation;
  if (!operation) return true;
  const state = message.flags?.[SYSTEM_ID]?.[operation?.sourceKind]?.state;
  if (state) return Boolean(state.outcome) && operation.signature === specialActionResolutionSignature(state);
  if (operation.sourceKind.startsWith("advantage.")) {
    const data = message.flags?.[SYSTEM_ID]?.opposed;
    const role = operation.sourceKind === "advantage.attacker" ? "attacker" : "defender";
    const tokenUuid = role === "attacker" ? outcome.payload.targetTokenUuid : outcome.payload.actorTokenUuid;
    const actorUuid = role === "attacker" ? outcome.payload.targetUuid : outcome.payload.actorUuid;
    const defender = combatDefenders(data ?? {}).find(entry => tokenUuid ? entry.tokenUuid === tokenUuid : entry.actorUuid === actorUuid);
    const result = defender && _getDefenderOutcome(data, defender);
    if (!result || operation.signature !== specialActionResolutionSignature({ ...data, defender, outcome: result,
      specialActionId: outcome.payload.specialActionId })) return false;
  }
  const entries = getChatOutcomes(message, { includePayload: false });
  return !entries.some(entry => entry.operation?.sourceUuid === operation?.sourceUuid
    && entry.operation?.sourceKind === operation?.sourceKind && entry.operation?.slot === operation?.slot
    && entry.operation.resultRevision > operation.resultRevision);
}

async function ensureSpecialOutcomePersisted(message, outcome) {
  const envelope = message.flags?.[SYSTEM_ID]?.chatOutcomes;
  if (envelope?.entries?.some(entry => entry.id === outcome.id)) return;
  if (envelope && envelope.version !== 1) throw new Error("Unsupported outcome envelope; it was not overwritten.");
  const entry = foundry.utils.deepClone(outcome);
  delete entry.revision;
  await persistChatOutcomes({ message, entries: [entry] });
}

async function reconcileSpecialOutcome({ requester, data }, message, outcome, actor) {
  const receipt = getChatOutcomeReceipt(message, outcome);
  const reason = validateSpecialActionReconciliation({ ...data, isGM: requester?.isGM && game.user.isGM,
    actual: specialActionReviewSignature(outcome, receipt) });
  if (reason || outcome.operation && outcome.operation.version !== 1) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST, reason: reason ?? "Unsupported operation version." };
  if (outcome.operation) {
    const invalid = validateSpecialActionOperation(outcome, receipt);
    if (invalid) return { ok: false, code: AUTHORITY_RESULT_CODES.CONFLICT, reason: invalid };
  }
  if (receipt?.status === "applied" && specialActionRecoveryDecision({ outcome, receipt }).action === "replay") {
    return { ok: true, status: "complete", operationId: outcome.id, replayed: true };
  }
  if (actor?.flags?.[SYSTEM_ID]?.damageApplications != null && !Array.isArray(actor.flags[SYSTEM_ID].damageApplications)) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST, reason: "Unsupported Actor receipt format." };
  await ensureSpecialOutcomePersisted(message, outcome);
  const reconciliation = { version: 1, userId: requester.id, at: Date.now(), reason: data.reason.trim(), disposition: data.disposition };
  const result = { ok: true, success: data.disposition === "resolved", skipped: data.disposition === "abandoned", reconciled: true,
    disposition: data.disposition, message: data.disposition === "resolved" ? "Manually reconciled by GM." : "Abandoned by GM; no automatic application." };
  const record = { ...receipt, id: receiptId(message, outcome), messageId: message.id, outcomeId: outcome.id,
    adapter: "combat.special", targetUuid: outcome.targetUuid, ...(outcome.operation ? { operation: outcome.operation } : {}),
    status: "applied", stages: receipt?.stages ?? {}, result, reconciliation, error: "", cardSynchronized: false };
  const saved = actor ? await updateDamageReceipt(actor, record.id, () => record) : record;
  const synchronized = await synchronize(message, outcome, saved, { reconciliation: true });
  return { ok: synchronized, code: synchronized ? null : AUTHORITY_RESULT_CODES.FAILED, operationId: outcome.id,
    status: synchronized ? "complete" : "needsReview" };
}

async function executeOutcome({ requester, data, expectedRevision }, { startedAt = null } = {}) {
  const message = game.messages?.get(String(data?.messageId ?? ""));
  const outcome = findOutcome(message, data);
  if (!outcome || !_adapters.has(outcome.adapter)) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
  const lockKey = `CombatOutcome:${message.id}:${outcome.id}`;
  let stopPerfApplication = null;
  await acquireLock(lockKey);
  try {
    const live = game.messages.get(message.id);
    const current = findOutcome(live, { outcomeId: outcome.id });
    const actor = resolveActorFromUuidSync(current?.targetUuid);
    if (!current) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
    const special = current.adapter === "combat.special";
    if (data.action && data.action !== "reconcile") return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
    if (special && data.action === "reconcile") {
      if (authorityFor(data)?.id !== game.user?.id) return { ok: false, code: AUTHORITY_RESULT_CODES.UNAUTHORIZED };
      return reconcileSpecialOutcome({ requester, data }, live, current, actor);
    }
    if (!actor) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST, status: special ? "needsReview" : "rejected" };
    if (special && actor.flags?.[SYSTEM_ID]?.damageApplications != null && !Array.isArray(actor.flags[SYSTEM_ID].damageApplications)) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST, status: "needsReview", reason: "Unsupported Actor receipt format." };
    if (authorityFor(data)?.id !== game.user?.id || !canApplyChatOutcome(requester, live, current, { automatic: data.automatic === true })) {
      return { ok: false, code: AUTHORITY_RESULT_CODES.UNAUTHORIZED };
    }
    let receipt = getChatOutcomeReceipt(live, current);
    let superseded = false;
    if (special) {
      const decision = specialActionRecoveryDecision({ outcome: current, receipt, processorUserId: game.user.id,
        processorSession: _sessionId, current: specialOutcomeIsCurrent(live, current) });
      if (decision.action === "review") {
        const identityError = current.operation ? validateSpecialActionOperation(current, receipt) : null;
        if (!identityError && canUserUpdateChatMessage(live, game.user)) {
          await ensureSpecialOutcomePersisted(live, current);
          receipt = await updateDamageReceipt(actor, receiptId(live, current), previous => ({ ...previous,
            messageId: live.id, outcomeId: current.id, adapter: current.adapter, targetUuid: actor.uuid,
            ...(current.operation ? { operation: current.operation } : {}), stages: previous?.stages ?? {},
            status: "partial", error: decision.reason, cardSynchronized: false }));
          await synchronize(live, current, receipt);
        }
        return { ok: false, code: AUTHORITY_RESULT_CODES.CONFLICT, status: "needsReview", operationId: current.id, reason: decision.reason };
      }
      if (decision.action === "processing") return { ok: false, code: AUTHORITY_RESULT_CODES.CONFLICT, status: "processing", operationId: current.id };
      if (decision.action === "replay") {
        if (receipt) await synchronize(live, current, receipt, { reconciliation: Boolean(receipt.reconciliation) });
        return { ok: true, status: "complete", operationId: current.id, replayed: true, result: receipt?.result ?? current.result };
      }
      superseded = decision.action === "superseded";
      const predecessor = getChatOutcomes(live).find(entry => entry.id !== current.id && entry.operation
        && entry.operation.sourceUuid === current.operation.sourceUuid && entry.operation.sourceKind === current.operation.sourceKind
        && entry.operation.slot === current.operation.slot
        && entry.operation.resultRevision < current.operation.resultRevision && entry.operation.intent.specialActionId === current.operation.intent.specialActionId
        && ["processing", "partial", "waitingGM"].includes(getChatOutcomeReceipt(live, entry)?.status ?? entry.status));
      if (predecessor) return { ok: false, code: AUTHORITY_RESULT_CODES.CONFLICT, status: "needsReview", reason: "An earlier result requires reconciliation.", operationId: current.id };
      if (!canUserUpdateChatMessage(live, game.user)) return { ok: false, code: AUTHORITY_RESULT_CODES.NO_ACTIVE_GM, status: "pending" };
    }
    if (receipt?.status === "processing" && receipt.processorUserId !== game.user.id
      && game.users.get(receipt.processorUserId)?.active) return { ok: false, status: "processing", code: AUTHORITY_RESULT_CODES.CONFLICT };
    if (receipt && ["applied", "partial"].includes(receipt.status)) {
      await synchronize(live, current, receipt);
      return { ok: receipt.status === "applied", status: receipt.status === "applied" ? "complete" : "needsReview", code: receipt.status === "partial" ? AUTHORITY_RESULT_CODES.FAILED : null };
    }
    if (!receipt && ["applied", "partial"].includes(current.status)) return { ok: current.status === "applied", status: current.status === "applied" ? "complete" : "needsReview" };
    if (Number(expectedRevision ?? current.revision) !== current.revision) return { ok: false, code: AUTHORITY_RESULT_CODES.STALE_REVISION };
    if (special) await ensureSpecialOutcomePersisted(live, current);
    const id = receiptId(live, current);
    stopPerfApplication = perfTrackApplication(actor, { id, receiptId: id, messageId: live.id,
      outcomeId: current.id, outcomeStartedAt: startedAt, kind: current.kind });
    // Skips have no consequential writes. Include them in the next durable
    // checkpoint rather than issuing separate Actor updates for bookkeeping.
    const skippedStages = {};
    let claimed = false;
    const managedAuthority = special || current.adapter === "ability.status" || current.adapter === "fear.warCry";
    const managedDocumentLock = special || current.adapter === "ability.status"
      && current.payload?.durationAtApplication === "oneRound" && current.payload?.effect?.flags?.[SYSTEM_ID]?.key === "voidChanneler";
    const requireCurrent = () => {
      if (!managedAuthority) return;
      const latest = getChatOutcomeReceipt(live, current);
      if (authorityFor(data)?.id !== game.user.id || !game.user.active
        || claimed && (!latest || latest.processorUserId !== game.user.id || latest.processorSession !== _sessionId || latest.reconciliation)) {
        throw interrupted("The operation authority or processor changed; review is required.", { partial: true });
      }
      if (!canApplyChatOutcome(requester, live, current, { automatic: data.automatic === true })) throw interrupted("The original requester no longer has permission.", { partial: true });
      const fresh = findOutcome(game.messages.get(live.id), { outcomeId: current.id });
      if (!fresh || stableStringify(fresh.operation) !== stableStringify(current.operation)
        || stableStringify(fresh.payload) !== stableStringify(current.payload)) throw interrupted("The saved intent changed during application.", { partial: true });
      if (special && !specialOutcomeIsCurrent(game.messages.get(live.id), fresh)) throw interrupted("The source result changed during application.", { partial: true });
    };
    const save = async change => {
      requireCurrent();
      receipt = await updateDamageReceipt(actor, id, previous => ({
        messageId: live.id, outcomeId: current.id, adapter: current.adapter, kind: current.kind,
        targetUuid: actor.uuid, authorizedBy: requester.id, authorizedAutomatic: data.automatic === true, cardSynchronized: false,
        ...previous, ...change,
        stages: { ...previous?.stages, ...change.stages, ...skippedStages },
        processorUserId: game.user.id, processorSession: _sessionId,
        ...(special ? { operation: foundry.utils.deepClone(current.operation) } : {}),
        ...(special && previous?.status === "applied" ? previous : {}),
      }));
      claimed = managedAuthority;
      for (const key of Object.keys(skippedStages)) delete skippedStages[key];
      return receipt;
    };
    const context = {
      message: live, outcome: current, actor, requester, requireCurrent,
      operation: current.operation ?? null,
      receiptId: current.adapter === "combat.inline" && !current.damage.application?.id
        ? `${live.id}:${actor.uuid}:${current.kind}` : `${id}:health`,
      async stage(key, run, { documents = [actor], requiresGM = false, applicable = null, lockDocuments = true } = {}) {
        const metadata = { messageId: live.id, outcomeId: current.id, actorUuid: actor.uuid,
          outcomeKind: current.kind, stageKey: key };
        return measurePerfStage("outcome", "stage", metadata, async () => {
          requireCurrent();
          const prior = skippedStages[key] ?? getSpecialActionStage(receipt?.stages, key);
          if (prior?.status === "applied") return prior.result;
          if (["started", "partial"].includes(prior?.status)) throw interrupted("A previously started stage requires review.", { partial: true });
          if (applicable && !await applicable()) {
            const result = { skipped: true };
            skippedStages[key] = { status: "applied", result };
            perfRecord({ ...metadata, event: "outcome.stage.skipped", kind: current.kind, skippedCount: 1, writeCount: 0 });
            return result;
          }
          if (documents.some(document => !document)) {
            await save({ stages: { ...receipt?.stages, [key]: { status: "failed", error: "A required document is unavailable." } } });
            throw interrupted("A required consequence document is no longer available.", { committed: false });
          }
          const unavailable = (data.automatic === true && getOutcomeApplicationMode() !== "automatic")
            || requiresGM && !game.user.isGM || documents.some(document =>
            document.documentName === "Actor"
              ? !doesUserOwnActor(game.user, document) || !document.canUserModify(game.user, "update")
              : !document.canUserModify(game.user, "update"));
          if (unavailable) {
            await save({ status: "waitingGM", stages: { ...receipt?.stages, [key]: { status: "waitingGM" } } });
            throw interrupted("This stage requires an active GM.", { pendingGM: true });
          }
          let snapshots = [];
          let observedChanges = null;
          const acquired = [];
          try {
            if (managedDocumentLock && lockDocuments) for (const docKey of [...new Set(documents.map(lockKeyForDoc))].sort()) {
              await acquireLock(docKey);
              acquired.push(docKey);
            }
            requireCurrent();
            snapshots = await measurePerfStage("outcome", "snapshotBefore", metadata, () => captureStageActors(documents));
            await save({ status: "processing", stages: { ...receipt?.stages, [key]: { status: "started",
              ...(special ? { documents: documents.map(document => document.uuid), before: snapshots.map(snapshot => snapshot.token
                ? { tokenUuid: snapshot.token.uuid, flags: snapshot.flags }
                : { actorUuid: snapshot.actor.uuid, system: snapshot.system, effects: Object.fromEntries(snapshot.effects) }) } : {}) } } });
            if (special && !await synchronize(live, current, receipt)) throw interrupted("The source checkpoint was not confirmed.", { partial: true });
            if (data.automatic === true && getOutcomeApplicationMode() !== "automatic") {
              await save({ status: "waitingGM", stages: { ...receipt.stages, [key]: { status: "waitingGM" } } });
              throw interrupted("Automatic application was stopped by the world setting.", { pendingGM: true });
            }
            requireCurrent();
            const result = await run();
            requireCurrent();
            const terminalSkip = special && result?.skipped && (!getActionResult(result) || getActionResult(result).commitment === "none");
            const failed = result === false || result?.ok === false && !terminalSkip || result?.success === false && !terminalSkip || result?.failed === true;
            const partial = result?.execution?.status === "partial" || result?.failed?.length > 0;
            const status = failed || partial ? "partial" : "applied";
            const saved = compactResult(result);
            observedChanges = await measurePerfStage("outcome", "snapshotAfter", metadata, () => observeStageChanges(snapshots));
            await save({ stages: { ...receipt.stages, [key]: { ...getSpecialActionStage(receipt.stages, key), status, result: saved, observedChanges } } });
            if (status === "partial") throw interrupted(result?.cancelled ? result.failed?.[0]?.error : "A consequential stage was not fully applied.",
              { partial: true, cancelled: result?.cancelled === true });
            return result ?? saved;
          } catch (error) {
            if (!error.pendingGM) await save({ stages: { ...receipt.stages, [key]: {
              ...getSpecialActionStage(receipt.stages, key),
              status: error.committed === false ? "failed" : "partial", error: String(error.message ?? error),
              observedChanges: observedChanges ?? await measurePerfStage("outcome", "snapshotAfter", metadata, () => observeStageChanges(snapshots)),
            } } });
            throw error;
          } finally {
            for (const docKey of acquired.reverse()) releaseLock(docKey);
          }
        });
      },
    };
    _managedContexts.add(context);
    let cancellationReason = "";
    try {
      if (special) {
        await save({ status: "processing", error: "" });
        if (!await synchronize(live, current, receipt)) throw interrupted("The source checkpoint was not confirmed.", { committed: false });
      }
      const result = superseded ? { ok: true, skipped: true, message: "Superseded before application by a new result." }
        : await _adapters.get(current.adapter)(current, context);
      await save({ status: "applied", result: compactResult(result), error: "" });
    } catch (error) {
      if (error.cancelled) cancellationReason = String(error.message ?? "Application cancelled.");
      const committed = specialActionStageEntries(receipt?.stages).some(([key, stage]) => key !== "castContext"
        && stage.status === "applied" && stage.result?.skipped !== true);
      await save({ status: error.pendingGM ? "waitingGM" : error.committed === false && !committed ? "failed" : "partial", error: String(error.message ?? error) });
      if (!error.pendingGM && !error.cancelled) console.error("UESRPG | Chat outcome application failed", error);
    } finally { _managedContexts.delete(context); }
    await synchronize(live, current, receipt);
    return { ok: receipt.status === "applied", code: receipt.status === "waitingGM" ? AUTHORITY_RESULT_CODES.NO_ACTIVE_GM : receipt.status === "applied" ? null : AUTHORITY_RESULT_CODES.FAILED,
      ...(cancellationReason ? { cancelled: true, reason: cancellationReason } : {}),
      ...(special ? { operationId: current.id, status: receipt.status === "applied" ? "complete" : receipt.status === "partial" ? "needsReview" : receipt.status, result: receipt.result } : {}) };
  } finally {
    stopPerfApplication?.();
    releaseLock(lockKey);
  }
}

export function registerChatOutcomeAdapter(name, executeAdapter) {
  if (_adapters.has(name)) return;
  _adapters.set(name, executeAdapter);
}

export async function persistChatOutcomes({ message = null, actor, entries, content = "", whisper = [] }) {
  if (!entries?.length) return message;
  if (!message) {
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, whisper,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: { [SYSTEM_ID]: { chatOutcomes: { version: 1, entries } } } });
  }
  if (!canUserUpdateChatMessage(message, game.user)) throw new Error("The resolved card cannot be updated by this user.");
  const lockKey = `ChatMessage:${message.id}`;
  await acquireLock(lockKey);
  try {
    const envelope = foundry.utils.deepClone(game.messages.get(message.id)?.flags?.[SYSTEM_ID]?.chatOutcomes ?? { version: 1, entries: [] });
    if (envelope.version !== 1 || !Array.isArray(envelope.entries)) throw new Error("Unsupported outcome envelope; it was not overwritten.");
    for (const entry of entries) {
      const previous = envelope.entries.find(candidate => candidate.id === entry.id);
      if (previous && entry.adapter === "combat.special" && (stableStringify(previous.operation) !== stableStringify(entry.operation)
        || stableStringify(previous.payload) !== stableStringify(entry.payload))) throw new Error("The operation ID is bound to different choices.");
      if (!previous) envelope.entries.push(entry);
    }
    envelope.revision = Number(envelope.revision ?? 0) + 1;
    if (!await requestUpdateChatMessage(message, { [`flags.${SYSTEM_ID}.chatOutcomes`]: envelope })) throw new Error("The resolved outcomes were not saved.");
    return message;
  } finally { releaseLock(lockKey); }
}

export async function queueHealingOutcome(actor, amount, { onOutcome = null, ...options } = {}) {
  const message = await persistChatOutcomes({ actor, content: `<div class="uesrpg"><b>${escapeHtml(options.source ?? "Healing")}</b></div>`,
    entries: [createChatOutcome({ adapter: "healing", kind: "healing", sourceActorUuid: actor.uuid,
      targetUuid: actor.uuid, label: options.source ?? "Healing", payload: { ...options, amount } })] });
  onOutcome?.(message);
  return message;
}

async function processOutcome(message, outcome, queuedAt = null) {
  let receipt = getChatOutcomeReceipt(message, outcome);
  const selected = authorityFor({ messageId: message.id, outcomeId: outcome.id })?.id === game.user.id;
  if (outcome.adapter === "combat.special" && selected) {
    const full = findOutcome(message, { outcomeId: outcome.id });
    const decision = specialActionRecoveryDecision({ outcome: full, receipt, processorUserId: game.user.id,
      processorSession: _sessionId, hasTarget: Boolean(resolveActorFromUuidSync(outcome.targetUuid)), current: specialOutcomeIsCurrent(message, full) });
    if (decision.action === "review") {
      if (full.operation && validateSpecialActionOperation(full, receipt)) return;
      if (receipt && receipt.status !== "partial" && doesUserOwnActor(game.user, resolveActorFromUuidSync(outcome.targetUuid))) {
        receipt = await updateDamageReceipt(resolveActorFromUuidSync(outcome.targetUuid), receipt.id, entry => ({ ...entry,
          status: "partial", error: decision.reason, cardSynchronized: false }));
      }
      if (receipt && canUserUpdateChatMessage(message, game.user)) await synchronize(message, full, receipt);
      return;
    }
  }
  if (outcome.adapter !== "combat.special" && receipt?.status === "processing" && selected
    && ((receipt.processorUserId === game.user.id && receipt.processorSession !== _sessionId)
      || !game.users.get(receipt.processorUserId)?.active)) {
    const uncertain = Object.values(receipt.stages ?? {}).some(stage => ["started", "partial"].includes(stage.status));
    receipt = await updateDamageReceipt(resolveActorFromUuidSync(outcome.targetUuid), receipt.id, current => ({ ...current,
      status: uncertain ? "partial" : "waitingGM", error: uncertain ? "Application was interrupted; review committed or uncertain stages." : "", cardSynchronized: false }));
  }
  if (receipt?.cardSynchronized !== true && ["applied", "partial", "failed"].includes(receipt?.status)
    && receipt.status === outcome.status && doesUserOwnActor(game.user, resolveActorFromUuidSync(outcome.targetUuid))) {
    await updateDamageReceipt(resolveActorFromUuidSync(outcome.targetUuid), receipt.id, current => ({ ...current, cardSynchronized: true }));
    return;
  }
  if (receipt?.cardSynchronized !== true && ["applied", "partial", "failed"].includes(receipt?.status)
    && canUserUpdateChatMessage(message, game.user)) {
    await synchronize(message, outcome, receipt, { reconciliation: Boolean(receipt.reconciliation) });
    return;
  }
  if (["applied", "partial", "failed", "processing"].includes(receipt?.status ?? outcome.status)) return;
  const automatic = canApplyChatOutcome(game.user, message, outcome, { automatic: true });
  const authorized = receipt?.status === "waitingGM" && receipt.authorizedBy && selected
    && (!receipt.authorizedAutomatic || getOutcomeApplicationMode() === "automatic")
    && canApplyChatOutcome(game.user, message, outcome);
  if (!automatic && !authorized) return;
  const requester = outcome.adapter === "combat.special" && authorized ? game.users.get(receipt.authorizedBy) : game.user;
  if (!requester || !canApplyChatOutcome(requester, message, outcome, { automatic })) return;
  await execute({ requester, data: { messageId: message.id, outcomeId: outcome.id, automatic }, expectedRevision: outcome.revision }, { queuedAt });
}

function isOutcomeUpdate(changes) {
  if (!changes) return true;
  const paths = [`flags.${SYSTEM_ID}.opposed`, `flags.${SYSTEM_ID}.magicOpposed`, `flags.${SYSTEM_ID}.chatOutcomes`,
    `flags.${SYSTEM_ID}.skillOpposed`, `flags.${SYSTEM_ID}.specialActionOpposed`, "whisper", "blind", "user"];
  const visit = (value, parent = "") => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.entries(value).some(([key, entry]) => {
      const path = parent ? `${parent}.${key}` : key;
      if (paths.some(relevant => path === relevant || path.startsWith(`${relevant}.`))) return true;
      return paths.some(relevant => relevant.startsWith(`${path}.`)) && visit(entry, path);
    });
  };
  return visit(changes);
}

function scheduleMessage(message, changes = null) {
  if (!message) return Promise.resolve();
  if (!isOutcomeUpdate(changes)) return Promise.resolve();
  const queuedAt = isPerfEnabled() ? monoMs() : null;
  return Promise.all(getChatOutcomes(message, { includePayload: false }).map(outcome => _outcomeQueue(
    `${message.id}:${outcome.id}`, async () => {
      const live = game.messages.get(message.id);
      if (!live) return;
      const current = findOutcome(live, { outcomeId: outcome.id }, { includePayload: false });
      if (current) await processOutcome(live, current, queuedAt);
    }).catch(error => console.error("UESRPG | Chat outcome processing failed", error))));
}

function receiptViews(actor) {
  return new Map(readDamageReceipts(actor).filter(entry => entry.messageId && entry.outcomeId).map(entry => [entry.id, {
    messageId: entry.messageId,
    signature: JSON.stringify([entry.outcomeId, entry.status, entry.error ?? "", entry.result?.message ?? "",
      game.user?.isGM ? projectGmDamageExplanation({ receipt: entry }) : null]),
  }]));
}

function outcomePresentation(message, outcome, outcomes) {
  outcomes ??= getChatOutcomes(message, { includePayload: false });
  const receipt = getChatOutcomeReceipt(message, outcome);
  const result = receipt?.result ?? outcome.result;
  const target = resolveActorFromUuidSync(outcome.targetUuid);
  return {
    id: outcome.id,
    label: outcome.label || "",
    targetName: target?.name ?? "Target",
    controls: controls(message, outcome, receipt),
    note: result?.message || receipt?.error || "",
    damageExplanation: game.user?.isGM && outcome.kind === "damage"
      ? outcome.adapter === "combat.inline" ? projectGmDamageExplanation({ receipt, status: outcome.status })
        : projectStandaloneDamageEvidence({ outcomes, outcomeId: outcome.id, targetUuid: outcome.targetUuid,
          messageId: message.id, expectedReceiptId: receiptId(message, outcome), receiptTargetUuid: target?.uuid ?? outcome.targetUuid, receipt }) : null,
    messageRolls: outcome.kind === "damage" && outcome.adapter !== "combat.inline" && outcomes.length === 1
      ? projectRecordedMessageRolls(Array.from(message.rolls ?? [], roll => ({ formula: roll.formula, total: roll.total }))) : [],
  };
}

function scheduleDisplayRefresh() {
  if (_refreshFrame !== null || _refreshRunning || !_refreshIds.size) return;
  _refreshFrame = requestAnimationFrame(() => {
    _refreshFrame = null;
    void flushDisplayRefreshes();
  });
}

function queueDisplayRefresh(messageId) {
  const coalesced = _refreshIds.has(messageId);
  _refreshIds.add(messageId);
  perfRecord({ event: "outcome.chat.refreshRequested", messageId,
    requestedCount: 1, coalescedCount: coalesced ? 1 : 0 });
}

async function flushDisplayRefreshes() {
  _refreshRunning = true;
  let frameStartedAt = performance.now();
  try {
    while (_refreshIds.size) {
      const id = _refreshIds.values().next().value;
      _refreshIds.delete(id);
      const message = game.messages?.get(id);
      if (!message) continue;
      const outcomes = getChatOutcomes(message, { includePayload: false });
      if (!outcomes.length) continue;
      const signature = JSON.stringify(outcomes.map(outcome => outcomePresentation(message, outcome, outcomes)));
      if (_renderedOutcomeViews.get(id) === signature) {
        perfRecord({ event: "outcome.chat.refreshSkipped", messageId: id, skippedCount: 1, renderCount: 0 });
        continue;
      }
      const startedAt = isPerfEnabled() ? monoMs() : null;
      let failed = false;
      try {
        await ui.chat?.updateMessage(message, { notify: false });
      } catch (error) {
        failed = true;
        console.warn("UESRPG | Outcome display refresh failed", error);
      } finally {
        if (startedAt !== null) perfRecord({ event: "outcome.chat.refresh", messageId: id,
          failed, refreshCount: 1, durationMs: monoMs() - startedAt });
      }
      // Global permission/recovery refreshes also yield between expensive cards.
      if (performance.now() - frameStartedAt >= 8 && _refreshIds.size) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        frameStartedAt = performance.now();
      }
    }
  } catch (error) {
    console.warn("UESRPG | Outcome display refresh failed", error);
  } finally {
    _refreshRunning = false;
    scheduleDisplayRefresh();
  }
}

export function refreshChatOutcomeMessages(actor = null) {
  if (actor) {
    const previous = _receiptViews.get(actor) ?? new Map();
    const current = receiptViews(actor);
    _receiptViews.set(actor, current);
    for (const id of new Set([...previous.keys(), ...current.keys()])) {
      if (previous.get(id)?.signature === current.get(id)?.signature) continue;
      const messageId = current.get(id)?.messageId ?? previous.get(id)?.messageId;
      if (messageId) queueDisplayRefresh(messageId);
    }
  } else {
    for (const message of game.messages?.contents ?? []) {
      const outcomes = getChatOutcomes(message, { includePayload: false });
      for (const outcome of outcomes) getChatOutcomeReceipt(message, outcome);
      if (outcomes.length && _renderedOutcomeViews.has(message.id)) queueDisplayRefresh(message.id);
    }
  }
  scheduleDisplayRefresh();
}

function controls(message, outcome, receipt = getChatOutcomeReceipt(message, outcome)) {
  const status = receipt?.status ?? outcome.status;
  if (outcome.adapter === "combat.special") {
    const review = game.user.isGM ? `<button type="button" data-ues-special-review="${escapeHtml(outcome.id)}">${escapeHtml(t("UESRPG.Chat.SpecialActions.Review"))}</button>` : "";
    const full = findOutcome(message, { outcomeId: outcome.id });
    const decision = specialActionRecoveryDecision({ outcome: full, receipt, processorUserId: game.user.id,
      processorSession: _sessionId, hasTarget: Boolean(resolveActorFromUuidSync(outcome.targetUuid)), current: specialOutcomeIsCurrent(message, full) });
    if (decision.action === "review") return `<span role="status">${escapeHtml(t("UESRPG.Chat.SpecialActions.NeedsReview"))}</span>${review}`;
    if (status === "processing") return `<span role="status">${escapeHtml(t("UESRPG.Chat.Common.OutcomeProcessing"))}</span>${review}`;
    if (status === "applied" && (receipt?.result ?? outcome.result)?.skipped === true) {
      return `<span role="status">${escapeHtml(t("UESRPG.Chat.Common.OutcomeNoEffect"))}</span>`;
    }
  }
  if (!resolveActorFromUuidSync(outcome.targetUuid)) return `<span role="status">${escapeHtml(t("UESRPG.Chat.Common.OutcomeUnavailable", "Failed: recipient unavailable."))}</span>`;
  if (status === "applied") return `<span class="damage-applied-label"><i class="fa-solid fa-check" aria-hidden="true"></i> ${escapeHtml(t("UESRPG.Chat.Common.OutcomeApplied", "Applied"))}</span>`;
  if (status === "partial") return `<span role="status">${escapeHtml(t("UESRPG.Chat.Common.ApplicationPartial"))}</span>`;
  if (status === "processing") return `<span role="status">${escapeHtml(t("UESRPG.Chat.Common.OutcomeProcessing", "Applying..."))}</span>`;
  if (status === "waitingGM" && !getActiveGMUser()) return `<span role="status">${escapeHtml(t("UESRPG.Chat.Common.OutcomeWaitingGM", "Pending: requires an active GM."))}</span>`;
  if (getOutcomeApplicationMode() === "automatic" && outcome.autoEligible && status !== "failed") {
    return `<span role="status">${escapeHtml(t(status === "waitingGM" ? "UESRPG.Chat.Common.OutcomeWaitingGM" : "UESRPG.Chat.Common.OutcomeAutomatic", "Pending automatic application"))}</span>`;
  }
  if (!canApplyChatOutcome(game.user, message, outcome)) {
    return `<span role="status">${escapeHtml(t(!getActiveGMUser() ? "UESRPG.Chat.Common.OutcomeWaitingGM" : "UESRPG.Chat.Common.OutcomeAwaitingConfirmation", "Awaiting confirmation"))}</span>`;
  }
  const label = t(status === "failed" ? "UESRPG.Chat.Common.OutcomeRetry" : "UESRPG.Chat.Common.OutcomeApply", "Apply");
  return `<button type="button" data-ues-chat-outcome="${escapeHtml(outcome.id)}"><i class="fa-solid fa-check" aria-hidden="true"></i> ${escapeHtml(label)}</button>`;
}

export const ChatOutcomeApplicationService = {
  register() {
    if (_registered) return;
    _sessionId = foundry.utils.randomID();
    registerChatOutcomeAdapter("combat.inline", async (outcome, context) => {
      const { executeInlineChatOutcome } = await import("../../core/combat/chat-handlers/combat-chat-apply.js");
      return executeInlineChatOutcome(outcome, context);
    });
    for (const adapter of ["healing", "damage.resolved", "resource.delta", "resource.fatigue", "combat.coup", "combat.special", "alchemy.potion", "alchemy.spell", "alchemy.toxin", "alchemy.poison", "ability.effects", "ability.status", "magic.consequences", "magic.spell", "magic.origin", "warfare.clash", "fear.warCry"]) {
      registerChatOutcomeAdapter(adapter, async (outcome, context) => {
        const { executeAdditionalChatOutcome } = await import("./chat-outcome-executors.js");
        return executeAdditionalChatOutcome(outcome, context);
      });
    }
    registerAuthorityIntentService();
    if (!registerAuthorityIntentCommand(COMMAND, execute, { persistProcessing: false, resolveAuthority: authorityFor })) {
      throw new Error("UESRPG | Chat outcome authority command registration failed.");
    }
    _registered = true;
  },
  async applyResult(message, data = {}) {
    const outcome = findOutcome(message, data);
    if (!outcome || !canApplyChatOutcome(game.user, message, outcome)) return outcomeResponse({ ok: false,
      code: outcome ? AUTHORITY_RESULT_CODES.UNAUTHORIZED : AUTHORITY_RESULT_CODES.INVALID_REQUEST }, message, null);
    const request = { messageId: message.id, outcomeId: outcome.id, targetUuid: outcome.targetUuid, kind: outcome.kind };
    const authority = authorityFor(request);
    const result = authority?.id === game.user.id
      ? await execute({ requester: game.user, data: request, expectedRevision: outcome.revision })
      : await requestAuthorityIntent(COMMAND, request, { expectedRevision: outcome.revision, timeout: 60_000 });
    let actionResult = getActionResult(result);
    if (!actionResult) {
      const rejectedBeforeExecution = [AUTHORITY_RESULT_CODES.UNAUTHORIZED, AUTHORITY_RESULT_CODES.INVALID_REQUEST,
        AUTHORITY_RESULT_CODES.STALE_REVISION, AUTHORITY_RESULT_CODES.EXPIRED].includes(result?.code);
      // A query timeout is not proof that the authority did not apply the action.
      const recorded = describeChatOutcome(game.messages.get(message.id) ?? message, outcome);
      actionResult = rejectedBeforeExecution ? createActionResult({ owner: "chatOutcomes", scope: "application", status: "rejected",
        code: result.code, references: { messageId: message.id, outcomeId: outcome.id, requestId: result.requestId } })
        : recorded.status === "complete" || recorded.status === "needsReview" || recorded.status === "processing" ? recorded
        : createActionResult({ ...recorded, status: result?.code === AUTHORITY_RESULT_CODES.NO_ACTIVE_GM ? "pending"
          : result?.code === AUTHORITY_RESULT_CODES.FAILED ? "needsReview" : "rejected",
          commitment: result?.code === AUTHORITY_RESULT_CODES.FAILED ? "uncertain" : recorded.commitment,
          code: result?.code, references: { ...recorded.references, requestId: result?.requestId } });
    }
    const cancellation = result?.cancelled ? result : result?.data?.cancelled ? result.data : null;
    if (cancellation) ui.notifications?.info?.(cancellation.reason || "Application cancelled.");
    else if (["rejected", "blocked", "partial", "needsReview"].includes(actionResult.status)) ui.notifications?.warn?.(t("UESRPG.Chat.Common.ApplicationFailed"));
    return { ...result, ok: actionResult.ok, actionResult };
  },
  async apply(message, data = {}) {
    return (await this.applyResult(message, data)).actionResult.ok;
  },
  async reviewSpecial(message, outcomeId) {
    if (!game.user.isGM) return;
    const { showSpecialActionReview } = await import("../../ui/combat/special-action-review.js");
    return showSpecialActionReview(message, outcomeId);
  },
  async reconcileSpecial(message, outcomeId, choices) {
    if (!game.user.isGM) return outcomeResponse({ ok: false, code: AUTHORITY_RESULT_CODES.UNAUTHORIZED }, message, null);
    const outcome = findOutcome(message, { outcomeId });
    if (outcome?.adapter !== "combat.special") return outcomeResponse({ ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST }, message, null);
    const data = { messageId: message.id, outcomeId, action: "reconcile", reason: choices.reason, disposition: choices.disposition,
      processorStopped: choices.processorStopped === true, expected: choices.expected };
    const response = authorityFor(data)?.id === game.user.id
      ? await execute({ requester: game.user, data, expectedRevision: outcome.revision })
      : await requestAuthorityIntent(COMMAND, data, { expectedRevision: outcome.revision, timeout: 60_000 });
    const actionResult = getActionResult(response);
    return actionResult ? { ...response, ok: actionResult.ok, actionResult }
      : outcomeResponse({ ok: false, status: "needsReview", code: response?.code, reason: "Reconciliation acknowledgement is unavailable; inspect the receipt before retrying." }, message, outcome);
  },
  onMessagePersisted: scheduleMessage,
  forgetMessage(message) {
    _refreshIds.delete(message.id);
    _renderedOutcomeViews.delete(message.id);
  },
  async reconcile() {
    for (const message of game.messages?.contents ?? []) await scheduleMessage(message);
    refreshChatOutcomeMessages();
  },
  augment(message, root) {
    if (message?.visible !== true || message?.isContentVisible !== true) return;
    const outcomes = getChatOutcomes(message, { includePayload: false });
    const presentations = outcomes.map(outcome => outcomePresentation(message, outcome, outcomes));
    if (outcomes.length) perfRecord({ event: "outcome.chat.render", messageId: message.id, renderCount: 1 });
    if (outcomes.length) _renderedOutcomeViews.set(message.id, JSON.stringify(presentations));
    else _renderedOutcomeViews.delete(message.id);
    while (_renderedOutcomeViews.size > 500) _renderedOutcomeViews.delete(_renderedOutcomeViews.keys().next().value);
    for (const panel of root.querySelectorAll(".uesrpg-damage-panel[data-ues-outcome-target]")) {
      const outcome = outcomes.find(entry => entry.adapter === "combat.inline" && (panel.dataset.uesOutcomeId
        ? entry.id === panel.dataset.uesOutcomeId : entry.targetUuid === panel.dataset.uesOutcomeTarget));
      if (!outcome) continue;
      const action = panel.querySelector(".dmg-action");
      if (action) action.innerHTML = presentations.find(entry => entry.id === outcome.id).controls;
    }
    const additional = outcomes.filter(outcome => outcome.adapter !== "combat.inline");
    if (!additional.length) return;
    const container = document.createElement("div");
    container.className = "uesrpg-chat-outcomes";
    container.dataset.uesChatOutcomeControls = "1";
    container.innerHTML = additional.map(outcome => {
      const presentation = presentations.find(entry => entry.id === outcome.id);
      const note = presentation.note ? `<p class="uesrpg-outcome-note">${escapeHtml(presentation.note)}</p>` : "";
      const details = outcome.kind === "damage" ? renderStandaloneDamageDetails(presentation) : "";
      return `<div class="uesrpg-chat-outcome"><div class="dmg-action"><span>${escapeHtml(outcome.label || presentation.targetName)}${outcome.label ? `: ${escapeHtml(presentation.targetName)}` : ""}</span>${presentation.controls}</div>${note}${details}</div>`;
    }).join("");
    root.querySelector("[data-ues-chat-outcome-controls]")?.remove();
    const content = root.querySelector(".message-content") ?? root;
    (content.querySelector(".uesrpg-chat-surface") ?? content).appendChild(container);
  },
};
