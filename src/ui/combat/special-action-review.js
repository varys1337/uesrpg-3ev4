import { customDialog } from "../../utils/dialog-v2-helper.js";
import { escapeHtml } from "../../utils/html.js";
import { t } from "../../utils/i18n.js";
import { ChatOutcomeApplicationService, getChatOutcomes, getChatOutcomeReceipt } from "../../application/combat/chat-outcome-application-service.js";
import { specialActionRecoveryDecision, specialActionReviewSignature } from "../../core/combat/special-action-operations.js";

export async function showSpecialActionReview(message, outcomeId) {
  if (!game.user.isGM) return;
  const outcome = getChatOutcomes(message).find(entry => entry.id === outcomeId && entry.adapter === "combat.special");
  if (!outcome) return;
  const receipt = getChatOutcomeReceipt(message, outcome);
  const expected = specialActionReviewSignature(outcome, receipt);
  const evidence = { sourceMessageUuid: message.uuid, outcome, receipt };
  const needsReview = specialActionRecoveryDecision({ outcome, receipt }).action === "review";
  const canResolve = ((receipt?.status ?? outcome.status) !== "applied" || needsReview)
    && (!outcome.operation || outcome.operation.version === 1);
  const choices = await customDialog({ title: t("UESRPG.Chat.SpecialActions.Review"), layout: "workflow", width: 660,
    content: `<p>${escapeHtml(t("UESRPG.Chat.SpecialActions.Instructions"))}</p><pre style="max-height:340px;overflow:auto;white-space:pre-wrap">${escapeHtml(JSON.stringify(evidence, null, 2))}</pre>${canResolve
      ? `<label>${escapeHtml(t("UESRPG.Chat.SpecialActions.Reason"))}<input name="reason" type="text" minlength="3" required></label><label>${escapeHtml(t("UESRPG.Chat.SpecialActions.Disposition"))}<select name="disposition"><option value="resolved">${escapeHtml(t("UESRPG.Chat.SpecialActions.Resolved"))}</option><option value="abandoned">${escapeHtml(t("UESRPG.Chat.SpecialActions.Abandoned"))}</option></select></label><label><input name="processorStopped" type="checkbox">${escapeHtml(t("UESRPG.Chat.SpecialActions.ProcessorStopped"))}</label>` : ""}`,
    buttons: { close: { label: t("UESRPG.UI.Close") }, ...(canResolve ? { resolve: { label: t("UESRPG.Chat.SpecialActions.Record"), callback: html => {
      const root = html instanceof HTMLElement ? html : html?.[0];
      return { reason: root.querySelector('[name="reason"]')?.value?.trim(), disposition: root.querySelector('[name="disposition"]')?.value,
        processorStopped: root.querySelector('[name="processorStopped"]')?.checked === true };
    } } } : {}) }, default: "close" });
  if (!choices?.reason || !choices.processorStopped) return;
  const result = await ChatOutcomeApplicationService.reconcileSpecial(message, outcomeId, { ...choices, expected });
  if (!result?.actionResult?.ok) ui.notifications?.warn?.(result?.actionResult?.reason ?? result?.reason ?? t("UESRPG.Chat.SpecialActions.ReviewChanged"));
  return result;
}
