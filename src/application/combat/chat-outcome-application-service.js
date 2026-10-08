import { SYSTEM_ID } from "../../core/system/namespace.js";
import { getOutcomeApplicationMode, createChatOutcome } from "../../core/config/outcome-application-policy.js";
import { getMessageState as getMagicState, getDefenderEntries as magicDefenders, getMagicDefenderDamage } from "../../core/magic/opposed/schema.js";
import { _getDefenderEntries as combatDefenders, _getDefenderDamage } from "../../core/combat/opposed/schema.js";
import { readDamageReceipts, updateDamageReceipt } from "../../core/combat/damage/post-application.js";
import { doesUserOwnActor, getActorOwnerUser, canUserUpdateChatMessage, requestUpdateChatMessage } from "../../utils/authority-proxy.js";
import { AUTHORITY_RESULT_CODES, registerAuthorityIntentCommand, registerAuthorityIntentService, requestAuthorityIntent } from "../../utils/authority-intents.js";
import { acquireLock, releaseLock } from "../../utils/authority-proxy/shared.js";
import { getActiveGMUser } from "../../utils/users.js";
import { resolveActorFromUuidSync } from "../../utils/uuid-cache.js";
import { escapeHtml } from "../../utils/html.js";
import { t } from "../../utils/i18n.js";
import { createMessageQueue } from "../../core/opposed/shared/message-queue.js";
import { isPerfEnabled, monoMs, perfRecord, perfTrackApplication, measurePerfStage } from "../../utils/perf-tracker.js";

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

function receiptId(message, outcome) {
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
  const additional = envelope?.version === 1 && Array.isArray(envelope.entries)
      ? envelope.entries.filter(entry => entry?.id && entry?.targetUuid && _adapters.has(entry.adapter)).map(entry => ({
        ...(includePayload ? foundry.utils.deepClone(entry) : { ...entry, payload: undefined }), revision: Number(envelope.revision ?? 0),
        kind: actualOutcomeKind(entry),
        autoEligible: entry.version === 1 && entry.autoEligible === true,
      })) : [];
  return [...inlineOutcomes(message, includePayload), ...additional];
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
  for (const key of ["ok", "success", "skipped", "message", "execution", "gmDamageReport", "components", "spellAbsorbed", "damage", "healing", "granted", "settledHP", "settledTempHP", "effectsApplied", "castContext", "handledDomains", "failed", "pendingStages", "deltas", "conditionName", "resourceChanges", "effectUuids"]) {
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
  return Array.from(actors.values(), actor => ({
    actor, system: snapshotActorSystem(actor),
    effects: new Map(Array.from(actor.effects ?? [], effect => [effect.uuid, effect.toObject()])),
  }));
}

function snapshotActorSystem(actor) {
  const system = actor.system;
  return typeof system?.toObject === "function" ? system.toObject(true) : foundry.utils.deepClone(system ?? {});
}

/** Record observed changes for review, never as instructions to replay a stage. */
function observeStageChanges(snapshots) {
  return snapshots.map(({ actor, system, effects }) => {
    const current = new Map(Array.from(actor.effects ?? [], effect => [effect.uuid, effect.toObject()]));
    return {
      actorUuid: actor.uuid,
      system: foundry.utils.diffObject(system, snapshotActorSystem(actor)),
      effectsCreated: Array.from(current.keys()).filter(id => !effects.has(id)),
      effectsDeleted: Array.from(effects.keys()).filter(id => !current.has(id)),
      effectsUpdated: Array.from(current.keys()).filter(id => effects.has(id)
        && Object.keys(foundry.utils.diffObject(effects.get(id), current.get(id))).length),
    };
  }).filter(change => Object.keys(change.system).length || change.effectsCreated.length
    || change.effectsDeleted.length || change.effectsUpdated.length);
}

function interrupted(message, options = {}) {
  return Object.assign(new Error(message), options);
}

async function synchronize(message, outcome, receipt) {
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
      const next = { ...entry, status: receipt.status, error: receipt.error ?? "", result: receipt.result ?? null };
      if (Object.keys(foundry.utils.diffObject(entry, next)).length) {
        Object.assign(entry, next);
        envelope.revision = Number(envelope.revision ?? 0) + 1;
        if (!await requestUpdateChatMessage(message, { [`flags.${SYSTEM_ID}.chatOutcomes`]: envelope })) return false;
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
  if (!outcome) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
  return _actorQueue(outcome.targetUuid, async () => {
    const queueWaitMs = startedAt === null ? null : monoMs() - startedAt;
    let result;
    try {
      result = await executeOutcome(request, { startedAt });
      return result;
    } finally {
      if (startedAt !== null) perfRecord({ event: "outcome.application", kind: outcome.kind,
        messageId: message.id, outcomeId: outcome.id, actorUuid: outcome.targetUuid,
        automatic: request.data.automatic === true, mode: getOutcomeApplicationMode(),
        ok: result?.ok === true, code: result?.code ?? null, queueWaitMs, durationMs: monoMs() - startedAt });
    }
  });
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
    if (!actor || !current) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
    if (authorityFor(data)?.id !== game.user?.id || !canApplyChatOutcome(requester, live, current, { automatic: data.automatic === true })) {
      return { ok: false, code: AUTHORITY_RESULT_CODES.UNAUTHORIZED };
    }
    let receipt = getChatOutcomeReceipt(live, current);
    if (receipt?.status === "processing" && receipt.processorUserId !== game.user.id
      && game.users.get(receipt.processorUserId)?.active) return { ok: false, code: AUTHORITY_RESULT_CODES.CONFLICT };
    if (receipt && ["applied", "partial"].includes(receipt.status)) {
      await synchronize(live, current, receipt);
      return { ok: receipt.status === "applied", code: receipt.status === "partial" ? AUTHORITY_RESULT_CODES.FAILED : null };
    }
    if (!receipt && ["applied", "partial"].includes(current.status)) return { ok: true };
    if (Number(expectedRevision ?? current.revision) !== current.revision) return { ok: false, code: AUTHORITY_RESULT_CODES.STALE_REVISION };
    const id = receiptId(live, current);
    stopPerfApplication = perfTrackApplication(actor, { id, receiptId: id, messageId: live.id,
      outcomeId: current.id, outcomeStartedAt: startedAt, kind: current.kind });
    // Skips have no consequential writes. Include them in the next durable
    // checkpoint rather than issuing separate Actor updates for bookkeeping.
    const skippedStages = {};
    const save = async change => {
      receipt = await updateDamageReceipt(actor, id, previous => ({
        messageId: live.id, outcomeId: current.id, adapter: current.adapter, kind: current.kind,
        targetUuid: actor.uuid, authorizedBy: requester.id, authorizedAutomatic: data.automatic === true, cardSynchronized: false,
        ...previous, ...change,
        stages: { ...previous?.stages, ...change.stages, ...skippedStages },
        processorUserId: game.user.id, processorSession: _sessionId,
      }));
      for (const key of Object.keys(skippedStages)) delete skippedStages[key];
      return receipt;
    };
    const context = {
      message: live, outcome: current, actor,
      receiptId: current.adapter === "combat.inline" && !current.damage.application?.id
        ? `${live.id}:${actor.uuid}:${current.kind}` : `${id}:health`,
      async stage(key, run, { documents = [actor], requiresGM = false, applicable = null } = {}) {
        const metadata = { messageId: live.id, outcomeId: current.id, actorUuid: actor.uuid,
          outcomeKind: current.kind, stageKey: key };
        return measurePerfStage("outcome", "stage", metadata, async () => {
          const prior = skippedStages[key] ?? receipt?.stages?.[key];
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
          await save({ status: "processing", stages: { ...receipt?.stages, [key]: { status: "started" } } });
          let snapshots = [];
          let observedChanges = null;
          try {
            if (data.automatic === true && getOutcomeApplicationMode() !== "automatic") {
              await save({ status: "waitingGM", stages: { ...receipt.stages, [key]: { status: "waitingGM" } } });
              throw interrupted("Automatic application was stopped by the world setting.", { pendingGM: true });
            }
            snapshots = await measurePerfStage("outcome", "snapshotBefore", metadata, () => captureStageActors(documents));
            const result = await run();
            const failed = result === false || result?.ok === false || result?.success === false || result?.failed === true;
            const partial = result?.execution?.status === "partial" || result?.failed?.length > 0;
            const status = failed || partial ? "partial" : "applied";
            const saved = compactResult(result);
            observedChanges = await measurePerfStage("outcome", "snapshotAfter", metadata, () => observeStageChanges(snapshots));
            await save({ stages: { ...receipt.stages, [key]: { status, result: saved, observedChanges } } });
            if (status === "partial") throw interrupted("A consequential stage was not fully applied.", { partial: true });
            return result ?? saved;
          } catch (error) {
            if (!error.pendingGM) await save({ stages: { ...receipt.stages, [key]: {
              ...receipt.stages?.[key],
              status: error.committed === false ? "failed" : "partial", error: String(error.message ?? error),
              observedChanges: observedChanges ?? await measurePerfStage("outcome", "snapshotAfter", metadata, () => observeStageChanges(snapshots)),
            } } });
            throw error;
          }
        });
      },
    };
    try {
      const result = await _adapters.get(current.adapter)(current, context);
      await save({ status: "applied", result: compactResult(result), error: "" });
    } catch (error) {
      const committed = Object.entries(receipt?.stages ?? {}).some(([key, stage]) => key !== "castContext"
        && stage.status === "applied" && stage.result?.skipped !== true);
      await save({ status: error.pendingGM ? "waitingGM" : error.committed === false && !committed ? "failed" : "partial", error: String(error.message ?? error) });
      if (!error.pendingGM) console.error("UESRPG | Chat outcome application failed", error);
    }
    await synchronize(live, current, receipt);
    return { ok: receipt.status === "applied", code: receipt.status === "waitingGM" ? AUTHORITY_RESULT_CODES.NO_ACTIVE_GM : receipt.status === "applied" ? null : AUTHORITY_RESULT_CODES.FAILED };
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
    for (const entry of entries) if (!envelope.entries.some(previous => previous.id === entry.id)) envelope.entries.push(entry);
    envelope.revision = Number(envelope.revision ?? 0) + 1;
    if (!await requestUpdateChatMessage(message, { [`flags.${SYSTEM_ID}.chatOutcomes`]: envelope })) throw new Error("The resolved outcomes were not saved.");
    return message;
  } finally { releaseLock(lockKey); }
}

export async function queueHealingOutcome(actor, amount, options = {}) {
  return persistChatOutcomes({ actor, content: `<div class="uesrpg"><b>${escapeHtml(options.source ?? "Healing")}</b></div>`,
    entries: [createChatOutcome({ adapter: "healing", kind: "healing", sourceActorUuid: actor.uuid,
      targetUuid: actor.uuid, label: options.source ?? "Healing", payload: { ...options, amount } })] });
}

async function processOutcome(message, outcome, queuedAt = null) {
  let receipt = getChatOutcomeReceipt(message, outcome);
  const selected = authorityFor({ messageId: message.id, outcomeId: outcome.id })?.id === game.user.id;
  if (receipt?.status === "processing" && selected
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
    await synchronize(message, outcome, receipt);
    return;
  }
  if (["applied", "partial", "failed", "processing"].includes(receipt?.status ?? outcome.status)) return;
  const automatic = canApplyChatOutcome(game.user, message, outcome, { automatic: true });
  const authorized = receipt?.status === "waitingGM" && receipt.authorizedBy && selected
    && (!receipt.authorizedAutomatic || getOutcomeApplicationMode() === "automatic")
    && canApplyChatOutcome(game.user, message, outcome);
  if (!automatic && !authorized) return;
  const requester = game.user;
  if (!requester || !canApplyChatOutcome(requester, message, outcome, { automatic })) return;
  await execute({ requester, data: { messageId: message.id, outcomeId: outcome.id, automatic }, expectedRevision: outcome.revision }, { queuedAt });
}

function isOutcomeUpdate(changes) {
  if (!changes) return true;
  const paths = [`flags.${SYSTEM_ID}.opposed`, `flags.${SYSTEM_ID}.magicOpposed`, `flags.${SYSTEM_ID}.chatOutcomes`, "whisper", "blind", "user"];
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
    signature: JSON.stringify([entry.outcomeId, entry.status, entry.error ?? "", entry.result?.message ?? ""]),
  }]));
}

function outcomePresentation(message, outcome) {
  const receipt = getChatOutcomeReceipt(message, outcome);
  const result = receipt?.result ?? outcome.result;
  return {
    id: outcome.id,
    label: outcome.label || "",
    targetName: resolveActorFromUuidSync(outcome.targetUuid)?.name ?? "Target",
    controls: controls(message, outcome, receipt),
    note: result?.message || "",
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
      const signature = JSON.stringify(outcomes.map(outcome => outcomePresentation(message, outcome)));
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
    for (const adapter of ["healing", "damage.resolved", "resource.delta", "combat.coup", "combat.special", "alchemy.potion", "alchemy.spell", "alchemy.toxin", "alchemy.poison", "ability.effects", "ability.status", "magic.consequences", "magic.spell", "magic.origin", "warfare.clash"]) {
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
  async apply(message, data = {}) {
    const outcome = findOutcome(message, data);
    if (!outcome || !canApplyChatOutcome(game.user, message, outcome)) return false;
    const request = { messageId: message.id, outcomeId: outcome.id, targetUuid: outcome.targetUuid, kind: outcome.kind };
    const authority = authorityFor(request);
    const result = authority?.id === game.user.id
      ? await execute({ requester: game.user, data: request, expectedRevision: outcome.revision })
      : await requestAuthorityIntent(COMMAND, request, { expectedRevision: outcome.revision, timeout: 60_000 });
    if (!result?.ok) ui.notifications?.warn?.(t(result?.code === AUTHORITY_RESULT_CODES.NO_ACTIVE_GM
      ? "UESRPG.Chat.Common.OutcomeWaitingGM" : "UESRPG.Chat.Common.ApplicationFailed"));
    return result?.ok === true;
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
    const outcomes = getChatOutcomes(message, { includePayload: false });
    const presentations = outcomes.map(outcome => outcomePresentation(message, outcome));
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
      return `<div class="uesrpg-chat-outcome"><div class="dmg-action"><span>${escapeHtml(outcome.label || presentation.targetName)}${outcome.label ? `: ${escapeHtml(presentation.targetName)}` : ""}</span>${presentation.controls}</div>${note}</div>`;
    }).join("");
    root.querySelector("[data-ues-chat-outcome-controls]")?.remove();
    const content = root.querySelector(".message-content") ?? root;
    (content.querySelector(".uesrpg-chat-surface") ?? content).appendChild(container);
  },
};
