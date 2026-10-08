/**
 * Requester-bound, single-writer authority intents.
 *
 * User#query does not expose an authenticated caller to the handler. A query is
 * therefore only a wake-up signal: the active GM reads the canonical request
 * from the requester's own User flags before executing a sealed command.
 */

import { SYSTEM_ID } from "../core/constants.js";
import { getActiveGMUser, isActiveGMUser } from "./users.js";
import { acquireLock, releaseLock } from "./authority-proxy/shared.js";
import { isPerfEnabled, monoMs, perfRecord } from "./perf-tracker.js";

export const AUTHORITY_QUERY_V1 = `${SYSTEM_ID}.authority.intent.v1`;

export const AUTHORITY_RESULT_CODES = Object.freeze({
  NO_ACTIVE_GM: "NO_ACTIVE_GM",
  EXPIRED: "EXPIRED",
  STALE_REVISION: "STALE_REVISION",
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_REQUEST: "INVALID_REQUEST",
  CONFLICT: "CONFLICT",
  FAILED: "FAILED",
});

const REQUEST_VERSION = 1;
const REQUEST_TTL_MS = 60_000;
const RECEIPT_TTL_MS = 5 * 60_000;
const MAX_REQUESTS_PER_USER = 20;
const MAX_SERIALIZED_DATA_LENGTH = 128_000;

/** @type {Map<string, Function>} */
const _commands = new Map();
/** @type {Map<string, Promise<unknown>>} */
const _localUserWrites = new Map();
let _registered = false;

function _clone(value, fallback = null) {
  try {
    return foundry.utils.deepClone(value);
  } catch (_error) {
    try {
      return structuredClone(value);
    } catch (_cloneError) {
      return fallback;
    }
  }
}

function _result(ok, status, code = null, data = null, requestId = null) {
  return {
    ok: ok === true,
    requestId: requestId ? String(requestId) : null,
    status: String(status ?? (ok ? "completed" : "rejected")),
    code: code ? String(code) : null,
    ...(data == null ? {} : { data: _clone(data, data) }),
  };
}

function _requestId() {
  const randomId = foundry.utils.randomID?.(24);
  if (randomId) return String(randomId);
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
}

function _isSafeId(value) {
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(value ?? ""));
}

function _readAuthorityData(user) {
  const raw = user?.getFlag?.(SYSTEM_ID, "authority");
  return raw && typeof raw === "object" ? _clone(raw, {}) : {};
}

function _pruneRequests(requests, now = Date.now()) {
  const entries = Object.entries(requests && typeof requests === "object" ? requests : {})
    .filter(([id, request]) => {
      if (!_isSafeId(id) || !request || typeof request !== "object") return false;
      if (request.status === "pending" || request.status === "processing") {
        return (now - Number(request.createdAt ?? 0)) <= REQUEST_TTL_MS;
      }
      return (now - Number(request.finishedAt ?? request.createdAt ?? 0)) <= RECEIPT_TTL_MS;
    })
    .sort((left, right) => Number(right[1]?.createdAt ?? 0) - Number(left[1]?.createdAt ?? 0))
    .slice(0, MAX_REQUESTS_PER_USER);
  return Object.fromEntries(entries);
}

async function _withUserWriteLock(user, operation) {
  const key = String(user?.id ?? "unknown");
  const prior = _localUserWrites.get(key) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(operation);
  _localUserWrites.set(key, current);
  try {
    return await current;
  } finally {
    if (_localUserWrites.get(key) === current) _localUserWrites.delete(key);
  }
}

async function _writeRequest(user, requestId, update) {
  return _withUserWriteLock(user, async () => {
    const authority = _readAuthorityData(user);
    const existingRequests = authority.requests && typeof authority.requests === "object"
      ? authority.requests
      : {};
    const current = existingRequests[requestId] ?? null;
    const next = typeof update === "function" ? update(_clone(current, null)) : update;
    const candidates = { ...existingRequests };
    if (next == null) delete candidates[requestId];
    else candidates[requestId] = _clone(next, next);
    const kept = _pruneRequests(candidates);
    const updateData = {
      [`flags.${SYSTEM_ID}.authority.version`]: REQUEST_VERSION,
    };

    if (next != null && Object.prototype.hasOwnProperty.call(kept, requestId)) {
      updateData[`flags.${SYSTEM_ID}.authority.requests.${requestId}`] = kept[requestId];
    } else if (Object.prototype.hasOwnProperty.call(existingRequests, requestId)) {
      updateData[`flags.${SYSTEM_ID}.authority.requests.-=${requestId}`] = null;
    }
    for (const existingId of Object.keys(existingRequests)) {
      if (existingId === requestId || Object.prototype.hasOwnProperty.call(kept, existingId)) continue;
      if (!_isSafeId(existingId)) continue;
      updateData[`flags.${SYSTEM_ID}.authority.requests.-=${existingId}`] = null;
    }

    const startedAt = isPerfEnabled() ? monoMs() : null;
    try { await user.update(updateData, { render: false }); }
    finally {
      if (startedAt !== null) perfRecord({
        event: "authority.intent.write", requestId, command: next?.command ?? current?.command,
        kind: next?.data?.kind ?? (next?.data?.type === "healingApplied" ? "healing" : null),
        messageId: next?.data?.messageId ?? null, actorUuid: next?.data?.actorUuid ?? next?.data?.targetUuid ?? null,
        status: next?.status ?? null, writeCount: 1, durationMs: monoMs() - startedAt,
      });
    }
    return kept[requestId] ?? null;
  });
}

function _readRequest(user, requestId) {
  return _readAuthorityData(user)?.requests?.[requestId] ?? null;
}

/**
 * Register a built-in command. This module is intentionally not re-exported by
 * the public API barrel; only system-owned registrars may extend the command set.
 */
export function registerAuthorityIntentCommand(command, handler, { persistProcessing = true, resolveAuthority = null } = {}) {
  const name = String(command ?? "").trim();
  if (!name || typeof handler !== "function") return false;
  if (_commands.has(name)) return false;
  _commands.set(name, { handler, persistProcessing: persistProcessing !== false, resolveAuthority });
  return true;
}

async function _reject(user, requestId, code, data = null) {
  const receipt = _result(false, "rejected", code, data, requestId);
  if (!user.canUserModify(game.user, "update")) return receipt;
  try {
    await _writeRequest(user, requestId, (current) => ({
      ...(current ?? {}),
      status: "rejected",
      finishedAt: Date.now(),
      result: receipt,
    }));
  } catch (error) {
    console.warn("UESRPG | authority-intents | Failed to persist rejection receipt", error);
  }
  return receipt;
}

async function _handleAuthorityIntent(queryData) {
  const requesterUserId = String(queryData?.requesterUserId ?? "").trim();
  const requestId = String(queryData?.requestId ?? "").trim();
  if (!requesterUserId || !_isSafeId(requestId)) {
    return _result(false, "rejected", AUTHORITY_RESULT_CODES.INVALID_REQUEST);
  }

  const requester = game.users?.get?.(requesterUserId) ?? null;
  if (!requester) return _result(false, "rejected", AUTHORITY_RESULT_CODES.INVALID_REQUEST, null, requestId);

  const lockKey = `AuthorityRequest:${requesterUserId}:${requestId}`;
  try {
    await acquireLock(lockKey);
  } catch (_error) {
    return _result(false, "rejected", AUTHORITY_RESULT_CODES.CONFLICT, null, requestId);
  }

  try {
    const request = _readRequest(requester, requestId);
    if (!request || request.id !== requestId || request.v !== REQUEST_VERSION) {
      return _result(false, "rejected", AUTHORITY_RESULT_CODES.INVALID_REQUEST, null, requestId);
    }
    const command = String(request.command ?? "");
    const registration = _commands.get(command);
    if (!registration) return _result(false, "rejected", AUTHORITY_RESULT_CODES.INVALID_REQUEST, null, requestId);
    const authority = registration.resolveAuthority ? await registration.resolveAuthority(request.data) : getActiveGMUser();
    if (!authority?.active || authority.id !== game.user?.id
      || (!registration.resolveAuthority && !isActiveGMUser(game.user))) {
      return _result(false, "rejected", AUTHORITY_RESULT_CODES.UNAUTHORIZED, null, requestId);
    }
    const age = Date.now() - Number(request.createdAt ?? 0);
    if (!Number.isFinite(age) || age < -5_000 || age > REQUEST_TTL_MS) {
      return _reject(requester, requestId, AUTHORITY_RESULT_CODES.EXPIRED);
    }
    if (request.status === "completed" || request.status === "rejected") {
      return request.result ?? _result(request.status === "completed", request.status, null, null, requestId);
    }
    if (request.status !== "pending") return _result(false, "rejected", AUTHORITY_RESULT_CODES.CONFLICT, null, requestId);

    // Combat owns its outcome lock and durable Actor receipts. It can proceed
    // from the sealed pending request without an intermediate User write.
    if (registration.persistProcessing) {
      await _writeRequest(requester, requestId, (current) => ({
        ...current,
        status: "processing",
        processingAt: Date.now(),
        processorUserId: game.user.id,
      }));
    }

    let commandResult;
    const commandStartedAt = isPerfEnabled() ? monoMs() : null;
    try {
      commandResult = await registration.handler({
        requester,
        requestId,
        data: _clone(request.data, {}),
        expectedRevision: request.expectedRevision ?? null,
      });
    } catch (error) {
      console.error(`UESRPG | authority-intents | Command "${command}" failed`, error);
      commandResult = _result(false, "rejected", AUTHORITY_RESULT_CODES.FAILED);
    } finally {
      if (commandStartedAt !== null) perfRecord({
        event: "authority.intent.command", command, requestId, kind: request.data?.kind ?? null,
        messageId: request.data?.messageId ?? null, actorUuid: request.data?.actorUuid ?? request.data?.targetUuid ?? null,
        ok: commandResult?.ok === true, durationMs: monoMs() - commandStartedAt,
      });
    }

    const receipt = commandResult?.ok === true
      ? _result(true, "completed", commandResult.code ?? null, commandResult.data ?? null, requestId)
      : _result(false, "rejected", commandResult?.code ?? AUTHORITY_RESULT_CODES.FAILED, commandResult?.data ?? null, requestId);

    if (requester.canUserModify(game.user, "update")) await _writeRequest(requester, requestId, (current) => ({
      ...current,
      status: receipt.status,
      finishedAt: Date.now(),
      result: receipt,
    }));
    return receipt;
  } finally {
    releaseLock(lockKey);
  }
}

export function registerAuthorityIntentService() {
  if (_registered) return;
  _registered = true;
  CONFIG.queries = CONFIG.queries ?? {};
  CONFIG.queries[AUTHORITY_QUERY_V1] = _handleAuthorityIntent;
}

/**
 * Persist and submit a sealed authority request.
 */
export async function requestAuthorityIntent(command, data, { expectedRevision = null, timeout = 5_000 } = {}) {
  if (!game.user) return _result(false, "rejected", AUTHORITY_RESULT_CODES.UNAUTHORIZED);

  const commandName = String(command ?? "").trim();
  const clonedData = _clone(data, null);
  if (!commandName || !clonedData || typeof clonedData !== "object") {
    return _result(false, "rejected", AUTHORITY_RESULT_CODES.INVALID_REQUEST);
  }
  const registration = _commands.get(commandName);
  const authority = registration?.resolveAuthority
    ? await registration.resolveAuthority(clonedData) : getActiveGMUser();
  if (!authority?.active) return _result(false, "rejected", AUTHORITY_RESULT_CODES.NO_ACTIVE_GM);

  let serialized = "";
  try {
    serialized = JSON.stringify(clonedData);
  } catch (_error) {
    return _result(false, "rejected", AUTHORITY_RESULT_CODES.INVALID_REQUEST);
  }
  if (serialized.length > MAX_SERIALIZED_DATA_LENGTH) {
    return _result(false, "rejected", AUTHORITY_RESULT_CODES.INVALID_REQUEST);
  }

  const requestId = _requestId();
  const record = {
    v: REQUEST_VERSION,
    id: requestId,
    command: commandName,
    createdAt: Date.now(),
    status: "pending",
    expectedRevision,
    data: clonedData,
  };

  try {
    await _writeRequest(game.user, requestId, record);
  } catch (error) {
    console.error("UESRPG | authority-intents | Failed to persist request", error);
    return _result(false, "rejected", AUTHORITY_RESULT_CODES.FAILED, null, requestId);
  }

  const queryStartedAt = isPerfEnabled() ? monoMs() : null;
  let response;
  try {
    response = await authority.query(AUTHORITY_QUERY_V1, {
      requesterUserId: game.user.id,
      requestId,
    }, { timeout });
    if (registration?.resolveAuthority && response && !game.user.isGM) {
      await _writeRequest(game.user, requestId, current => ({ ...current, status: response.status,
        finishedAt: Date.now(), result: response }));
    }
    return response;
  } catch (error) {
    console.error("UESRPG | authority-intents | Query failed", { requestId, error });
    return _result(false, "rejected", AUTHORITY_RESULT_CODES.FAILED, null, requestId);
  } finally {
    if (queryStartedAt !== null) perfRecord({
      event: "authority.intent.query", command: commandName, requestId, kind: clonedData.kind ?? null,
      messageId: clonedData.messageId ?? null, actorUuid: clonedData.actorUuid ?? clonedData.targetUuid ?? null,
      ok: response?.ok === true, durationMs: monoMs() - queryStartedAt,
    });
  }
}
