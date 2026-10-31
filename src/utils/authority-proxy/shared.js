import { isDebugEnabled } from "../debug.js";
import { SYSTEM_ID } from "../../core/constants.js";

export const NAMESPACE = SYSTEM_ID;

/** Compare native acknowledgements by ID; missing/partial results never confirm a batch. */
export function getUnconfirmedDocumentIds(expectedIds, confirmedIds) {
  if (!Array.isArray(expectedIds) || expectedIds.some(id => typeof id !== "string" || !id)) {
    throw new TypeError("Document confirmation requires explicit document IDs.");
  }
  const confirmed = new Set(Array.isArray(confirmedIds) ? confirmedIds : []);
  return [...new Set(expectedIds)].filter(id => !confirmed.has(id));
}

export function assertDocumentWriteConfirmed(expectedIds, documents, referencePrefix = "Document") {
  const missing = getUnconfirmedDocumentIds(expectedIds, documents?.map?.(doc => doc?.id));
  if (!missing.length) return;
  const error = new Error(`Unconfirmed document write: ${missing.map(id => `${referencePrefix}.${id}`).join(", ")}`);
  error.unconfirmedDocumentIds = missing;
  error.documentReferences = missing.map(id => `${referencePrefix}.${id}`);
  throw error;
}

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

export async function acquireLock(key, { timeoutMs = 3000, pollMs = 25, wait = true } = {}) {
  if (!wait && _IN_FLIGHT_LOCKS.has(key)) return false;
  const start = Date.now();
  while (_IN_FLIGHT_LOCKS.has(key)) {
    if ((Date.now() - start) > timeoutMs) {
      throw new Error(`authority lock timeout for ${key}`);
    }
    await _sleep(pollMs);
  }
  _IN_FLIGHT_LOCKS.add(key);
  return true;
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

export function documentStateFingerprint(value) {
  // Portable change fingerprint, not an authentication primitive. Native
  // permissions, exact request identity and authoritative plans are separate.
  const bytes = new TextEncoder().encode(stableStringify(value));
  let hash = 0x6c62272e07bb014262b821756295c58dn;
  const prime = (1n << 88n) + 0x13bn;
  const mask = (1n << 128n) - 1n;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * prime) & mask;
  return hash.toString(16).padStart(32, "0");
}
