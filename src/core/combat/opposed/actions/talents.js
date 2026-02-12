/**
 * src/core/combat/opposed/actions/talents.js
 * Handle talent-based special actions (e.g., Follow-up Strike)
 */

import { _safeGetSetting } from "../helpers/util.js";
import { _getDefenderEntries } from "../schema.js";
import { spendStaminaPoints as _spendStaminaPoints } from "../helpers/workflow.js";

/**
 * Handle "followup-strike" action - spend 1 SP to spawn follow-up attack.
 */
export async function handleFollowUpStrike(ctx, workflow) {
  const { data, message, attacker, opts, workflow: ctxWorkflow, _updateCard } = ctx;
  const wf = workflow ?? ctxWorkflow;

  if (!_safeGetSetting("uesrpg-3ev4", "enableFollowupStrike", false)) return false;

  const fctx = data?.context ?? {};
  const fus = fctx.followUpStrike;

  if (!fus?.eligible || fus?.used) {
    ui.notifications.warn("Follow-up Strike is not available.");
    return false;
  }

  if (!attacker) {
    ui.notifications.warn("Unable to resolve attacker.");
    return false;
  }

  const defIndex = Number(opts?.["defender-index"] ?? 0);
  const allDefenders = _getDefenderEntries(data);
  const def = allDefenders?.[defIndex] ?? allDefenders?.[0] ?? null;

  if (!def?.tokenUuid) {
    ui.notifications.warn("Unable to resolve target for Follow-up Strike.");
    return false;
  }

  const spOk = await _spendStaminaPoints(attacker, 1, { silent: false });
  if (!spOk) return false;

  fctx.followUpStrike = { ...fus, used: true };
  data.context = fctx;
  await _updateCard(message, data);

  if (wf?.createPending) {
    await wf.createPending({
      attackerTokenUuid: data?.attacker?.tokenUuid,
      defenderTokenUuids: [def.tokenUuid],
      attackerActorUuid: data?.attacker?.actorUuid,
      attackerItemUuid: data?.attacker?.itemUuid,
      attackerLabel: `${data?.attacker?.label ?? "Attack"} (Follow-up Strike)`,
      attackerTarget: data?.attacker?.target ?? null,
      weaponUuid: fus.otherWeaponUuid,
      followUpStrike: true,
      forcedHitLocation: data?.context?.forcedHitLocation ?? null
    });
  }

  return true;
}
