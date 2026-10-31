import { requestAtomicUpdateDocument } from "../../utils/authority-proxy.js";
import { acquireLock, releaseLock, stableStringify } from "../../utils/authority-proxy/shared.js";
import { confirmDialog } from "../../utils/dialog-v2-helper.js";
import { escapeHtml } from "../../utils/html.js";
import { isActiveGMUser } from "../../utils/users.js";
import { getChatOutcomes, describeChatOutcome } from "../../application/combat/chat-outcome-application-service.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { getActionEligibility } from "./opposed/actions/eligibility.js";
import { isActorCombatStepCurrent } from "./combat-scope.js";

const PROGRESS_PATH = `flags.${SYSTEM_ID}.extendedAction`;
const REVIEW_PATH = `flags.${SYSTEM_ID}.extendedActionReview`;

/** Read a saved extended-action payment record without guessing at unknown versions. */
export function readExtendedAction(actor) {
  const record = actor?.flags?.[SYSTEM_ID]?.extendedAction;
  if (record == null) return null;
  if (record.version !== 1 || !record.id || !record.kind || !record.actorUuid || !record.itemUuid
    || !record.targetUuid || !record.combatId || !record.combatantId
    || !["inProgress", "queueing", "queued", "completed", "review"].includes(record.status)
    || !Number.isInteger(record.required) || record.required < 2
    || !Number.isInteger(record.paid) || record.paid < 1 || record.paid > record.required
    || !Array.isArray(record.payments) || record.payments.length !== record.paid
    || (record.status === "inProgress" && record.paid >= record.required)
    || (["queueing", "queued", "completed"].includes(record.status) && record.paid !== record.required)) {
    throw new Error("The extended-action record is malformed or unsupported; the GM must inspect it before continuing.");
  }
  return record;
}

/** One local actor lock covers confirmation, payment and outcome submission. */
export async function withExtendedActionLock(actor, operation) {
  const key = `extended-action:${actor?.uuid ?? "missing"}`;
  if (!await acquireLock(key, { wait: false })) return { ok: false, status: "processing", reason: "An extended action is already processing on this client." };
  try { return await operation(); }
  finally { releaseLock(key); }
}

/** Commit one AP and its receipt in the same Actor update. */
export async function payExtendedActionPoint({ actor, item, target, kind, label, required, step, completion, checkTarget, checkItem }) {
  let previous;
  try { previous = readExtendedAction(actor); }
  catch (error) { return { ok: false, status: "blocked", reason: error.message }; }
  const expected = stableStringify(previous);
  const operationId = previous?.id ?? foundry.utils.randomID();
  let rejected = "";
  const saved = await requestAtomicUpdateDocument(actor, fresh => {
    let current;
    try { current = readExtendedAction(fresh); }
    catch (error) { rejected = error.message; return null; }
    if (!isActiveGMUser(game.user) || !isActorCombatStepCurrent(fresh, step)
      || game.combat?.combatant?.actor?.uuid !== fresh.uuid || stableStringify(current) !== expected) {
      rejected = "The GM, combat step or saved action changed before payment.";
      return null;
    }
    const liveItem = fresh.items?.get?.(item.id);
    if (liveItem?.uuid !== item.uuid || !checkItem(liveItem) || !checkTarget()) {
      rejected = "The power or target changed before payment.";
      return null;
    }
    const gate = getActionEligibility(fresh, { actionFamily: "utility", actionType: "secondary", combat: game.combat });
    if (!gate.allowed) { rejected = `The action is blocked: ${gate.reasons.join(", ")}.`; return null; }
    if (current && (current.status !== "inProgress" || current.kind !== kind || current.actorUuid !== fresh.uuid
      || current.itemUuid !== item.uuid || current.targetUuid !== target.uuid || current.combatId !== step.id
      || current.combatantId !== step.combatantId || current.required !== required)) {
      rejected = "The saved extended action does not match this power, target or combatant. Review it before continuing.";
      return null;
    }
    const ap = Number(fresh.system?.action_points?.value);
    if (!Number.isInteger(ap) || ap < 1) { rejected = "At least 1 whole Action Point is required."; return null; }
    const paid = (current?.paid ?? 0) + 1;
    const record = {
      ...(current ?? { version: 1, id: operationId, kind, label, actorUuid: fresh.uuid, itemUuid: item.uuid,
        targetUuid: target.uuid, targetName: target.name, combatId: step.id, combatantId: step.combatantId,
        required, createdAt: Date.now() }),
      paid, status: paid === required ? "queueing" : "inProgress",
      payments: [...(current?.payments ?? []), { round: step.round, turn: step.turn, before: ap, after: ap - 1 }],
      ...(paid === required ? { completion } : {}),
    };
    return { "system.action_points.value": ap - 1, [PROGRESS_PATH]: record };
  });
  if (!saved) return { ok: false, status: rejected ? "blocked" : "needsReview", reason: rejected || "Payment was not confirmed. Inspect the actor's AP and saved action before retrying." };
  let recorded;
  try { recorded = readExtendedAction(actor); }
  catch (_error) {
    return { ok: false, status: "needsReview", reason: "Payment returned but its receipt could not be read. Inspect the actor and do not pay again." };
  }
  if (recorded?.id !== operationId || recorded.paid !== (previous?.paid ?? 0) + 1) {
    return { ok: false, status: "needsReview", reason: "Payment returned without a matching receipt. Inspect the actor and do not pay again." };
  }
  const payment = recorded.payments.at(-1);
  let stillCurrent = false;
  try {
    stillCurrent = isActiveGMUser(game.user) && isActorCombatStepCurrent(actor, step)
      && Number(actor.system?.action_points?.value) === payment.after && checkTarget()
      && checkItem(actor.items?.get?.(item.id));
  } catch (_error) { stillCurrent = false; }
  if (!stillCurrent) {
    const expectedRecord = stableStringify(recorded);
    await requestAtomicUpdateDocument(actor, fresh => {
      const current = readExtendedAction(fresh);
      return isActiveGMUser(game.user) && stableStringify(current) === expectedRecord
        ? { [PROGRESS_PATH]: { ...current, status: "review" } } : null;
    });
    return { ok: false, status: "needsReview", paid: true,
      reason: "AP was recorded, but the action, target or combat step changed during payment. Inspect the actor and saved receipt before continuing; do not pay again." };
  }
  return { ok: true, record: recorded };
}

/** Record a confirmed completion without repeating the paid action. */
export async function markExtendedActionCompletion(actor, record, { messageId = null } = {}) {
  const expected = stableStringify(record);
  const saved = await requestAtomicUpdateDocument(actor, fresh => {
    const current = readExtendedAction(fresh);
    if (!isActiveGMUser(game.user) || stableStringify(current) !== expected || current?.status !== "queueing") return null;
    return { [PROGRESS_PATH]: { ...current, status: messageId ? "queued" : "completed", messageId } };
  });
  if (!saved) return false;
  try {
    const current = readExtendedAction(actor);
    return current?.id === record.id && current.status === (messageId ? "queued" : "completed") && current.messageId === messageId;
  } catch (_error) { return false; }
}

function hasUnsettledOutcome(message, actor) {
  if (!message) return false;
  const outcomes = getChatOutcomes(message).filter(outcome => outcome.adapter === "healing" && outcome.targetUuid === actor.uuid);
  return outcomes.length !== 1 || outcomes.some(outcome => ["pending", "processing"].includes(describeChatOutcome(message, outcome).status));
}

/** Abandon or release a held action only after the active GM reviews it. */
export async function reviewExtendedAction(actor) {
  if (!isActiveGMUser(game.user) || !actor) {
    ui.notifications?.warn?.("The active GM must select the actor and review the extended action.");
    return { ok: false };
  }
  let record;
  try { record = readExtendedAction(actor); }
  catch (error) { ui.notifications?.warn?.(error.message); return { ok: false, needsReview: true }; }
  if (!record) return { ok: true, empty: true };
  const expected = stableStringify(record);
  const message = record.messageId ? game.messages?.get?.(record.messageId) : null;
  const pending = hasUnsettledOutcome(message, actor);
  if (pending) {
    ui.notifications?.warn?.("The recorded healing outcome is still pending or processing. Resolve it before releasing this action.");
    return { ok: false, pending: true };
  }
  const confirmed = await confirmDialog({
    title: "Review extended action",
    content: `<p>${escapeHtml(record.label)} on ${escapeHtml(record.targetName)}: ${record.paid}/${record.required} AP recorded. Status: ${escapeHtml(record.status)}.</p><p>Operation: ${escapeHtml(record.id)}. Healing message: ${escapeHtml(record.messageId ?? "not confirmed")}. Healing amount: ${escapeHtml(record.completion?.amount ?? "not established")}.</p><p>Stop previous processing on every client. Inspect AP, the target, chat and healing; resolve or abandon the action manually before releasing the record. Releasing it neither refunds AP nor applies or cancels healing.</p>`,
    yesLabel: "Reviewed; release record",
  });
  if (!confirmed) return { ok: false, cancelled: true };
  return withExtendedActionLock(actor, async () => {
    const cleared = await requestAtomicUpdateDocument(actor, fresh => {
      const current = readExtendedAction(fresh);
      if (!isActiveGMUser(game.user) || stableStringify(current) !== expected) return null;
      const liveMessage = current.messageId ? game.messages?.get?.(current.messageId) : null;
      if (hasUnsettledOutcome(liveMessage, fresh)) return null;
      return { [PROGRESS_PATH]: null, [REVIEW_PATH]: { operationId: current.id, priorStatus: current.status,
        paid: current.paid, required: current.required, reviewedBy: game.user.id, reviewedAt: Date.now() } };
    });
    if (!cleared) ui.notifications?.warn?.("The review was not confirmed. Inspect the actor and outcome before trying again.");
    return { ok: Boolean(cleared), needsReview: !cleared };
  });
}
