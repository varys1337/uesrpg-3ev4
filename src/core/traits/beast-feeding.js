import { queueHealingOutcome } from "../../application/combat/chat-outcome-application-service.js";
import { confirmDialog } from "../../utils/dialog-v2-helper.js";
import { escapeHtml } from "../../utils/html.js";
import { isActiveGMUser } from "../../utils/users.js";
import { stableStringify } from "../../utils/authority-proxy/shared.js";
import { resolveActorFromUuidSync } from "../../utils/uuid-cache.js";
import { getActorCombatStep, isActorCombatStepCurrent } from "../combat/combat-scope.js";
import { getActionEligibility } from "../combat/opposed/actions/eligibility.js";
import { markExtendedActionCompletion, payExtendedActionPoint, readExtendedAction, reviewExtendedAction, withExtendedActionLock } from "../combat/extended-action-progress.js";
import { getActivationCostValues, getTargetsFromContext } from "../system/activation/helpers.js";

const FEEDING_RULES = Object.freeze({
  N6Faw6oo9svWrutk: { kind: "consume", label: "Consume", required: 2, multiplier: 1 },
  bDgkogJMl8xSavAG: { kind: "consumeHeart", label: "Consume Heart", required: 3, multiplier: 2 },
});

function configuredForSource(item, rule) {
  const activation = item?.system?.activation;
  const costs = getActivationCostValues(activation?.costs);
  const requirements = activation?.requirements ?? {};
  const extraRequirements = ["requiresEquippedWeapon", "requiresMelee", "requiresRanged", "requiresHitLocation"]
    .some(key => requirements[key] === true);
  const hasMacro = game.modules?.get?.("itemacro")?.active === true
    && typeof item?.hasMacro === "function" && item.hasMacro();
  return activation?.enabled === true && activation.actionType === "secondary" && activation.spendCosts === true
    && activation.consumeUse !== true && costs.ap === rule.required
    && [costs.sp, costs.mp, costs.lp, costs.hp].every(value => value === 0)
    && !extraRequirements && !hasMacro && (activation.roll?.mode == null || activation.roll.mode === "none")
    && (activation.damage?.mode == null || activation.damage.mode === "none") && (item?.effects?.size ?? 0) === 0;
}

function enduranceBonus(actor) {
  const value = actor?.system?.characteristics?.end?.bonus;
  if (value == null || !Number.isInteger(Number(value)) || Number(value) < 0) return null;
  return Number(value);
}

/**
 * Attempt source-recognized feeding on the active GM's own combat turn.
 * Returning null retains the manual guard for unsupported contexts.
 */
export async function tryBeastFeeding({ actor, item, context, sourceId, automationEnabled } = {}) {
  const rule = FEEDING_RULES[sourceId];
  if (!rule || !automationEnabled || !isActiveGMUser(game.user) || !actor?.uuid
    || item?.parent?.uuid !== actor.uuid || !configuredForSource(item, rule)) return null;

  let previous;
  try { previous = readExtendedAction(actor); }
  catch (error) { ui.notifications?.warn?.(error.message); return { ok: false, status: "blocked", reason: error.message }; }
  if (previous && previous.status !== "inProgress") {
    await reviewExtendedAction(actor);
    return { ok: false, status: "blocked", reason: "Review the previous extended action before starting another." };
  }

  const step = getActorCombatStep(actor);
  if (!step || game.combat?.combatant?.actor?.uuid !== actor.uuid) return null;
  const targets = [...new Map(getTargetsFromContext(context)
    .map(target => target?.actor ?? target?.document?.actor ?? null)
    .filter(target => target?.documentName === "Actor" && target.uuid && target.uuid !== actor.uuid)
    .map(target => [target.uuid, target])).values()];
  if (targets.length !== 1) {
    const reason = `${rule.label}: target exactly one corpse or creature; no AP was spent. Review any saved action before changing targets.`;
    ui.notifications?.warn?.(reason);
    return { ok: false, status: "blocked", reason };
  }
  const target = targets[0];
  if (previous && (previous.kind !== rule.kind || previous.itemUuid !== item.uuid || previous.targetUuid !== target.uuid
    || previous.combatId !== step.id || previous.combatantId !== step.combatantId)) {
    const reason = "Another extended action is recorded for this actor. Review or abandon it before starting a different one.";
    ui.notifications?.warn?.(reason);
    return { ok: false, status: "blocked", reason };
  }
  const bonus = enduranceBonus(target);
  if (bonus == null || resolveActorFromUuidSync(target.uuid)?.uuid !== target.uuid) {
    const reason = "The selected creature's Endurance Bonus or identity could not be established; no AP was spent.";
    ui.notifications?.warn?.(reason);
    return { ok: false, status: "blocked", reason };
  }
  const itemSnapshot = stableStringify(item.toObject());
  const targetSnapshot = stableStringify(target.toObject());

  const result = await withExtendedActionLock(actor, async () => {
    let live;
    try { live = readExtendedAction(actor); }
    catch (error) { ui.notifications?.warn?.(error.message); return { ok: false, status: "blocked", reason: error.message }; }
    if ((live?.id ?? null) !== (previous?.id ?? null) || (live?.paid ?? 0) !== (previous?.paid ?? 0)) {
      return { ok: false, status: "blocked", reason: "The saved action changed before confirmation." };
    }
    const gate = getActionEligibility(actor, { actionFamily: "utility", actionType: "secondary", combat: game.combat });
    if (!gate.allowed) {
      const reason = `The action is blocked: ${gate.reasons.join(", ")}.`;
      ui.notifications?.warn?.(reason);
      return { ok: false, status: "blocked", reason };
    }
    const paid = previous?.paid ?? 0;
    const finishing = paid + 1 === rule.required;
    const confirmed = await confirmDialog({
      title: `${rule.label}: extended action`,
      content: `<p>${escapeHtml(actor.name)} is feeding on ${escapeHtml(target.name)}. ${paid}/${rule.required} AP have been recorded.</p><p>Confirm that the target is an eligible corpse or heart, the actor can continue feeding, and any other circumstances or reactions have been resolved. Spend 1 AP now.${finishing ? ` This completes the action and queues ${bonus * rule.multiplier} healing.` : " Activate this power again to continue, including on a later turn."}</p><p>The GM must determine and record whether this counts as sufficient feeding.</p>`,
      yesLabel: "Spend 1 AP",
    });
    if (!confirmed) return { ok: false, status: "cancelled", reason: "No AP was spent." };
    const checkTarget = () => {
      const current = resolveActorFromUuidSync(target.uuid);
      return current?.uuid === target.uuid && stableStringify(current.toObject()) === targetSnapshot
        && (!finishing || enduranceBonus(current) === bonus);
    };
    const checkItem = current => configuredForSource(current, rule) && stableStringify(current.toObject()) === itemSnapshot;
    const payment = await payExtendedActionPoint({ actor, item, target, kind: rule.kind, label: rule.label,
      required: rule.required, step, completion: { enduranceBonus: bonus, amount: bonus * rule.multiplier }, checkTarget, checkItem });
    if (!payment.ok) {
      ui.notifications?.warn?.(payment.reason);
      return payment;
    }
    const record = payment.record;
    if (record.status === "inProgress") {
      ui.notifications?.info?.(`${rule.label}: ${record.paid}/${record.required} AP recorded. Continue the same action when appropriate.`);
      return { ok: true, status: "pending", paid: true, record };
    }
    let completionCurrent = false;
    try { completionCurrent = isActiveGMUser(game.user) && isActorCombatStepCurrent(actor, step) && checkTarget(); }
    catch (_error) { completionCurrent = false; }
    if (!completionCurrent) {
      const reason = "The final AP was recorded, but the combat step or target changed before healing. Inspect the actor and chat; do not repeat the payment.";
      ui.notifications?.warn?.(reason);
      return { ok: false, status: "needsReview", paid: true, reason };
    }
    let messageId = null;
    try {
      if (record.completion.amount > 0) {
        const message = await queueHealingOutcome(actor, record.completion.amount, { source: `${rule.label}: ${target.name} (${record.id})` });
        if (!message?.id) throw new Error("The healing outcome was not confirmed.");
        messageId = String(message.id);
      }
      if (!await markExtendedActionCompletion(actor, record, { messageId })) throw new Error("The completion receipt was not confirmed.");
    } catch (error) {
      console.warn("UESRPG | Feeding completion requires review", error);
      const reason = "The final AP was recorded, but the healing outcome or its receipt was not confirmed. Inspect the actor and chat; do not repeat the payment or healing.";
      ui.notifications?.warn?.(reason);
      return { ok: false, status: "needsReview", paid: true, reason, messageId };
    }
    ui.notifications?.info?.(`${rule.label}: ${record.paid}/${record.required} AP recorded.${messageId ? " Healing was queued." : " No healing is due."} The GM must review sufficient feeding.`);
    return { ok: true, status: messageId ? "pending" : "completed", paid: true, messageId };
  });
  if (result.status === "processing") ui.notifications?.warn?.(result.reason);
  return result;
}
