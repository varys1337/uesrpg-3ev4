/**
 * src/core/magic/opposed/actions/banked-roll.js
 *
 * Auto-roll orchestration for magic opposed tests (banked mode).
 *
 * Safeguards (mirroring combat orchestrator pattern):
 *  - Claim-ID protocol prevents duplicate auto-roll runs across clients.
 *  - Fresh state re-read after each roll prevents stale-data clobbering.
 *  - Sequential dispatch prevents cross-lane lost-update races.
 */

import { getMessageState, allDefendersCommitted, getDefenderEntries, getDefenderOutcome, resolveActor } from "../schema.js";
import { verifyAutoRollClaim } from "../../../opposed/shared/auto-roll-claim.js";
import { perfStart, perfEnd } from "../../../../utils/debug.js";
import { createUuidResolver } from "../../../../utils/uuid-cache.js";

/**
 * Auto-roll when all sides have committed (banked mode).
 *
 * @param {ChatMessage} message
 * @param {object} workflow - Reference to MagicOpposedWorkflow
 * @param {Function} _updateCard - Card update function (injected dependency)
 * @param {object} [opts]
 * @param {string} [opts.reason]
 * @returns {Promise<void>}
 */
export async function autoRollBanked(message, workflow, _updateCard, { reason = "hook" } = {}) {
  let data = foundry.utils.deepClone(getMessageState(message));
  if (!data) return;
  const messageId = message?.id ?? message?._id ?? "unknown";

  // For banking: require ALL defenders to be committed before rolling
  if (!allDefendersCommitted(data)) return;

  const attacker = resolveActor(data.attacker.actorUuid);
  if (!attacker) return;

  // ── Claim-ID protocol ──────────────────────────────────────────────────
  // Prevent duplicate auto-roll runs if two runners attempt simultaneously.
  data.context = data.context ?? {};
  if (data.context.autoRollStarted) return;
  data.context.autoRollAttemptedBy = game.user.id;
  data.context.autoRollAttemptedAt = Date.now();
  data.context.autoRollAttemptReason = String(reason ?? "hook");

  const claimId = foundry.utils.randomID();
  data.context.autoRollStarted = true;
  data.context.autoRollClaimId = claimId;
  data.context.autoRollStartedAt = Date.now();
  data.context.autoRollStartedBy = game.user.id;

  const claimLabel = `banked.claim.write:magic:${messageId}`;
  perfStart(claimLabel);
  await _updateCard(message, data);
  perfEnd(claimLabel);

  // Verify we still own the claim after the persisted update.
  const freshAfterClaim = foundry.utils.deepClone(getMessageState(message));
  if (!verifyAutoRollClaim(freshAfterClaim?.context, claimId)) return;
  let workingData = foundry.utils.deepClone(freshAfterClaim);

  // ── Roll attacker if not yet rolled ────────────────────────────────────
  if (!workingData?.attacker?.result) {
    const attackerLabel = `banked.attacker.roll:magic:${messageId}`;
    perfStart(attackerLabel);
    const next = await workflow.handleAction(message, "attacker-roll", {
      batchedUpdate: true,
      dataOverride: workingData
    });
    if (next && typeof next === "object") workingData = next;
    perfEnd(attackerLabel);
  }
  if (!workingData?.attacker?.result) {
    console.warn("UESRPG | Magic opposed autoRollBanked aborted: attacker result missing after attacker-roll", {
      messageId: message?.id ?? null
    });
    return;
  }

  // ── Roll defender lanes sequentially ───────────────────────────────────
  // Keep lane updates in-memory; persist once at the end.
  let currentData = foundry.utils.deepClone(workingData);
  if (!currentData) return;
  const uuidResolver = createUuidResolver();
  const spellDoc = uuidResolver.resolveSync(String(currentData?.attacker?.spellUuid ?? "").trim());
  const spell = spellDoc?.documentName === "Item" ? spellDoc : null;
  const defenderCount = getDefenderEntries(currentData).length;

  for (let idx = 0; idx < defenderCount; idx++) {
    const currentDefenders = getDefenderEntries(currentData);
    const def = currentDefenders[idx];
    if (!def) continue;

    const defActor = resolveActor(def?.actorUuid);
    if (!defActor) continue;

    // No-defense with result but no outcome → resolve immediately.
    if (def?.noDefense && def?.result && !getDefenderOutcome(currentData, def)) {
      const resolveLabel = `banked.resolve:magic:${messageId}:${idx}`;
      perfStart(resolveLabel);
      await workflow._resolveOutcome(message, currentData, attacker, defActor, {
        defenderIndex: idx,
        batchedUpdate: true,
        spell
      });
      perfEnd(resolveLabel);
      continue;
    }

    // Needs a roll → dispatch the appropriate action.
    if (!def?.result && !def?.noDefense) {
      const defenseAction = def?.defenseType === "characteristic-save"
        ? "defender-characteristic-test"
        : def?.defenseType === "block"
          ? "defender-roll-block"
          : def?.defenseType === "ward"
            ? "defender-roll-ward"
            : "defender-roll-evade";
      const defenderLabel = `banked.defender.roll:magic:${messageId}:${idx}`;
      perfStart(defenderLabel);
      const next = await workflow.handleAction(message, defenseAction, {
        defenderIndex: idx,
        batchedUpdate: true,
        dataOverride: currentData
      });
      if (next && typeof next === "object") currentData = next;
      perfEnd(defenderLabel);
    }
  }

  const finalLabel = `banked.final.write:magic:${messageId}`;
  perfStart(finalLabel);
  await _updateCard(message, currentData);
  perfEnd(finalLabel);
}
