import { customDialog } from "../../utils/dialog-v2-helper.js";
import { escapeHtml } from "../../utils/html.js";
import { t, tf } from "../../utils/i18n.js";
import { doesUserOwnActor } from "../../utils/authority-proxy.js";
import { readXpPurchaseJournal, getXpPurchaseSnapshot, requestXpPurchaseReconciliation } from "../../core/advancement/purchase-service.js";

export function formatXpPurchaseFailure(result) {
  return tf("UESRPG.Purchases.Failed", { id: result.operationId ?? "-", status: result.status ?? "rejected", reason: result.reason ?? "" });
}

export async function showXpPurchaseReview(actor, { sheet = null } = {}) {
  if (!doesUserOwnActor(game.user, actor)) return;
  const journal = readXpPurchaseJournal(actor);
  const active = journal.active;
  const expected = journal.unsupported ? null : await getXpPurchaseSnapshot(actor);
  const evidence = active ? {
    operationId: active.id, workflow: active.intent.workflow, status: active.status, requester: active.requesterUserId,
    xpCost: active.xpCost, wealthCost: active.wealthCost, actorChanges: active.actorChanges, error: active.error,
    steps: active.steps.map(step => ({ kind: step.kind, status: step.status, itemUuid: step.itemUuid ?? step.itemId ?? null,
      before: step.beforeFields ?? null, requested: step.data ?? null })),
    currentResources: { xp: actor.system.xp, wealth: actor.system.wealth },
  } : { status: journal.unsupported ? "unsupported" : "none", recent: journal.receipts.map(receipt => ({ id: receipt.id, status: receipt.status, workflow: receipt.intent.workflow, xpCost: receipt.xpCost })) };
  const buttons = { close: { label: t("UESRPG.UI.Close") } };
  if (sheet) buttons.closeSheet = { label: t("UESRPG.Purchases.CloseWithoutRetry"), callback: () => "closeSheet" };
  if (active && game.user.isGM) buttons.resolve = { label: t("UESRPG.Purchases.RecordReconciliation"), callback: html => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const reason = String(root.querySelector('[name="reason"]')?.value ?? "").trim();
    const processorStopped = root.querySelector('[name="processorStopped"]')?.checked === true;
    return { reason, processorStopped };
  } };
  const choice = await customDialog({ title: t("UESRPG.Purchases.ReviewTitle"), layout: "workflow", width: 620,
    content: `<p>${escapeHtml(t("UESRPG.Purchases.ReviewInstructions"))}</p><pre style="max-height:340px;overflow:auto;white-space:pre-wrap">${escapeHtml(JSON.stringify(evidence, null, 2))}</pre>${active && game.user.isGM
      ? `<label>${escapeHtml(t("UESRPG.Purchases.Reason"))}<input type="text" name="reason" minlength="3" required></label><label><input type="checkbox" name="processorStopped">${escapeHtml(t("UESRPG.Purchases.ProcessorStopped"))}</label>` : ""}`,
    buttons, default: "close" });
  if (choice === "closeSheet") return sheet.close({ uesrpgSkipSubmitOnClose: true });
  if (choice?.reason?.length >= 3 && choice.processorStopped) {
    const result = await requestXpPurchaseReconciliation(actor, active.id, choice.reason, expected, { processorStopped: true });
    if (!result.ok) ui.notifications?.warn?.(formatXpPurchaseFailure(result));
    else ui.notifications?.info?.(t("UESRPG.Purchases.Reconciled"));
  }
}

export async function showXpPurchaseFailure(actor, result, options = {}) {
  ui.notifications?.warn?.(formatXpPurchaseFailure(result));
  if (["processing", "needsReview"].includes(result.status)) await showXpPurchaseReview(actor, options);
}

/** Do not finish a generation flow while an earlier purchase is unresolved. */
export async function ensureXpPurchasesReviewed(actor) {
  const journal = readXpPurchaseJournal(actor);
  if (!journal.unsupported && !journal.active) return true;
  ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.UnfinishedPurchase"));
  await showXpPurchaseReview(actor);
  return false;
}
