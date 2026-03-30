/**
 * src/core/skills/opposed-workflow/banking/orchestrator.js
 *
 * Banked-choice auto-roll orchestration for skill opposed tests.
 *
 * Mirrors the combat banking orchestrator pattern:
 *  - Claim-id protocol prevents concurrent runners
 *  - Sequential lane dispatch (attacker first, then defender)
 *  - Single _updateCard write at completion
 *  - Authority: active GM when present, message author otherwise
 */

import { _bothSidesCommitted, _getMessageState } from "../core/schema.js";
import { bankedAutoRollLocalLocks } from "../core/constants.js";
import { _updateCard } from "../core/card-updater.js";
import { verifyAutoRollClaim } from "../../../opposed/shared/auto-roll-claim.js";
import { perfStart, perfEnd } from "../../../../utils/debug.js";

/**
 * Called from updateChatMessage hook when a skill opposed card updates (GM present).
 * @param {ChatMessage} message
 * @param {object} workflow  SkillOpposedWorkflow facade
 */
export async function maybeAutoRollBanked(message, workflow) {
  try {
    const activeGM = game.users.activeGM ?? null;
    if (!activeGM) return;
    if (game.user.id !== activeGM.id) return;

    const data = _getMessageState(message);
    if (!data) return;

    if (data.context?.autoRollStarted) return;
    if (!_bothSidesCommitted(data)) return;
    if (data.attacker?.result || data.defender?.result || data.outcome || data.status === "resolved") return;

    await autoRollBanked(message.id, workflow, { trigger: "hook" });
  } catch (err) {
    console.error("UESRPG | Skill opposed banked GM auto-roll hook failed", err);
  }
}

/**
 * Called from updateChatMessage hook when a skill opposed card updates (no GM).
 * @param {ChatMessage} message
 * @param {object} workflow  SkillOpposedWorkflow facade
 */
export async function maybeAutoRollBankedNoGM(message, workflow) {
  try {
    const activeGM = game.users.activeGM ?? null;
    if (activeGM) return;
    if (!message.isAuthor) return;

    const data = _getMessageState(message);
    if (!data) return;

    if (data.context?.autoRollStarted) return;
    if (!_bothSidesCommitted(data)) return;
    if (data.attacker?.result || data.defender?.result || data.outcome || data.status === "resolved") return;

    await autoRollBanked(message.id, workflow, { trigger: "hook-no-gm" });
  } catch (err) {
    console.error("UESRPG | Skill opposed banked no-GM auto-roll hook failed", err);
  }
}

/**
 * Execute the banked auto-roll: claim the orchestration token, roll attacker
 * then defender sequentially, write once.
 *
 * @param {string} parentMessageId
 * @param {object} workflow  SkillOpposedWorkflow facade (has handleAction)
 * @param {object} [opts]
 * @param {string} [opts.trigger]
 */
export async function autoRollBanked(parentMessageId, workflow, { trigger = "unknown" } = {}) {
  if (!parentMessageId) return;
  if (bankedAutoRollLocalLocks.has(parentMessageId)) return;
  bankedAutoRollLocalLocks.add(parentMessageId);

  try {
    const message = game.messages.get(parentMessageId) ?? null;
    if (!message) return;

    let data = _getMessageState(message);
    if (!data) return;

    if (!_bothSidesCommitted(data)) return;
    if (data.outcome || data.status === "resolved" || (data.attacker?.result && data.defender?.result)) return;

    // ── Claim-ID protocol ──────────────────────────────────────────────
    data.context = data.context ?? {};
    if (data.context.autoRollStarted) return;
    data.context.autoRollAttemptedBy = game.user.id;
    data.context.autoRollAttemptedAt = Date.now();
    data.context.autoRollAttemptReason = String(trigger ?? "unknown");

    const claimId = foundry.utils.randomID();
    data.context.autoRollStarted = true;
    data.context.autoRollClaimId = claimId;
    data.context.autoRollStartedAt = Date.now();
    data.context.autoRollStartedBy = game.user.id;
    data.context.autoRollStartedTrigger = String(trigger ?? "unknown");

    const claimLabel = `banked.claim.write:skills:${parentMessageId}`;
    perfStart(claimLabel);
    await _updateCard(message, data);
    perfEnd(claimLabel);

    // Verify we still own the claim after the persisted update.
    const freshAfterClaim = _getMessageState(message);
    if (!verifyAutoRollClaim(freshAfterClaim?.context, claimId)) return;

    let workingData = freshAfterClaim;

    // Roll attacker lane first if needed.
    if (!freshAfterClaim?.attacker?.result) {
      const aLabel = `banked.attacker.roll:skills:${parentMessageId}`;
      perfStart(aLabel);
      const next = await workflow.handleAction(message, "attacker-roll-committed", {
        batchedUpdate: true,
        dataOverride: workingData
      });
      if (next && typeof next === "object") workingData = next;
      perfEnd(aLabel);
    }

    // Roll defender lane if needed.
    if (!workingData?.defender?.result) {
      const dLabel = `banked.defender.roll:skills:${parentMessageId}`;
      perfStart(dLabel);
      const next = await workflow.handleAction(message, "defender-roll-committed", {
        batchedUpdate: true,
        dataOverride: workingData
      });
      if (next && typeof next === "object") workingData = next;
      perfEnd(dLabel);
    }

    const finalLabel = `banked.final.write:skills:${parentMessageId}`;
    perfStart(finalLabel);
    await _updateCard(message, workingData);
    perfEnd(finalLabel);
  } finally {
    bankedAutoRollLocalLocks.delete(parentMessageId);
  }
}
