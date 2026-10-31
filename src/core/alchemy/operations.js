import { acquireLock, releaseLock, lockKeyForDoc, stableStringify } from "../../utils/authority-proxy/shared.js";
import { measurePerfStage } from "../../utils/perf-tracker.js";
import {
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
  requestUpdateDocument,
  requestUpdateChatMessage,
  doesUserOwnActor,
  getActorOwnerUser,
} from "../../utils/authority-proxy.js";
import { createAlchemyOperationResult } from "./utils.js";
import { withActionResult, actionResultFromEvidence } from "../../application/action-results.js";
import { getAlchemyFlags } from "./shared.js";
import { getActiveGMUser } from "../../utils/users.js";
import { resolveActorFromUuidSync } from "../../utils/uuid-cache.js";
import { AUTHORITY_RESULT_CODES, registerAuthorityIntentCommand, registerAuthorityIntentService, requestAuthorityIntent } from "../../utils/authority-intents.js";

function activationResult(value, item) {
  if (value.actionResult) return value;
  return withActionResult(value, actionResultFromEvidence({ owner: "alchemy", scope: "item use and managed consequences",
    confirmed: value.execution?.committed === true, uncertain: value.uncertain === true,
    pending: value.pending === true, partial: value.execution?.status === "partial", blocked: value.ok !== true,
    reason: value.reason, references: { itemUuid: item?.uuid, actorUuid: item?.parent?.uuid } }));
}

export function createAlchemyChatMessage(payload = {}) {
  return ChatMessage.create(payload);
}

export function updateAlchemyChatMessage(message, payload = {}) {
  return requestUpdateChatMessage(message, payload);
}

const _pendingActivations = new Map();
const POTION_CONSUME_COMMAND = "alchemy.consumePotion";
let _potionAuthorityRegistered = false;

function potionAuthority(data) {
  return getActiveGMUser() ?? getActorOwnerUser(resolveActorFromUuidSync(data?.actorUuid));
}

async function consumePotionIntent({ requester, data }) {
  const actor = await fromUuid(String(data?.actorUuid ?? ""));
  const item = await fromUuid(String(data?.itemUuid ?? ""));
  if (!actor || actor.documentName !== "Actor" || !item || item.parent?.uuid !== actor.uuid
    || getAlchemyFlags(item)?.kind !== "potion") return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
  if (!requester?.active || !game.user.active || !doesUserOwnActor(requester, actor) || potionAuthority(data)?.id !== game.user.id) {
    return { ok: false, code: AUTHORITY_RESULT_CODES.UNAUTHORIZED };
  }
  const result = await consumeOwnedItem(item, { validate: fresh => {
    if (fresh.parent?.uuid !== actor.uuid || getAlchemyFlags(fresh)?.kind !== "potion"
      || stableStringify(getAlchemyFlags(fresh)) !== data.alchemyFingerprint) return "The potion changed while its use was being prepared.";
    if (!requester.active || !game.user.active || !doesUserOwnActor(requester, fresh.parent)
      || potionAuthority(data)?.id !== game.user.id) return "Potion permission or authority changed.";
    return null;
  } });
  return { ok: result.ok, code: result.ok ? null : AUTHORITY_RESULT_CODES.FAILED, data: result };
}

export function registerPotionConsumptionAuthority() {
  if (_potionAuthorityRegistered) return;
  registerAuthorityIntentService();
  if (!registerAuthorityIntentCommand(POTION_CONSUME_COMMAND, consumePotionIntent,
    { persistProcessing: false, resolveAuthority: potionAuthority })) throw new Error("Potion consumption authority registration failed.");
  _potionAuthorityRegistered = true;
}

/** Route all potion quantity changes for an Actor through the same elected writer. */
export async function consumePotionAuthoritatively(actor, item, alchemyFingerprint) {
  registerPotionConsumptionAuthority();
  const data = { actorUuid: actor?.uuid, itemUuid: item?.uuid, alchemyFingerprint };
  const authority = potionAuthority(data);
  if (!authority?.active) return createAlchemyOperationResult({ reason: "No active authority can consume this potion." });
  if (authority.id === game.user.id) {
    const result = await consumePotionIntent({ requester: game.user, data });
    return result.data ?? createAlchemyOperationResult({ reason: "Potion consumption was rejected." });
  }
  const response = await requestAuthorityIntent(POTION_CONSUME_COMMAND, data, { timeout: 60_000 });
  if (response.data?.reason !== undefined || response.data?.ok === true) return response.data;
  const uncertain = response.code === AUTHORITY_RESULT_CODES.FAILED;
  return createAlchemyOperationResult({ uncertain, reason: uncertain
    ? "Potion consumption could not be confirmed. Review the Item quantity and authority request before retrying."
    : "Potion consumption was rejected or no authority is available." });
}

/** Join pending use of one owned Item, including activations from different UI entry points. */
export function runAlchemyItemActivation(item, run) {
  const key = item?.uuid;
  if (!key) return Promise.resolve(activationResult(createAlchemyOperationResult({ reason: "Missing owned Item." }), item));
  if (_pendingActivations.has(key)) return _pendingActivations.get(key);
  const pending = measurePerfStage("consumption", "settlement", { itemUuid: key }, async () => {
    const fresh = await fromUuid(key);
    if (!fresh || !(Number(fresh.system?.quantity ?? 1) > 0)) {
      ui.notifications?.warn?.("This Item is deleted or exhausted.");
      return createAlchemyOperationResult({ reason: "This Item is deleted or exhausted.", execution: { status: "failed", committed: false } });
    }
    return run(fresh);
  }).catch(error => {
    const reason = String(error.message ?? error);
    ui.notifications?.warn?.(reason);
    return createAlchemyOperationResult({ reason, uncertain: true, execution: { status: "failed", committed: false } });
  }).then(value => activationResult(value, item)).finally(() => _pendingActivations.delete(key));
  _pendingActivations.set(key, pending);
  return pending;
}

export function consumeOwnedItem(item, options = {}) {
  return consumeOwnedItemQuantity(item, 1, options);
}

export async function consumeOwnedItemQuantity(item, amount = 1, { validate = null } = {}) {
  if (!item?.uuid) return createAlchemyOperationResult({ reason: "Missing item." });
  const requested = Math.max(1, Math.floor(Number(amount) || 1));
  const lockKey = lockKeyForDoc(item);
  let acquired = false;
  let attempted = false;
  try {
    await measurePerfStage("consumption", "queueWait", { itemUuid: item.uuid }, () => acquireLock(lockKey));
    acquired = true;
    const fresh = await fromUuid(item.uuid);
    if (!fresh) return createAlchemyOperationResult({ reason: "The Item no longer exists." });
    const invalid = validate?.(fresh);
    if (invalid) return createAlchemyOperationResult({ reason: String(invalid) });
    const quantity = Math.max(0, Number(fresh.system?.quantity ?? 1) || 0);
    if (quantity < requested) return createAlchemyOperationResult({ reason: `Insufficient quantity: requires ${requested}, has ${quantity}.` });
    const next = quantity - requested;
    attempted = true;
    const confirmed = await measurePerfStage("consumption", "persistence", { itemUuid: item.uuid, writeCount: 1 }, () => next === 0
      ? (fresh.parent?.documentName === "Actor" ? requestDeleteEmbeddedDocuments(fresh.parent, "Item", [fresh.id]) : fresh.delete().then(Boolean))
      : requestUpdateDocument(fresh, { "system.quantity": next }));
    return createAlchemyOperationResult({
      ok: confirmed, reason: confirmed ? "" : "Item consumption was not confirmed.",
      data: confirmed ? { deleted: next === 0, consumed: requested, quantity: next } : null,
      uncertain: !confirmed,
    });
  } catch (error) {
    return createAlchemyOperationResult({ reason: error?.message ?? String(error), uncertain: attempted });
  } finally {
    if (acquired) releaseLock(lockKey);
  }
}

export async function createOwnedItem(actor, itemData) {
  const created = await requestCreateEmbeddedDocuments(actor, "Item", [itemData]);
  const item = created?.[0] ?? null;
  return createAlchemyOperationResult({
    ok: Boolean(item),
    reason: item ? "" : "Failed to create embedded Item document.",
    data: item,
  });
}

export async function deleteOwnedItem(actor, itemId) {
  const deleted = await requestDeleteEmbeddedDocuments(actor, "Item", [itemId]);
  return createAlchemyOperationResult({ ok: Boolean(deleted), data: deleted });
}

export async function createCarrierEffect(carrierItem, effectData) {
  const created = await requestCreateEmbeddedDocuments(carrierItem, "ActiveEffect", [effectData]);
  const effect = created?.[0] ?? null;
  return createAlchemyOperationResult({
    ok: Boolean(effect),
    reason: effect ? "" : "Failed to create embedded ActiveEffect document.",
    data: effect,
  });
}

export async function clearLegacyAlchemyCarrierFlag(item, flagPath) {
  const confirmed = await requestUpdateDocument(item, { [flagPath]: null }, { render: false });
  return createAlchemyOperationResult({ ok: confirmed, reason: confirmed ? "" : "Carrier metadata cleanup failed." });
}

export async function updateAlchemyDocument(document, updateData) {
  const updated = await requestUpdateDocument(document, updateData);
  return createAlchemyOperationResult({
    ok: Boolean(updated),
    reason: updated ? "" : "Document update was rejected.",
    data: updated ? updateData : null,
  });
}
