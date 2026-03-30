import { isDebugEnabled } from "./debug.js";

const _RECENT_DELETE_MARKERS = new Map();
const _DEFAULT_TTL_MS = 5000;

function _debugEnabled() {
  return isDebugEnabled("aeLifecycleDebug") || isDebugEnabled("effectsProxyDebug");
}

function _dlog(message, data) {
  if (!_debugEnabled()) return;
  try {
    console.debug(`UESRPG | embedded-delete-guard | ${message}`, data ?? "");
  } catch (_e) {
    /* no-op */
  }
}

function _cleanupExpiredMarkers(now = Date.now()) {
  for (const [key, marker] of _RECENT_DELETE_MARKERS.entries()) {
    if (!marker || Number(marker.expiresAt ?? 0) > now) continue;
    _RECENT_DELETE_MARKERS.delete(key);
  }
}

function _normalizeParentUuid(parentOrUuid) {
  if (!parentOrUuid) return "";
  return String(parentOrUuid?.uuid ?? parentOrUuid ?? "").trim();
}

function _normalizeIds(docIds) {
  const ids = [];
  const seen = new Set();
  for (const rawId of Array.isArray(docIds) ? docIds : [docIds]) {
    const id = String(rawId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function _markerKey(parentOrUuid, embeddedName, docId) {
  const parentUuid = _normalizeParentUuid(parentOrUuid);
  const type = String(embeddedName ?? "").trim();
  const id = String(docId ?? "").trim();
  if (!parentUuid || !type || !id) return "";
  return `${parentUuid}::${type}::${id}`;
}

function _isKnownMissingDocMessage(message) {
  const text = String(message ?? "");
  return text.includes("does not exist")
    || text.includes("No Document")
    || text.includes("Invalid document")
    || text.includes("not found");
}

function _extractDeleteCandidates(message) {
  const text = String(message ?? "");
  const matches = [];
  const rx = /\b(ActiveEffect|Item)\s+"([^"]+)"/g;
  let match;
  while ((match = rx.exec(text))) {
    matches.push({ embeddedName: match[1], docId: match[2] });
  }

  // Fallback: if a quoted id is present but no type matched, still allow suppression
  // only when any recent marker exists for that id.
  if (!matches.length) {
    const fallback = [...text.matchAll(/"([^"]+)"/g)].map((m) => String(m[1] ?? "").trim()).filter(Boolean);
    for (const docId of fallback) matches.push({ embeddedName: null, docId });
  }

  return matches;
}

export function hasRecentEmbeddedDelete(parentOrUuid, embeddedName, docId) {
  const key = _markerKey(parentOrUuid, embeddedName, docId);
  if (!key) return false;
  _cleanupExpiredMarkers();
  return _RECENT_DELETE_MARKERS.has(key);
}

export function claimRecentEmbeddedDeletes(parentOrUuid, embeddedName, docIds, { source = "system", ttlMs = _DEFAULT_TTL_MS } = {}) {
  const parentUuid = _normalizeParentUuid(parentOrUuid);
  const ids = _normalizeIds(docIds);
  if (!parentUuid || !embeddedName || !ids.length) return [];

  _cleanupExpiredMarkers();
  const now = Date.now();
  const expiresAt = now + Math.max(1000, Number(ttlMs) || _DEFAULT_TTL_MS);
  const claimableIds = [];

  for (const docId of ids) {
    const key = _markerKey(parentUuid, embeddedName, docId);
    if (!key) continue;
    const existing = _RECENT_DELETE_MARKERS.get(key);
    if (existing && Number(existing.expiresAt ?? 0) > now) continue;
    _RECENT_DELETE_MARKERS.set(key, {
      parentUuid,
      embeddedName,
      docId,
      source: String(source ?? "system"),
      createdAt: now,
      expiresAt,
      inFlight: true
    });
    claimableIds.push(docId);
  }

  if (claimableIds.length !== ids.length) {
    _dlog("Suppressed duplicate embedded delete claims", {
      parentUuid,
      embeddedName,
      requestedIds: ids,
      claimableIds
    });
  }

  return claimableIds;
}

export function settleRecentEmbeddedDeletes(parentOrUuid, embeddedName, docIds, { source = "system", ttlMs = _DEFAULT_TTL_MS } = {}) {
  const parentUuid = _normalizeParentUuid(parentOrUuid);
  const ids = _normalizeIds(docIds);
  if (!parentUuid || !embeddedName || !ids.length) return;

  _cleanupExpiredMarkers();
  const now = Date.now();
  const expiresAt = now + Math.max(1000, Number(ttlMs) || _DEFAULT_TTL_MS);

  for (const docId of ids) {
    const key = _markerKey(parentUuid, embeddedName, docId);
    if (!key) continue;
    const existing = _RECENT_DELETE_MARKERS.get(key) ?? {};
    _RECENT_DELETE_MARKERS.set(key, {
      ...existing,
      parentUuid,
      embeddedName,
      docId,
      source: String(source ?? existing.source ?? "system"),
      expiresAt,
      inFlight: false
    });
  }
}

export function shouldSuppressRecentEmbeddedDeleteError(input) {
  const message = typeof input === "string"
    ? input
    : input instanceof Error
      ? input.message
      : Array.isArray(input)
        ? input.map((part) => String(part?.message ?? part ?? "")).join(" | ")
        : String(input?.message ?? input ?? "");

  if (!_isKnownMissingDocMessage(message)) return false;
  _cleanupExpiredMarkers();

  for (const candidate of _extractDeleteCandidates(message)) {
    const docId = String(candidate.docId ?? "").trim();
    if (!docId) continue;

    if (candidate.embeddedName) {
      for (const [key, marker] of _RECENT_DELETE_MARKERS.entries()) {
        if (!key.endsWith(`::${candidate.embeddedName}::${docId}`)) continue;
        if (Number(marker?.expiresAt ?? 0) <= Date.now()) continue;
        _dlog("Suppressed stale embedded delete error", { message, marker });
        return true;
      }
      continue;
    }

    for (const marker of _RECENT_DELETE_MARKERS.values()) {
      if (String(marker?.docId ?? "") !== docId) continue;
      if (Number(marker?.expiresAt ?? 0) <= Date.now()) continue;
      _dlog("Suppressed stale embedded delete error", { message, marker });
      return true;
    }
  }

  return false;
}

export function registerStaleEmbeddedDeleteSuppression() {
  if (registerStaleEmbeddedDeleteSuppression._installed) return;
  registerStaleEmbeddedDeleteSuppression._installed = true;

  Hooks.once("ready", () => {
    const notifications = ui?.notifications ?? null;

    if (notifications && !notifications.__uesrpgEmbeddedDeleteSuppressed) {
      const originalError = typeof notifications.error === "function" ? notifications.error.bind(notifications) : null;
      const originalNotify = typeof notifications.notify === "function" ? notifications.notify.bind(notifications) : null;

      if (originalError) {
        notifications.error = function patchedEmbeddedDeleteError(message, ...args) {
          if (shouldSuppressRecentEmbeddedDeleteError(message)) return null;
          return originalError(message, ...args);
        };
      }

      if (originalNotify) {
        notifications.notify = function patchedEmbeddedDeleteNotify(message, type, ...args) {
          if (String(type ?? "").toLowerCase() === "error" && shouldSuppressRecentEmbeddedDeleteError(message)) return null;
          return originalNotify(message, type, ...args);
        };
      }

      notifications.__uesrpgEmbeddedDeleteSuppressed = true;
    }
  });
}
