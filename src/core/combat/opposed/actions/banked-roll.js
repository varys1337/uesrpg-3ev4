/**
 * src/core/combat/opposed/actions/banked-roll.js
 * Handle banked roll trigger action
 */

import { _allDefendersCommitted, reconcileBankedAutoRollRequest } from "../banking/state.js";
import { _anyActiveGMOnline } from "../helpers/util.js";

/**
 * Handle "banked-roll" action - trigger auto-rolling after both sides commit.
 */
export async function handleBankedRoll(ctx, workflow) {
  const { data, message, bankMode, workflow: ctxWorkflow, _updateCard } = ctx;
  const wf = workflow ?? ctxWorkflow;

  if (!bankMode) return;

  if (!_allDefendersCommitted(data)) {
    ui.notifications.warn("All participants must commit their choices before rolling.");
    return;
  }

  const reconciled = reconcileBankedAutoRollRequest(data);
  if (!reconciled.eligible) return;

  await _updateCard(message, data);

  if (!_anyActiveGMOnline()) {
    ui.notifications.info("No active GM is online; rolling will proceed automatically for each participant.");
    return;
  }

  const activeGM = game.users.activeGM ?? null;
  if (activeGM && game.user.id !== activeGM.id) {
    ui.notifications.info("Requested GM to begin the opposed roll.");
    return;
  }

  if (!game.user.isGM) {
    ui.notifications.warn("Only the active GM may begin the opposed roll.");
    return;
  }

  if (wf?._autoRollBanked) {
    await wf._autoRollBanked(message.id, { trigger: "manual" });
  }
}
