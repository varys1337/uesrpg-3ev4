/**
 * Permission-safe document mutation helpers.
 *
 * Native Foundry document permissions are the authority for ordinary writes.
 * Cross-owner writes are denied unless a sealed authority intent owns the
 * complete validation and mutation flow. Chat workflow transitions currently
 * use that intent service; arbitrary document payloads are never proxied.
 */

import { isPerfEnabled, monoMs, perfRecord } from "./perf-tracker.js";
import {
  acquireLock,
  releaseLock,
  lockKeyForDoc,
  isAllowedGenericDocument,
  warnLog as _dwarn,
} from "./authority-proxy/shared.js";
import { deleteEmbeddedDocumentsIdempotent } from "./authority-proxy/embedded-docs.js";
import {
  sanitizeChatMessageUpdatePayload,
  isChatMessageUpdateFresh,
  sanitizeGenericUpdatePayload,
  sanitizeEmbeddedDocData,
  sanitizeActorCreateData,
} from "./authority-proxy/sanitize.js";
import {
  AUTHORITY_RESULT_CODES,
  registerAuthorityIntentCommand,
  registerAuthorityIntentService,
  requestAuthorityIntent,
} from "./authority-intents.js";

export { sanitizeChatMessageUpdatePayload, isChatMessageUpdateFresh };

const CHAT_TRANSITION_COMMAND = "chat.transition";
const CHAT_WORKFLOW_LANES = Object.freeze([
  "opposed",
  "skillOpposed",
  "magicOpposed",
  "charOpposed",
  "warfareClash",
]);

function _ownerLevel() {
  return CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
}

function _canOwn(user, document) {
  if (!user || !document) return false;
  if (user.isGM) return true;
  return document.testUserPermission?.(user, _ownerLevel()) === true;
}

function _notifyRemoteDenied(label = "change") {
  const localized = game.i18n?.localize?.("UESRPG.Notifications.Authority.GMRequired");
  const message = localized && localized !== "UESRPG.Notifications.Authority.GMRequired"
    ? localized
    : `A GM must perform this cross-owner ${label}.`;
  ui.notifications?.warn?.(message);
}

function _workflowLane(payload) {
  const flags = payload?.flags?.[game.system?.id ?? "uesrpg-3ev4"];
  if (!flags || typeof flags !== "object") return null;
  const lanes = CHAT_WORKFLOW_LANES.filter((lane) => Object.prototype.hasOwnProperty.call(flags, lane));
  return lanes.length === 1 ? lanes[0] : null;
}

function _laneState(flags, lane) {
  const value = flags?.[lane];
  if (!value || typeof value !== "object") return null;
  if (lane === "skillOpposed" || lane === "magicOpposed" || lane === "charOpposed") {
    return value.state && typeof value.state === "object" ? value.state : null;
  }
  return value;
}

function _laneSequence(state) {
  return Number(state?.context?.updatedSeq ?? 0) || 0;
}

function _collectActorUuids(value, output = new Set(), seen = new WeakSet()) {
  if (!value || typeof value !== "object") return output;
  if (seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) _collectActorUuids(entry, output, seen);
    return output;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (/actoruuid$/i.test(key) && typeof entry === "string" && entry.trim()) output.add(entry.trim());
    else if (entry && typeof entry === "object") _collectActorUuids(entry, output, seen);
  }
  return output;
}

function _sameStringSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

async function _requesterOwnsWorkflowActor(requester, message, state) {
  if (requester?.isGM) return true;
  const actorUuids = _collectActorUuids(state);
  for (const uuid of actorUuids) {
    try {
      const actor = await fromUuid(uuid);
      if (actor?.documentName === "Actor" && _canOwn(requester, actor)) return true;
    } catch (_error) {
      // Continue through the canonical references.
    }
  }
  const speakerActorId = String(message?.speaker?.actor ?? "").trim();
  const speakerActor = speakerActorId ? game.actors?.get?.(speakerActorId) : null;
  return _canOwn(requester, speakerActor);
}

async function _handleChatTransitionIntent({ requester, data, expectedRevision }) {
  const messageId = String(data?.messageId ?? "").trim();
  const message = messageId ? game.messages?.get?.(messageId) : null;
  if (!message) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };

  const payload = sanitizeChatMessageUpdatePayload(data?.payload);
  const lane = _workflowLane(payload);
  if (!lane) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };

  const systemId = game.system?.id ?? "uesrpg-3ev4";
  const incomingFlags = payload.flags?.[systemId];
  const currentFlags = message.flags?.[systemId];
  const incomingState = _laneState(incomingFlags, lane);
  const currentState = _laneState(currentFlags, lane);
  if (!incomingState || !currentState) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
  if (!(await _requesterOwnsWorkflowActor(requester, message, currentState))) {
    return { ok: false, code: AUTHORITY_RESULT_CODES.UNAUTHORIZED };
  }

  const currentActors = _collectActorUuids(currentState);
  const incomingActors = _collectActorUuids(incomingState);
  if (!_sameStringSet(currentActors, incomingActors)) {
    return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
  }

  const lockKey = `ChatMessage:${message.id}`;
  let acquired = false;
  try {
    await acquireLock(lockKey);
    acquired = true;
    const liveMessage = game.messages?.get?.(message.id) ?? message;
    const liveState = _laneState(liveMessage.flags?.[systemId], lane);
    const currentSeq = _laneSequence(liveState);
    const incomingSeq = _laneSequence(incomingState);
    if (Number(expectedRevision ?? currentSeq) !== currentSeq || incomingSeq !== currentSeq + 1) {
      return {
        ok: false,
        code: AUTHORITY_RESULT_CODES.STALE_REVISION,
        data: { currentRevision: currentSeq },
      };
    }
    if (!isChatMessageUpdateFresh(liveMessage, payload)) {
      return { ok: false, code: AUTHORITY_RESULT_CODES.STALE_REVISION, data: { currentRevision: currentSeq } };
    }
    if (!await liveMessage.update(payload)) return { ok: false, code: AUTHORITY_RESULT_CODES.FAILED };
    return { ok: true, data: { revision: incomingSeq } };
  } catch (error) {
    console.error("UESRPG | authority-proxy | Chat transition intent failed", error);
    return { ok: false, code: AUTHORITY_RESULT_CODES.FAILED };
  } finally {
    if (acquired) releaseLock(lockKey);
  }
}

export function getMessageAuthorId(message) {
  try {
    const author = message?.author;
    if (author && typeof author === "object" && typeof author.id === "string") return author.id;
    const user = message?.user;
    if (typeof user === "string") return user;
    if (user && typeof user === "object" && typeof user.id === "string") return user.id;
    return null;
  } catch (_error) {
    return null;
  }
}

export function getChatMessageAuthorId(message) {
  return getMessageAuthorId(message);
}

export function getChatMessageAuthorUser(message) {
  const authorId = getChatMessageAuthorId(message);
  const user = authorId ? game.users?.get?.(authorId) : null;
  return user?.active ? user : null;
}

export function doesUserOwnActor(user, actor) {
  return actor?.documentName === "Actor" && _canOwn(user, actor);
}

export function getActorOwnerUser(actor) {
  const owners = (game.users?.contents ?? [])
    .filter((user) => user?.active && doesUserOwnActor(user, actor))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return owners[0] ?? null;
}

export function canUserUpdateChatMessage(message, user) {
  if (!message || !user) return false;
  if (user.isGM) return true;
  if (typeof message.canUserModify === "function") return message.canUserModify(user, "update");
  if (typeof message.testUserPermission === "function") return _canOwn(user, message);
  return getChatMessageAuthorId(message) === user.id;
}

export function registerAuthorityProxy() {
  registerAuthorityIntentService();
  registerAuthorityIntentCommand(CHAT_TRANSITION_COMMAND, _handleChatTransitionIntent);
}

export async function requestUpdateChatMessage(message, payload, { timeout = 5_000 } = {}) {
  if (!message) return false;
  const sanitized = sanitizeChatMessageUpdatePayload(payload);
  if (!Object.keys(sanitized).length) return false;

  if (canUserUpdateChatMessage(message, game.user)) {
    if (!isChatMessageUpdateFresh(message, sanitized)) return false;
    try {
      return Boolean(await message.update(sanitized));
    } catch (error) {
      console.error("UESRPG | authority-proxy | Direct ChatMessage update failed", { messageId: message.id, error });
      return false;
    }
  }

  const lane = _workflowLane(sanitized);
  if (!lane) {
    _notifyRemoteDenied("chat update");
    return false;
  }
  const systemId = game.system?.id ?? "uesrpg-3ev4";
  const expectedRevision = _laneSequence(_laneState(message.flags?.[systemId], lane));
  const result = await requestAuthorityIntent(CHAT_TRANSITION_COMMAND, {
    messageId: message.id,
    payload: sanitized,
  }, { expectedRevision, timeout });
  if (!result?.ok) {
    _dwarn("Chat transition rejected", { messageId: message.id, code: result?.code });
    if (result?.code === AUTHORITY_RESULT_CODES.STALE_REVISION) {
      ui.notifications?.warn?.("This workflow changed on another client. Refresh the card and try again.");
    } else if (result?.code === AUTHORITY_RESULT_CODES.NO_ACTIVE_GM) {
      _notifyRemoteDenied("chat transition");
    } else {
      ui.notifications?.warn?.("The GM rejected this workflow transition.");
    }
    return false;
  }
  return true;
}

export async function requestCreateActiveEffect(actor, effectData) {
  const created = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effectData]);
  return created?.[0] ?? null;
}

export async function requestAtomicUpdateDocument(docOrUuid, mutator) {
  if (!docOrUuid || typeof mutator !== "function") return false;
  const doc = typeof docOrUuid === "string" ? await fromUuid(docOrUuid) : docOrUuid;
  if (!isAllowedGenericDocument(doc)) return false;
  if (!_canOwn(game.user, doc)) {
    _notifyRemoteDenied("document update");
    return false;
  }

  const lockKey = lockKeyForDoc(doc);
  let acquired = false;
  try {
    await acquireLock(lockKey);
    acquired = true;
    const fresh = (doc.uuid ? await fromUuid(doc.uuid) : null) ?? doc;
    const updateData = await mutator(fresh);
    const cleaned = sanitizeGenericUpdatePayload(fresh, updateData);
    if (!Object.keys(cleaned).length) return false;
    return Boolean(await fresh.update(cleaned));
  } catch (error) {
    console.error("UESRPG | authority-proxy | Atomic document update failed", { uuid: doc.uuid, error });
    return false;
  } finally {
    if (acquired) releaseLock(lockKey);
  }
}

export async function requestUpdateDocument(docOrUuid, updateData) {
  if (!docOrUuid || !updateData) return false;
  const doc = typeof docOrUuid === "string" ? await fromUuid(docOrUuid) : docOrUuid;
  if (!isAllowedGenericDocument(doc)) return false;
  const cleaned = sanitizeGenericUpdatePayload(doc, updateData);
  if (!Object.keys(cleaned).length) return false;

  if (isPerfEnabled()) {
    perfRecord({
      event: "authorityProxy.updateDocument",
      docType: doc.documentName ?? null,
      docId: doc.id ?? null,
      keyCount: Object.keys(cleaned).length,
      isDirectPath: _canOwn(game.user, doc),
    });
  }
  if (!_canOwn(game.user, doc)) {
    _notifyRemoteDenied("document update");
    return false;
  }
  try {
    return Boolean(await doc.update(cleaned));
  } catch (error) {
    console.error("UESRPG | authority-proxy | Direct document update failed", { uuid: doc.uuid, error });
    return false;
  }
}

export async function requestBatchUpdateDocuments(updates) {
  const rows = Array.isArray(updates) ? updates : [];
  const started = isPerfEnabled() ? monoMs() : 0;
  const prepared = [];
  const failures = [];

  for (const row of rows) {
    const candidate = row?.docOrUuid ?? null;
    const doc = typeof candidate === "string" ? await fromUuid(candidate) : candidate;
    if (!isAllowedGenericDocument(doc) || !_canOwn(game.user, doc)) {
      failures.push({ uuid: String(doc?.uuid ?? ""), error: "Native document permission is required" });
      continue;
    }
    const cleaned = sanitizeGenericUpdatePayload(doc, row?.updateData);
    if (!Object.keys(cleaned).length) {
      failures.push({ uuid: String(doc.uuid), error: "Empty or invalid update payload" });
      continue;
    }
    prepared.push({ doc, cleaned });
  }

  const lockKeys = [...new Set(prepared.map(({ doc }) => lockKeyForDoc(doc)))].sort();
  const acquired = [];
  let updatedCount = 0;
  try {
    for (const key of lockKeys) {
      await acquireLock(key);
      acquired.push(key);
    }
    for (const row of prepared) {
      try {
        await row.doc.update(row.cleaned);
        updatedCount += 1;
      } catch (error) {
        failures.push({ uuid: String(row.doc.uuid), error: error?.message ?? String(error) });
      }
    }
  } catch (error) {
    failures.push({ uuid: "", error: error?.message ?? String(error) });
  } finally {
    for (let index = acquired.length - 1; index >= 0; index -= 1) releaseLock(acquired[index]);
  }

  const result = {
    ok: failures.length === 0,
    totalCount: rows.length,
    updatedCount,
    failureCount: failures.length,
    failures,
  };
  if (isPerfEnabled()) {
    perfRecord({ event: "authorityProxy.batchUpdate", ...result, durationMs: monoMs() - started });
  }
  if (prepared.length < rows.length) _notifyRemoteDenied("batch update");
  return result;
}

export async function requestCreateActor(actorData) {
  const cleaned = sanitizeActorCreateData(actorData);
  if (!cleaned) return null;
  try {
    return await Actor.create(cleaned);
  } catch (error) {
    console.error("UESRPG | authority-proxy | Actor creation failed", error);
    _notifyRemoteDenied("actor creation");
    return null;
  }
}

export async function requestCreateEmbeddedDocuments(parent, embeddedName, docsData) {
  if (!parent || !embeddedName || !Array.isArray(docsData) || !docsData.length) return [];
  if (!_canOwn(game.user, parent)) {
    _notifyRemoteDenied("embedded-document creation");
    return [];
  }
  const cleaned = (embeddedName === "ActiveEffect" || embeddedName === "Item")
    ? docsData.map((entry) => sanitizeEmbeddedDocData(embeddedName, entry)).filter(Boolean)
    : docsData.map((entry) => foundry.utils.deepClone(entry));
  if (!cleaned.length) return [];
  try {
    return await parent.createEmbeddedDocuments(embeddedName, cleaned);
  } catch (error) {
    console.error("UESRPG | authority-proxy | Embedded-document creation failed", { uuid: parent.uuid, embeddedName, error });
    return [];
  }
}

export async function requestUpdateEmbeddedDocuments(parent, embeddedName, updates) {
  if (!parent || !embeddedName || !Array.isArray(updates) || !updates.length) return false;
  if (!_canOwn(game.user, parent)) {
    _notifyRemoteDenied("embedded-document update");
    return false;
  }
  if (embeddedName !== "ActiveEffect" && embeddedName !== "Item") return false;
  const cleaned = updates.map((entry) => {
    const id = entry?._id ?? entry?.id;
    const update = sanitizeEmbeddedDocData(embeddedName, entry);
    return id && update ? { ...update, _id: String(id) } : null;
  }).filter(Boolean);
  if (!cleaned.length) return false;
  try {
    await parent.updateEmbeddedDocuments(embeddedName, cleaned);
    return true;
  } catch (error) {
    console.error("UESRPG | authority-proxy | Embedded-document update failed", { uuid: parent.uuid, embeddedName, error });
    return false;
  }
}

export async function requestDeleteEmbeddedDocuments(parent, embeddedName, ids, { deleteOptions = {} } = {}) {
  if (!parent || !embeddedName || !Array.isArray(ids) || !ids.length) return false;
  if (!_canOwn(game.user, parent)) {
    _notifyRemoteDenied("embedded-document deletion");
    return false;
  }
  try {
    const result = await deleteEmbeddedDocumentsIdempotent(parent, embeddedName, ids, deleteOptions);
    return result?.ok === true;
  } catch (error) {
    console.error("UESRPG | authority-proxy | Embedded-document deletion failed", { uuid: parent.uuid, embeddedName, error });
    return false;
  }
}
