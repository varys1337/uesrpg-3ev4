/**
 * One authority and durable journal for system-owned XP purchase workflows.
 * Actor and embedded Item updates are separate commits, never a transaction.
 */
import { SYSTEM_ID } from "../system/namespace.js";
import { getActiveGMUser } from "../../utils/users.js";
import {
  doesUserOwnActor, getActorOwnerUser, requestUpdateDocument,
  requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments,
} from "../../utils/authority-proxy.js";
import {
  AUTHORITY_RESULT_CODES as CODES, registerAuthorityIntentCommand,
  registerAuthorityIntentService, requestAuthorityIntent,
} from "../../utils/authority-intents.js";
import { acquireLock, releaseLock, lockKeyForDoc, stableStringify, documentStateFingerprint as digest } from "../../utils/authority-proxy/shared.js";
import { purchaseFieldSnapshot } from "./purchase-projection.js";
import { getTalentLearningMode, TALENT_LEARNING_MODE } from "../traits/talent-learning-support.js";

export const XP_PURCHASE_PATH = `flags.${SYSTEM_ID}.advancementPurchases`;
export const XP_PURCHASE_ITEM_FLAG = "advancementPurchase";
const COMMAND = "advancement.purchase";
const VERSION = 1;
const RECORD_ENCODING = "json-v1";
const TERMINAL_LIMIT = 50;
const pendingIntents = new Map();
let buildPlan;
let sessionId;
let registered = false;

const clone = value => foundry.utils.deepClone(value);
const safeId = value => /^[A-Za-z0-9_-]{8,64}$/.test(String(value ?? ""));

export function readXpPurchaseJournal(actor) {
  let value = actor?.getFlag?.(SYSTEM_ID, "advancementPurchases");
  if (value == null) return { version: VERSION, revision: 0, active: null, receipts: [] };
  // Purchase patches and snapshots contain literal dotted keys. Native document
  // updates expand those keys even inside flags, so persist each complete record
  // as JSON and decode it at this boundary. Unencoded v1 journals remain readable
  // for explicit GM reconciliation; an unfinished purchase is never replayed.
  if (value.recordEncoding != null) {
    if (value.recordEncoding !== RECORD_ENCODING || !Array.isArray(value.receipts)
        || (value.active != null && typeof value.active !== "string")
        || value.receipts.some(record => typeof record !== "string")) {
      return { unsupported: true, active: null, receipts: [] };
    }
    try {
      value = { version: value.version, revision: value.revision,
        active: value.active == null ? null : JSON.parse(value.active), receipts: value.receipts.map(record => JSON.parse(record)) };
    } catch (_error) { return { unsupported: true, active: null, receipts: [] }; }
  }
  if (value.version !== VERSION || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !Array.isArray(value.receipts) || (value.active != null && typeof value.active !== "object")
      || [...value.receipts, ...(value.active ? [value.active] : [])].some(record => !safeId(record?.id)
        || record.intent?.version !== VERSION || record.intent?.actorUuid !== actor.uuid || !Array.isArray(record.steps)
        || !["applying", "needsReview", "complete", "rejected", "resolved"].includes(record.status))) {
    return { unsupported: true, active: null, receipts: [] };
  }
  return clone(value);
}

function encodePurchaseJournal(journal) {
  return { version: journal.version, revision: journal.revision, recordEncoding: RECORD_ENCODING,
    active: journal.active == null ? null : JSON.stringify(journal.active),
    receipts: journal.receipts.map(record => JSON.stringify(record)) };
}

function actorView(actor) {
  const source = actor.toObject(true);
  const system = source.system ?? {};
  const chargen = source.flags?.[SYSTEM_ID]?.chargen ?? {};
  return {
    xp: system.xp, xpTotal: system.xpTotal, wealth: system.wealth,
    race: system.race, characteristics: system.characteristics,
    effects: source.effects ?? [],
    chargen: {
      completed: chargen.completed, allowRitualLearning: chargen.allowRitualLearning,
      finalSummary: chargen.finalSummary, grants: chargen.grants,
      combatStyleSetup: chargen.combatStyleSetup,
    },
  };
}

function itemView(item) {
  const source = item.toObject(true);
  const flags = clone(source.flags ?? {});
  if (flags[SYSTEM_ID]) delete flags[SYSTEM_ID][XP_PURCHASE_ITEM_FLAG];
  return { name: source.name, type: source.type, system: source.system, effects: source.effects ?? [], flags };
}

async function itemHashes(actor, exclude = new Set()) {
  const entries = await Promise.all(Array.from(actor.items ?? []).filter(item => !exclude.has(item.id))
    .map(async item => [item.id, await digest(itemView(item))]));
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

export async function getXpPurchaseSnapshot(actor) {
  const journal = readXpPurchaseJournal(actor);
  if (journal.unsupported) throw new Error("Unsupported advancement purchase journal.");
  const view = actorView(actor);
  const hashes = await itemHashes(actor);
  return { revision: journal.revision, fingerprint: await digest({ actor: view, items: hashes }) };
}

async function resolveActor(uuid) {
  const actor = await fromUuid(String(uuid ?? ""));
  return actor?.documentName === "Actor" ? actor : null;
}

async function authorityFor(data) {
  const actor = await resolveActor(data?.intent?.actorUuid ?? data?.actorUuid);
  return actor ? (getActiveGMUser() ?? getActorOwnerUser(actor)) : null;
}

function outcome(status, record = null, code = null, reason = "", replayed = false) {
  return {
    ok: status === "complete", status, code, reason,
    operationId: record?.id ?? null, actorUuid: record?.intent?.actorUuid ?? null,
    xpCost: record?.xpCost ?? 0, wealthCost: record?.wealthCost ?? 0,
    itemUuids: (record?.steps ?? []).map(step => step.itemUuid).filter(Boolean),
    replayed, ...(record?.result ?? {}),
  };
}

function envelope(result, prepared = false) {
  // The authority envelope describes delivery. Purchase status is explicit data.
  return { ok: result.ok || prepared, code: result.code, data: { purchase: result } };
}

function blocked(journal) {
  if (journal.unsupported) return outcome("rejected", null, CODES.INVALID_REQUEST, "Unsupported advancement purchase journal.");
  if (!journal.active) return null;
  const record = journal.active;
  const uncertain = record.status === "needsReview" || record.processorUserId !== game.user.id || record.processorSession !== sessionId;
  return outcome(uncertain ? "needsReview" : "processing", record, CODES.CONFLICT,
    record.error || "A purchase is unfinished. Review its recorded steps before making another purchase.");
}

function marker(record, step) {
  return { version: VERSION, actorUuid: record.intent.actorUuid, operationId: record.id, stepId: step.key };
}

function markItemData(data, record, step) {
  const value = clone(data);
  foundry.utils.setProperty(value, `flags.${SYSTEM_ID}.${XP_PURCHASE_ITEM_FLAG}`, marker(record, step));
  return value;
}

export function isManagedXpPurchaseItem(actor, item) {
  const proof = item?.getFlag?.(SYSTEM_ID, XP_PURCHASE_ITEM_FLAG) ?? item?.flags?.[SYSTEM_ID]?.[XP_PURCHASE_ITEM_FLAG];
  const active = readXpPurchaseJournal(actor).active;
  if (proof?.version !== VERSION || proof.actorUuid !== actor?.uuid || proof.operationId !== active?.id) return false;
  const step = active.steps?.find(entry => entry.key === proof.stepId && entry.kind === "create");
  if (!step) return false;
  try {
    return foundry.utils.isEmpty(item.updateSource(clone(step.data), { dryRun: true, fallback: false }));
  } catch (_error) { return false; }
}

async function saveActive(actor, journal, record) {
  const checkpoint = JSON.parse(JSON.stringify(record));
  const next = { ...journal, active: checkpoint };
  if (!await requestUpdateDocument(actor, { [XP_PURCHASE_PATH]: encodePurchaseJournal(next) }, { render: false })) throw new Error("Purchase checkpoint was not confirmed.");
  const saved = readXpPurchaseJournal(actor);
  if (saved.active?.id !== record.id || stableStringify(saved.active) !== stableStringify(checkpoint)) throw new Error("Purchase checkpoint changed during persistence.");
  return saved;
}

async function recordRejectedPurchase(actor, intent, requester, code, reason) {
  const journal = readXpPurchaseJournal(actor);
  const record = { id: intent.id, intent: clone(intent), requesterUserId: requester.id,
    status: "rejected", code, error: reason, finishedAt: Date.now(), xpCost: 0, wealthCost: 0, steps: [] };
  // Bind accepted IDs even when validation rejects them. A stale request never
  // writes over a newer journal or an in-progress purchase.
  if (!journal.unsupported && !journal.active && journal.revision === intent.expected?.revision) {
    const next = { ...journal, revision: journal.revision + 1, receipts: [...journal.receipts, record].slice(-TERMINAL_LIMIT) };
    await requestUpdateDocument(actor, { [XP_PURCHASE_PATH]: encodePurchaseJournal(next) }, { render: false });
  }
  return outcome("rejected", record, code, reason);
}

async function needsReview(actor, record, error) {
  const current = readXpPurchaseJournal(actor);
  if (current.active?.id !== record.id) {
    const complete = current.receipts.find(receipt => receipt.id === record.id);
    if (complete?.status === "complete" && !error?.purchaseStateMismatch) return outcome("complete", complete, null, "", true);
    if (complete?.status === "complete" && error?.purchaseStateMismatch) {
      record.status = "needsReview";
      record.error = String(error.message);
      record.observedResources = { xp: actor.system.xp, wealth: actor.system.wealth };
      try {
        await saveActive(actor, { ...current, revision: current.revision + 1, receipts: current.receipts.filter(entry => entry.id !== record.id) }, record);
      } catch (checkpointError) {
        console.error("UESRPG | Purchase mismatch checkpoint failed", { actorUuid: actor.uuid, operationId: record.id, error: checkpointError });
      }
      return outcome("needsReview", record, CODES.FAILED, record.error);
    }
    return outcome("needsReview", record, CODES.CONFLICT, "Purchase state changed. A GM must inspect the recorded operation.");
  }
  record.status = "needsReview";
  record.error = String(error?.message ?? error);
  try { await saveActive(actor, current, record); }
  catch (checkpointError) { console.error("UESRPG | Purchase recovery checkpoint failed", { actorUuid: actor.uuid, operationId: record.id, error: checkpointError }); }
  return outcome("needsReview", record, CODES.FAILED, record.error);
}

async function checkAuthority(actor, record) {
  const selected = await authorityFor({ actorUuid: actor.uuid });
  const current = readXpPurchaseJournal(actor).active;
  if (selected?.id !== game.user.id || current?.id !== record.id
      || current.processorUserId !== game.user.id || current.processorSession !== sessionId) {
    throw new Error("Purchase authority or processor session changed; manual review is required.");
  }
}

function validateStep(item, data) {
  item.updateSource(clone(data), { dryRun: true, fallback: false });
}

async function verifyBaseline(actor, record, excludedIds) {
  if (await digest(actorView(actor)) !== record.actorFingerprint) throw new Error("Actor resources or purchase prerequisites changed during the purchase.");
  const before = Object.fromEntries(Object.entries(record.itemFingerprints).filter(([id]) => !excludedIds.has(id)));
  if (stableStringify(before) !== stableStringify(await itemHashes(actor, excludedIds))) {
    throw new Error("Other owned Items changed during the purchase.");
  }
}

async function completePlan(actor, record, plan, results) {
  await checkAuthority(actor, record);
  if (!doesUserOwnActor(game.users.get(record.requesterUserId), actor)) throw new Error("The purchase requester no longer owns the Actor.");
  const touched = new Set(record.steps.map(step => step.itemId).filter(Boolean));
  await verifyBaseline(actor, record, touched);
  const lastSteps = new Map(record.steps.filter(step => step.itemId).map(step => [step.itemId, step]));
  for (const [id, step] of lastSteps) {
    const item = actor.items.get(id);
    if (step.kind === "delete" ? item != null : !item || await digest(itemView(item)) !== step.afterFingerprint) {
      throw new Error("A confirmed purchase Item changed before the Actor resource commit.");
    }
  }
  const finalData = plan.finalize ? await plan.finalize(actor, results) : {};
  const patch = { ...clone(record.actorChanges), ...finalData };
  record.status = "complete";
  record.finishedAt = Date.now();
  record.result = clone(plan.result ? plan.result(results) : {});
  const journal = readXpPurchaseJournal(actor);
  const receipts = [...journal.receipts, clone(record)].slice(-TERMINAL_LIMIT);
  const next = { ...journal, active: null, receipts };
  patch[XP_PURCHASE_PATH] = encodePurchaseJournal(next);
  actor.updateSource(clone(patch), { dryRun: true, fallback: false });
  const confirmed = await requestUpdateDocument(actor, patch);
  const persisted = readXpPurchaseJournal(actor).receipts.find(entry => entry.id === record.id && entry.status === "complete");
  if (!confirmed && !persisted) throw new Error("Item changes may have committed, but the Actor resource/completion write was not confirmed.");
  if (!persisted || !foundry.utils.isEmpty(actor.updateSource(clone(patch), { dryRun: true, fallback: false }))) {
    const error = new Error("The final Actor state does not match the confirmed purchase.");
    error.purchaseStateMismatch = true;
    throw error;
  }
  return outcome("complete", persisted);
}

async function applySteps(actor, record, plan) {
  const results = {};
  for (const step of record.steps) {
    await checkAuthority(actor, record);
    const itemId = step.itemId ?? results[step.ref]?.id;
    const item = itemId ? actor.items.get(itemId) : null;
    if (step.kind !== "create" && !item) throw new Error("A purchase Item is no longer available.");
    if (item && step.beforeFields && stableStringify(purchaseFieldSnapshot(item.toObject(true), Object.keys(step.beforeFields))) !== stableStringify(step.beforeFields)) {
      throw new Error("A purchase Item changed before its write.");
    }
    step.status = "started";
    await saveActive(actor, readXpPurchaseJournal(actor), record);
    if (step.kind === "create") {
      const source = markItemData(step.data, record, step);
      const created = await requestCreateEmbeddedDocuments(actor, "Item", [source]);
      const value = created?.[0];
      if (!value || !isManagedXpPurchaseItem(actor, value)) throw new Error("Item creation was not confirmed; inspect the purchase marker before retrying.");
      step.itemId = value.id;
      step.itemUuid = value.uuid;
      results[step.key] = value;
    } else if (step.kind === "update") {
      validateStep(item, step.data);
      const patch = markItemData(step.data, record, step);
      if (!await requestUpdateDocument(item, patch)
          || !foundry.utils.isEmpty(item.updateSource(clone(patch), { dryRun: true, fallback: false }))) {
        throw new Error("Item update was not confirmed; manual review is required.");
      }
      step.itemId = item.id;
      step.itemUuid = item.uuid;
      results[step.key] = item;
    } else if (step.kind === "delete") {
      step.itemId = item.id;
      step.itemUuid = item.uuid;
      if (!await requestDeleteEmbeddedDocuments(actor, "Item", [item.id]) || actor.items.has(item.id)) throw new Error("Item deletion was not confirmed; manual review is required.");
      results[step.key] = { id: item.id, uuid: item.uuid };
    } else throw new Error("Unsupported purchase step.");
    step.status = "confirmed";
    if (step.kind !== "delete") step.afterFingerprint = await digest(itemView(results[step.key]));
    await saveActive(actor, readXpPurchaseJournal(actor), record);
  }
  return completePlan(actor, record, plan, results);
}

async function execute({ requester, data }) {
  const intent = data?.intent;
  if (!intent || intent.version !== VERSION || !safeId(intent.id) || !buildPlan) return envelope(outcome("rejected", null, CODES.INVALID_REQUEST, "Invalid purchase request."));
  const respond = (result, prepared = false) => envelope({ ...result,
    operationId: result.operationId ?? intent.id, actorUuid: result.actorUuid ?? intent.actorUuid }, prepared);
  const actor = await resolveActor(intent.actorUuid);
  if (!actor || !doesUserOwnActor(requester, actor) || !doesUserOwnActor(game.user, actor)
      || (await authorityFor(data))?.id !== game.user.id) return respond(outcome("rejected", null, CODES.UNAUTHORIZED, "Native Actor ownership is required."));
  const key = lockKeyForDoc(actor);
  let acquired = false;
  let record;
  try {
    await acquireLock(key);
    acquired = true;
    const journal = readXpPurchaseJournal(actor);
    if (journal.unsupported) return respond(blocked(journal));
    const identity = stableStringify(intent);
    const prior = journal.receipts.find(entry => entry.id === intent.id) ?? (journal.active?.id === intent.id ? journal.active : null);
    if (prior) {
      if (stableStringify(prior.intent) !== identity || prior.requesterUserId !== requester.id) return respond(outcome("rejected", prior, CODES.CONFLICT, "Operation ID was reused for a different purchase."));
      return respond(prior.status === "complete" ? outcome("complete", prior, null, "", true)
        : prior.status === "rejected" ? outcome("rejected", prior, prior.code, prior.error, true)
          : prior.status === "resolved" ? outcome("rejected", prior, CODES.CONFLICT, "This operation was manually reconciled and cannot be replayed.") : blocked(journal));
    }
    const busy = blocked(journal);
    if (busy) return respond(busy);
    const snapshot = await getXpPurchaseSnapshot(actor);
    if (intent.expected?.revision !== snapshot.revision || intent.expected?.fingerprint !== snapshot.fingerprint) {
      return respond(outcome("rejected", null, CODES.STALE_REVISION, "Purchase state changed. Reopen or restage the purchase."));
    }
    const plan = await buildPlan(actor, clone(intent), { requester });
    if (!plan?.ok) return respond(await recordRejectedPurchase(actor, intent, requester, CODES.INVALID_REQUEST, plan?.reason || "Purchase validation failed."));
    if (intent.quote && (Number(intent.quote.xpCost) !== plan.xpCost || Number(intent.quote.wealthCost) !== (plan.wealthCost ?? 0))) {
      return respond(await recordRejectedPurchase(actor, intent, requester, CODES.STALE_REVISION, "The purchase cost changed. Review a fresh quote."));
    }
    // Preparation may await compendium reads. Recheck before the first write.
    if (stableStringify(snapshot) !== stableStringify(await getXpPurchaseSnapshot(actor))) return respond(outcome("rejected", null, CODES.STALE_REVISION, "Actor state changed while planning the purchase."));
    const actorChanges = clone(plan.actorPatch ?? {});
    actor.updateSource(clone(actorChanges), { dryRun: true, fallback: false });
    record = {
      id: intent.id, intent: clone(intent), status: "applying", requesterUserId: requester.id,
      processorUserId: game.user.id, processorSession: sessionId, startedAt: Date.now(),
      xpCost: plan.xpCost ?? 0, wealthCost: plan.wealthCost ?? 0, actorChanges,
      actorFingerprint: await digest(actorView(actor)), itemFingerprints: await itemHashes(actor),
      steps: clone(plan.steps ?? []).map((step, index) => ({ ...step, key: step.key ?? `step${index}`, status: "planned" })),
      native: data.phase === "prepareNative", details: clone(plan.details ?? {}),
    };
    const validationItems = new Map();
    for (const step of record.steps) {
      if (record.native) step.status = "started";
      let pending;
      if (step.kind === "create") {
        pending = new Item.implementation(clone(step.data), { parent: actor, strict: true, fallback: false });
        pending.validate({ strict: true, fallback: false, dropInvalidElements: false, dropInvalidEmbedded: false });
        validationItems.set(step.key, pending);
      }
      if (step.itemId) {
        const item = actor.items.get(step.itemId);
        if (!item || !item.canUserModify(requester, step.kind === "delete" ? "delete" : "update")) throw new Error("Native Item modification permission is required.");
        step.before = item.toObject(true);
        pending = validationItems.get(item.id);
        if (!pending && step.kind === "update") {
          pending = new Item.implementation(clone(step.before), { parent: actor, strict: true, fallback: false });
          validationItems.set(item.id, pending);
        }
      } else if (step.ref) pending = validationItems.get(step.ref);
      if (step.kind === "update") {
        if (!pending) throw new Error("The projected purchase Item is unavailable.");
        pending.updateSource(clone(step.data), { fallback: false });
      }
    }
    await saveActive(actor, { ...journal, revision: journal.revision + 1 }, record);
    if (record.native) return respond({ ...outcome("processing", record), ok: true, markers: record.steps.map(step => marker(record, step)) }, true);
    return respond(await applySteps(actor, record, plan));
  } catch (error) {
    const saved = record && readXpPurchaseJournal(actor);
    if (record && (saved.active?.id === record.id || saved.receipts.some(receipt => receipt.id === record.id))) {
      return respond(await needsReview(actor, record, error));
    }
    return respond(outcome("rejected", record, CODES.FAILED, String(error?.message ?? error)));
  } finally { if (acquired) releaseLock(key); }
}

async function reconcile({ requester, data }) {
  const actor = await resolveActor(data?.actorUuid);
  const reason = String(data?.reason ?? "").trim();
  if (!requester?.isGM || !actor || reason.length < 3 || (await authorityFor(data))?.id !== game.user.id) {
    return envelope(outcome("rejected", null, CODES.UNAUTHORIZED, "GM reconciliation and a reason are required."));
  }
  const key = lockKeyForDoc(actor);
  let acquired = false;
  try {
    await acquireLock(key);
    acquired = true;
    const journal = readXpPurchaseJournal(actor);
    const record = journal.active;
    if (journal.unsupported || !record || record.id !== data.operationId
        || stableStringify(await getXpPurchaseSnapshot(actor)) !== stableStringify(data.expected)) {
      return envelope(outcome("rejected", record, CODES.STALE_REVISION, "The reviewed state changed. Inspect it again."));
    }
    if (data.processorStopped !== true) return envelope(outcome("needsReview", record, CODES.CONFLICT, "Confirm the previous operation was stopped and the documents were manually reconciled."));
    const resolved = { ...record, status: "resolved", finishedAt: Date.now(), reconciliation: { reason, userId: requester.id, snapshot: data.expected } };
    const next = { ...journal, revision: journal.revision + 1, active: null, receipts: [...journal.receipts, resolved].slice(-TERMINAL_LIMIT) };
    await requestUpdateDocument(actor, { [XP_PURCHASE_PATH]: encodePurchaseJournal(next) });
    if (stableStringify(readXpPurchaseJournal(actor)) !== stableStringify(JSON.parse(JSON.stringify(next)))) {
      return envelope(outcome("needsReview", record, CODES.FAILED, "Reconciliation record was not confirmed."));
    }
    for (const [cacheKey, intent] of pendingIntents) if (intent.id === record.id) pendingIntents.delete(cacheKey);
    return envelope({ ...outcome("complete", resolved), reconciled: true });
  } catch (error) { return envelope(outcome("needsReview", null, CODES.FAILED, error.message)); }
  finally { if (acquired) releaseLock(key); }
}

export function registerXpPurchaseService(planner) {
  if (registered) return;
  if (typeof planner !== "function") throw new Error("An advancement purchase planner is required.");
  buildPlan = planner;
  sessionId = foundry.utils.randomID(24);
  registerAuthorityIntentService();
  if (!registerAuthorityIntentCommand(COMMAND, request => request.data?.phase === "review" ? reconcile(request) : execute(request),
    { persistProcessing: false, resolveAuthority: authorityFor })) throw new Error("Advancement purchase authority command is already registered.");
  registered = true;
}

export async function quoteXpPurchase(actor, workflow, choices) {
  if (!buildPlan || !doesUserOwnActor(game.user, actor)) return { ok: false, reason: "Actor ownership is required." };
  const journal = readXpPurchaseJournal(actor);
  if (journal.unsupported || journal.active) return blocked(journal);
  try {
    const expected = await getXpPurchaseSnapshot(actor);
    const plan = await buildPlan(actor, { workflow, choices: clone(choices) }, { requester: game.user });
    return plan?.ok ? { ok: true, expected, xpCost: plan.xpCost ?? 0, wealthCost: plan.wealthCost ?? 0, details: clone(plan.details ?? {}) }
      : { ok: false, reason: plan?.reason || "Purchase validation failed." };
  } catch (error) { return { ok: false, reason: String(error?.message ?? error) }; }
}

export async function requestXpPurchase(actor, workflow, choices, { quote = null, expected = null, phase = "execute" } = {}) {
  const cacheKey = `${actor?.uuid}:${workflow}:${await digest(choices)}`;
  let intent = pendingIntents.get(cacheKey);
  if (!intent) {
    const journal = readXpPurchaseJournal(actor);
    if (journal.active && journal.active.intent.workflow === workflow
        && stableStringify(journal.active.intent.choices) === stableStringify(choices)
        && journal.active.requesterUserId === game.user.id) intent = clone(journal.active.intent);
    else {
      const prepared = quote ?? await quoteXpPurchase(actor, workflow, choices);
      if (!prepared.ok) return outcome(journal.active ? "needsReview" : "rejected", journal.active, CODES.CONFLICT, prepared.reason);
      intent = { version: VERSION, id: foundry.utils.randomID(24), actorUuid: actor.uuid, workflow, choices: clone(choices),
        expected: expected ?? prepared.expected, quote: { xpCost: prepared.xpCost, wealthCost: prepared.wealthCost } };
    }
    pendingIntents.set(cacheKey, intent);
  }
  const response = await requestAuthorityIntent(COMMAND, { intent, phase }, { timeout: 15_000 });
  const result = response?.data?.purchase;
  if (result?.ok && phase !== "prepareNative") pendingIntents.delete(cacheKey);
  if (result?.status === "rejected") pendingIntents.delete(cacheKey);
  if (result) return result;
  // A failed query is ambiguous. Inspect durable evidence before reporting it,
  // and retain this exact intent for a subsequent status/replay request.
  const observed = readXpPurchaseJournal(actor);
  const receipt = observed.receipts.find(entry => entry.id === intent.id);
  if (receipt?.status === "complete") {
    pendingIntents.delete(cacheKey);
    return outcome("complete", receipt, null, "", true);
  }
  if (observed.active?.id === intent.id && observed.active.status === "needsReview") return outcome("needsReview", observed.active, CODES.CONFLICT, observed.active.error);
  const rejected = !observed.active && [CODES.INVALID_REQUEST, CODES.UNAUTHORIZED, CODES.NO_ACTIVE_GM, CODES.EXPIRED].includes(response?.code);
  if (rejected) pendingIntents.delete(cacheKey);
  return outcome(rejected ? "rejected" : "processing", { id: intent.id, intent }, response?.code ?? CODES.FAILED,
    rejected ? "Purchase request was rejected before execution." : "Purchase confirmation is unavailable. Check the Actor purchase record before retrying.");
}

export async function requestXpPurchaseReconciliation(actor, operationId, reason, expected, { processorStopped = false } = {}) {
  const response = await requestAuthorityIntent(COMMAND, { phase: "review", actorUuid: actor.uuid, operationId, reason, expected, processorStopped });
  return response?.data?.purchase ?? outcome("needsReview", null, response?.code ?? CODES.FAILED, "Reconciliation was not confirmed.");
}

/** Called only from the documented Item batch creation override. */
export async function prepareNativeTalentPurchases(documents, _operation, user) {
  if (user.id !== game.user.id || getTalentLearningMode() !== TALENT_LEARNING_MODE.ENFORCE) return true;
  const talents = documents.filter(item => item.type === "talent" && item.actor?.type === "Player Character" && !isManagedXpPurchaseItem(item.actor, item));
  if (!talents.length) return true;
  const actor = talents[0].actor;
  if (talents.some(item => item.actor?.uuid !== actor.uuid)) return false;
  const items = talents.map(item => {
    const source = item.toObject(true);
    delete source._id;
    if (source.flags?.[SYSTEM_ID]) delete source.flags[SYSTEM_ID][XP_PURCHASE_ITEM_FLAG];
    return source;
  });
  const quote = await quoteXpPurchase(actor, "nativeTalent", { items });
  if (quote.ok && quote.xpCost === 0) return true;
  const result = quote.ok ? await requestXpPurchase(actor, "nativeTalent", { items }, { quote, phase: "prepareNative" }) : quote;
  if (!result.ok || !result.markers) {
    ui.notifications?.warn?.(result.reason || "Talent purchase could not be prepared.");
    return false;
  }
  talents.forEach((item, index) => item.updateSource({ [`flags.${SYSTEM_ID}.${XP_PURCHASE_ITEM_FLAG}`]: result.markers[index] }));
  return true;
}

/** Complete only the current authority's prepared native batch, never a recovery replay. */
export async function finalizeNativeTalentPurchases(documents) {
  const groups = new Map();
  for (const item of documents) {
    const actor = item.actor;
    const record = actor && readXpPurchaseJournal(actor).active;
    if (!record?.native || !isManagedXpPurchaseItem(actor, item)) continue;
    groups.set(actor.uuid, actor);
  }
  for (const actor of groups.values()) {
    if ((await authorityFor({ actorUuid: actor.uuid }))?.id !== game.user.id) continue;
    const key = lockKeyForDoc(actor);
    let acquired = false;
    let record;
    try {
      await acquireLock(key);
      acquired = true;
      record = readXpPurchaseJournal(actor).active;
      if (!record?.native || record.status !== "applying") continue;
      await checkAuthority(actor, record);
      const results = {};
      for (const step of record.steps) {
        const matches = Array.from(actor.items).filter(item => {
          const proof = item.getFlag(SYSTEM_ID, XP_PURCHASE_ITEM_FLAG);
          return proof?.operationId === record.id && proof?.stepId === step.key;
        });
        if (matches.length !== 1 || !isManagedXpPurchaseItem(actor, matches[0])) throw new Error("Native talent creation is incomplete or ambiguous.");
        step.itemId = matches[0].id;
        step.itemUuid = matches[0].uuid;
        step.status = "confirmed";
        step.afterFingerprint = await digest(itemView(matches[0]));
        results[step.key] = matches[0];
      }
      await saveActive(actor, readXpPurchaseJournal(actor), record);
      const plan = await buildPlan(actor, record.intent, { requester: game.users.get(record.requesterUserId), nativeItemIds: Object.values(results).map(item => item.id) });
      if (!plan.ok || plan.xpCost !== record.xpCost) throw new Error("Native talent purchase validation changed.");
      const result = await completePlan(actor, record, plan, results);
      if (!result.ok) throw new Error(result.reason);
      for (const [cacheKey, intent] of pendingIntents) if (intent.id === record.id) pendingIntents.delete(cacheKey);
    } catch (error) {
      if (record) await needsReview(actor, record, error);
      ui.notifications?.warn?.(String(error.message));
    } finally { if (acquired) releaseLock(key); }
  }
}
