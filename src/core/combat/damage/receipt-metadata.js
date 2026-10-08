import { SYSTEM_ID } from "../../system/namespace.js";

export const DAMAGE_RECEIPT_PATH = `flags.${SYSTEM_ID}.damageApplications`;
const DELETE_RECEIPT_PATH = `flags.${SYSTEM_ID}.-=damageApplications`;

function isReceiptPath(path) {
  return path === DAMAGE_RECEIPT_PATH || path.startsWith(`${DAMAGE_RECEIPT_PATH}.`) || path === DELETE_RECEIPT_PATH;
}

function visitReceiptUpdate(value, path, only, state) {
  if (isReceiptPath(path)) {
    state.found = true;
    return true;
  }
  if (only && (path === "_id" || path === "_stats" || path.startsWith("_stats."))) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length) return false;
  const visit = ([key, entry]) => visitReceiptUpdate(entry, path ? `${path}.${key}` : key, only, state);
  return only ? entries.every(visit) : entries.some(visit);
}

export function hasDamageReceiptUpdate(changed) {
  return visitReceiptUpdate(changed, "", false, { found: false });
}

/** Stop at the receipt array; neither payloads nor unrelated flags are traversed. */
export function isDamageReceiptOnlyUpdate(changed) {
  const state = { found: false };
  return visitReceiptUpdate(changed, "", true, state) && state.found;
}
