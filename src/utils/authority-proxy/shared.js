import { isDebugEnabled } from "../debug.js";
import { SYSTEM_ID } from "../../core/constants.js";

export const NAMESPACE = SYSTEM_ID;

export const QUERY_UPDATE_CHAT_MESSAGE_V1 = `${NAMESPACE}.authority.updateChatMessage.v1`;
export const QUERY_CREATE_ACTIVE_EFFECT_V1 = `${NAMESPACE}.authority.createActiveEffect.v1`;
export const QUERY_UPDATE_DOCUMENT_V1 = `${NAMESPACE}.authority.updateDocument.v1`;
export const QUERY_BATCH_UPDATE_DOCUMENTS_V1 = `${NAMESPACE}.authority.batchUpdateDocuments.v1`;
export const QUERY_CREATE_ACTOR_V1 = `${NAMESPACE}.authority.createActor.v1`;
export const QUERY_CREATE_EMBEDDED_DOCS_V1 = `${NAMESPACE}.authority.createEmbeddedDocuments.v1`;
export const QUERY_UPDATE_EMBEDDED_DOCS_V1 = `${NAMESPACE}.authority.updateEmbeddedDocuments.v1`;
export const QUERY_DELETE_EMBEDDED_DOCS_V1 = `${NAMESPACE}.authority.deleteEmbeddedDocuments.v1`;

const _IN_FLIGHT_LOCKS = new Set();
const _RECENT_SIGNATURES = new Map();

function _debugEnabled() {
  return isDebugEnabled("effectsProxyDebug");
}

export function debugLog(message, data) {
  if (!_debugEnabled()) return;
  try {
    console.log(`UESRPG | authority-proxy | ${message}`, data ?? "");
  } catch (_e) {
    /* no-op */
  }
}

export function warnLog(message, data) {
  if (!_debugEnabled()) return;
  try {
    console.warn(`UESRPG | authority-proxy | ${message}`, data ?? "");
  } catch (_e) {
    /* no-op */
  }
}

export function channelSystemId() {
  return game.system?.id ?? NAMESPACE;
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquireLock(key, { timeoutMs = 3000, pollMs = 25 } = {}) {
  const start = Date.now();
  while (_IN_FLIGHT_LOCKS.has(key)) {
    if ((Date.now() - start) > timeoutMs) {
      throw new Error(`authority lock timeout for ${key}`);
    }
    await _sleep(pollMs);
  }
  _IN_FLIGHT_LOCKS.add(key);
}

export function releaseLock(key) {
  _IN_FLIGHT_LOCKS.delete(key);
}

export function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "string") return JSON.stringify(v);
    if (t === "number" || t === "boolean") return String(v);
    if (t !== "object") return JSON.stringify(String(v));

    if (seen.has(v)) return '"[Circular]"';
    seen.add(v);

    if (Array.isArray(v)) return `[${v.map(walk).join(",")}]`;

    const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const parts = keys.map((k) => `${JSON.stringify(k)}:${walk(v[k])}`);
    return `{${parts.join(",")}}`;
  };

  try {
    return walk(value);
  } catch (_e) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}

export function isRecentDuplicate(signature, { windowMs = 1500, maxEntries = 500 } = {}) {
  try {
    const now = Date.now();
    const prev = _RECENT_SIGNATURES.get(signature) ?? 0;
    if (prev && (now - prev) < windowMs) return true;

    _RECENT_SIGNATURES.set(signature, now);

    if (_RECENT_SIGNATURES.size > maxEntries) {
      const entries = Array.from(_RECENT_SIGNATURES.entries());
      entries.sort((a, b) => a[1] - b[1]);
      const toDelete = Math.ceil(entries.length * 0.25);
      for (let i = 0; i < toDelete; i++) _RECENT_SIGNATURES.delete(entries[i][0]);
    }

    return false;
  } catch (_e) {
    return false;
  }
}

export function lockKeyForDoc(doc) {
  try {
    const docName = doc?.documentName ?? "Document";
    const uuid = doc?.uuid ?? "";
    const id = doc?.id ?? "";
    return `${docName}:${uuid || id}`;
  } catch (_e) {
    return "Document:unknown";
  }
}

export function isAllowedGenericDocument(doc) {
  const allowedDocs = new Set(["Actor", "Item", "ActiveEffect", "Token", "Combatant", "Scene", "Region"]);
  return !!doc && doc.documentName !== "ChatMessage" && allowedDocs.has(doc.documentName);
}
