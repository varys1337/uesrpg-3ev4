/**
 * Transient action evidence, version 1. Domain owners supply facts; this module
 * neither executes actions nor infers writes from Documents or current values.
 */
export const ACTION_RESULT_VERSION = 1;
export const ACTION_STATUSES = Object.freeze({
  COMPLETE: "complete", PENDING: "pending", PROCESSING: "processing",
  BLOCKED: "blocked", CANCELLED: "cancelled", REJECTED: "rejected",
  PARTIAL: "partial", NEEDS_REVIEW: "needsReview",
});
export const ACTION_COMMITMENTS = Object.freeze({ NONE: "none", CONFIRMED: "confirmed", UNCERTAIN: "uncertain" });
const statuses = new Set(Object.values(ACTION_STATUSES));
const commitments = new Set(Object.values(ACTION_COMMITMENTS));
const referenceKeys = ["operationId", "applicationId", "requestId", "messageId", "outcomeId", "receiptId", "actorUuid", "itemUuid", "targetUuid"];
const text = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 2000) : null;

export function createActionResult({ owner, scope, status, commitment = "none", accepted = false,
  references = {}, code = null, reason = null, warnings = [], targets = [] } = {}) {
  if (typeof owner !== "string" || !owner.trim() || typeof scope !== "string" || !scope.trim()
    || !statuses.has(status) || !commitments.has(commitment)) throw new TypeError("Invalid action result contract.");
  // A guard or cancellation cannot erase already confirmed or uncertain work.
  if (commitment === "uncertain") status = "needsReview";
  else if (commitment === "confirmed" && ["blocked", "cancelled", "rejected"].includes(status)) status = "partial";
  const refs = {};
  for (const key of referenceKeys) if (text(references?.[key])) refs[key] = text(references[key]);
  return {
    version: ACTION_RESULT_VERSION, owner: text(owner), scope: text(scope), status,
    ok: status === "complete", accepted: accepted === true || ["complete", "pending", "processing", "partial"].includes(status),
    commitment, references: refs, code: text(code), reason: text(reason),
    warnings: (Array.isArray(warnings) ? warnings : []).map(text).filter(Boolean),
    targets: (Array.isArray(targets) ? targets : []).map(target => ({
      targetUuid: text(target?.targetUuid), actionResult: getActionResult(target?.actionResult),
    })).filter(target => target.actionResult),
  };
}

/** Read the descriptor, including the existing authority transport's data slot. */
export function getActionResult(value) {
  const result = value?.actionResult ?? value?.data?.actionResult ?? value;
  if (result?.version !== ACTION_RESULT_VERSION || !statuses.has(result.status) || !commitments.has(result.commitment)
    || typeof result.owner !== "string" || typeof result.scope !== "string" || result.ok !== (result.status === "complete")
    || typeof result.accepted !== "boolean" || result.commitment === "uncertain" && result.status !== "needsReview"
    || result.commitment === "confirmed" && ["blocked", "cancelled", "rejected"].includes(result.status)
    || result.status === "complete" && !result.accepted) return null;
  return result;
}

/** Only plain action return objects belong here. Never decorate a Document. */
export function withActionResult(value, options) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("Action return must be a plain object.");
  const actionResult = createActionResult(options);
  const result = { ...value, actionResult };
  if (typeof value.ok === "boolean") result.ok = actionResult.ok;
  if (typeof value.success === "boolean") result.success = actionResult.ok;
  return result;
}

export function aggregateActionResults(values, { owner, scope, references = {}, reason = null } = {}) {
  const results = values.map(getActionResult);
  if (results.some(result => !result) || !results.length) throw new TypeError("Aggregation requires explicit action evidence.");
  const commitment = results.some(result => result.commitment === "uncertain") ? "uncertain"
    : results.some(result => result.commitment === "confirmed") ? "confirmed" : "none";
  const has = status => results.some(result => result.status === status);
  let status = "complete";
  if (has("needsReview")) status = "needsReview";
  else if (has("partial") || (results.some(result => ["blocked", "rejected", "cancelled"].includes(result.status))
    && results.some(result => ["complete", "pending", "processing"].includes(result.status)))) status = "partial";
  else if (has("processing")) status = "processing";
  else if (has("pending")) status = "pending";
  else if (has("rejected")) status = "rejected";
  else if (has("cancelled")) status = "cancelled";
  else if (has("blocked")) status = "blocked";
  return createActionResult({ owner, scope, status, commitment, references, reason,
    accepted: results.some(result => result.accepted), warnings: results.flatMap(result => result.warnings),
    targets: results.map(result => ({ targetUuid: result.references.targetUuid, actionResult: result })),
  });
}

/** Existing receipt states stay intact. Only confirmed stages establish writes. */
export function actionResultFromReceipt(receipt, { owner, scope, references = {}, confirmed = false, ...options } = {}) {
  if (receipt?.status === "applied" && receipt.reconciliation?.version === 1
    && ["resolved", "abandoned"].includes(receipt.reconciliation.disposition)) {
    return createActionResult({ owner, scope, ...options, status: "complete", commitment: "none", accepted: true, references,
      reason: receipt.reconciliation.reason });
  }
  const stages = Object.values(receipt?.stages ?? {});
  const uncertain = stages.some(stage => ["started", "partial"].includes(stage.status));
  confirmed ||= stages.some(stage => stage.status === "applied" && stage.result?.execution?.committed === true);
  const status = ({ applied: "complete", pending: "pending", waitingGM: "pending", processing: "processing",
    partial: "needsReview", failed: "rejected" })[receipt?.status] ?? "needsReview";
  return createActionResult({ owner, scope, ...options, status,
    commitment: uncertain || status === "needsReview" ? "uncertain" : confirmed ? "confirmed" : "none",
    accepted: Boolean(receipt), references, reason: options.reason ?? receipt?.error ?? null });
}

/** Preserve the original exception and cause; callers still receive a throw. */
export function addActionErrorContext(error, options) {
  if (error && typeof error === "object" && Object.isExtensible(error)) error.actionResult = createActionResult(options);
  return error;
}

/** Facts recorded by a domain's existing writes, never snapshots of current state. */
export function actionResultFromEvidence({ confirmed = false, uncertain = false, pending = false, processing = false,
  partial = false, cancelled = false, rejected = false, blocked = false, ...options } = {}) {
  return createActionResult({ ...options,
    status: uncertain ? "needsReview" : partial ? "partial" : processing ? "processing" : pending ? "pending"
      : cancelled ? "cancelled" : rejected ? "rejected" : blocked ? "blocked" : "complete",
    commitment: uncertain ? "uncertain" : confirmed ? "confirmed" : "none" });
}
