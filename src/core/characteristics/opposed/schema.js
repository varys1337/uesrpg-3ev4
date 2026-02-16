/**
 * src/core/characteristics/opposed/schema.js
 * State management and schema normalization for characteristic opposed workflow
 */

import { FLAG_NS, FLAG_KEY } from "./constants.js";

export function _normalizeCardFlag(raw) {
  if (raw && typeof raw === "object" && Number(raw.version) >= 1 && raw.state) {
    return { version: Number(raw.version), state: raw.state };
  }
  if (raw && typeof raw === "object" && raw.attacker && raw.defender) {
    return { version: 0, state: raw };
  }
  return { version: 0, state: null };
}

export function _getMessageState(message) {
  const raw = message?.flags?.[FLAG_NS]?.[FLAG_KEY];
  const normalized = _normalizeCardFlag(raw);
  return normalized.state;
}

export function _bothSidesCommitted(data) {
  return Boolean(data?.attacker?.committedAt) && Boolean(data?.defender?.committedAt);
}
