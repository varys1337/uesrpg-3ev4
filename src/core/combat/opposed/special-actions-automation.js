import { planSpecialAdvantageSource } from "../special-action-operations.js";
import { createActionResult, aggregateActionResults } from "../../../application/action-results.js";
/**
 * src/core/combat/opposed/special-actions-automation.js
 *
 * Special Actions advantage automation for opposed combat.
 * Extracted from monolith (Phase 15) to eliminate code duplication and improve modularity.
 *
 * Exported functions:
 * - executeAdvantageSpecialActions: Handle auto-win and free special actions from advantage spending
 */

import { getSpecialActionById } from "../combat-style-utils.js";
import { _resolveToken } from "./helpers/docs.js";



/**
 * Execute special actions selected during advantage spending.
 * Handles both auto-win (1 AP, auto-succeed) and free (0 AP, initiate test) modes.
 * 
 * @param {Object} opts
 * @param {Array<string>} opts.specialActionIds - Array of special action IDs to execute
 * @param {Object} opts.actor - Actor using the special actions
 * @param {Object} opts.opponent - Opponent actor
 * @param {string} opts.role - "attacker" or "defender" (for opposite result winner)
 * @param {string} opts.actorTokenUuid - UUID of actor's token
 * @param {string} opts.opponentTokenUuid - UUID of opponent's token
 */
export async function executeAdvantageSpecialActions({
  specialActionIds = [],
  sourceMessage = null,
  sourceState = null,
  actor,
  opponent,
  role = "attacker",
  actorTokenUuid = null,
  opponentTokenUuid = null,
  attackerStyleUuid = null,
  defenderStyleUuid = null,
  source = "advantage-free",
  sourceWeaponUuid = null,
  freeActionCost = 0,
  freeActionReason = "Special Advantage",
  onAutoWinSuccess = null,
  onAutoWinAccepted = null
} = {}) {
  const results = [];
  const finish = status => ({ actionResult: results.length ? aggregateActionResults(results, { owner: "specialAdvantages", scope: "selected actions" })
    : createActionResult({ owner: "specialAdvantages", scope: "selected actions", status }) });
  if (!Array.isArray(specialActionIds) || specialActionIds.length === 0) return finish("complete");
  if (!actor) return finish("rejected");

  try {
    const { showSpecialAdvantageDialog, postSpecialActionOutcome, chooseSnareSpecialAction } = await import("../special-actions-helper.js");
    for (const [index, saId] of specialActionIds.entries()) {
      const plan = planSpecialAdvantageSource({ sourceUuid: sourceMessage?.uuid ?? `submission:${foundry.utils.randomID(24)}`,
        state: sourceState ?? {}, role, specialActionId: saId, index, actorUuid: actor.uuid, opponentUuid: opponent?.uuid,
        actorTokenUuid, opponentTokenUuid, entries: sourceMessage?.flags?.["uesrpg-3ev4"]?.chatOutcomes?.entries ?? [] });
      if (!plan) continue;
      const { sourceKind, slot, signature, resultRevision } = plan.operation;
      const choice = await showSpecialAdvantageDialog(saId);
      if (!choice || !['free', 'autowin'].includes(choice.mode)) continue;
      const snare = await chooseSnareSpecialAction({ specialActionId: saId, actor,
        actorToken: _resolveToken(actorTokenUuid), targetToken: _resolveToken(opponentTokenUuid), sourceWeaponUuid });
      if (!snare) continue;
      const def = getSpecialActionById(saId);
      const result = await postSpecialActionOutcome({ specialActionId: saId, actor, target: opponent ?? null,
        isAutoWin: choice.mode === 'autowin', opposedResult: { winner: role }, sourceMessage, sourceKind,
        slot, signature, resultRevision, actorTokenUuid, targetTokenUuid: opponentTokenUuid,
        launch: { mode: choice.mode, apCost: choice.mode === 'autowin' ? 1 : Math.max(0, Number(freeActionCost) || 0),
          reason: choice.mode === 'autowin' ? 'Special Advantage: ' + def?.name + ' (Auto-Win)' : freeActionReason + ' (' + (def?.name ?? saId) + ')',
          context: { source, attackerStyleUuid, defenderStyleUuid, sourceWeaponUuid, snareWeaponUuid: snare.weaponUuid,
            snareRangeSnapshot: snare.rangeSnapshot ?? null } } });
      results.push(result);
      if (!result.replayed && choice.mode === 'autowin') {
        if (result.actionResult.accepted && !["blocked", "rejected", "cancelled"].includes(result.actionResult.status) && onAutoWinAccepted) await onAutoWinAccepted(result);
        if (result.actionResult.ok && onAutoWinSuccess) await onAutoWinSuccess(result);
      }
      if (!result.actionResult.accepted || ["blocked", "rejected", "partial", "needsReview"].includes(result.actionResult.status)) ui.notifications?.warn?.(result.message);
    }
  } catch (err) {
    console.error("UESRPG | Failed to execute Special Advantage automation", err);
    results.push({ actionResult: createActionResult({ owner: "specialAdvantages", scope: "submission", status: "needsReview", commitment: "uncertain", reason: String(err.message ?? err) }) });
  }
  return finish("cancelled");
}
