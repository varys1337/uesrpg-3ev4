import { isActorInStartedCombatEncounter } from "../../combat/combat-scope.js";
import { _resolveActorViaToken, _resolveToken } from "../../combat/opposed/helpers/docs.js";
import { getDefenseGatingContextSync } from "../../combat/opposed/helpers/workflow.js";
import { computeDefenseAvailability } from "../../combat/defense-options.js";
import { hasEquippedShield } from "../../combat/tn.js";
import { canUseWardDefense } from "../../combat/ward-defense.js";
import { getDefenseTalentOverrides } from "../../traits/combat-talents.js";
import { shouldDeferEvadeApForStepAside } from "../../traits/mobility-talents.js";
import { _getFreeDefenseReactionContext, _getGladiatorContext } from "../../combat/opposed/helpers/talents.js";
import { t } from "../../../utils/i18n.js";

/** Read-only AP gate shared by cards, automatic commitments, and submission.
 * A defenseType checks a concrete choice; absence checks every eligible choice.
 * Magic retains its current AP rules rather than gaining weapon-only talents.
 */
export function getDefenderCommitAvailability({
  data, defenderData, defenderActor = null, attackerActor = null, messageId = null,
  mode = "combat", defenseType = null, gladiatorFree = null, allowedDefenseTypes = null
} = {}) {
  const defender = defenderActor ?? _resolveActorViaToken(defenderData?.actorUuid, defenderData?.tokenUuid);
  if (!defender) return { allowed: false, insufficientAP: false, reason: t("UESRPG.Chat.Opposed.DefenderUnavailable", "Defender unavailable") };
  const rawCost = Number(defenderData?.apCost ?? 1);
  const apCost = Number.isFinite(rawCost) ? Math.max(0, rawCost) : 1;
  const currentAP = Number(defender.system?.action_points?.value ?? 0) || 0;
  const inCombat = isActorInStartedCombatEncounter(defender, {
    tokenUuid: defenderData?.tokenUuid ?? null, combatantId: defenderData?.combatantId ?? null
  });
  const base = { apCost, currentAP, inCombat, insufficientAP: false };
  if (!inCombat || apCost === 0) return { ...base, allowed: true };
  if (mode === "magic") {
    // The deferred spell can still be a direct spell or an AP-free characteristic save.
    if (defenderData?.defenseType === "characteristic-save" || data?.context?.unopposed
      || data?.context?.noDefenseUnopposed || data?.context?.healingDirect
      || (data?.attacker?.pendingSpellChoice && !defenseType)) return { ...base, allowed: true };
  } else {
    // Warfare keeps its separate Hold/defense cost workflow.
    if (data?.context?.hybrid?.enabled && String(defenderData?.combatDomain ?? data.context.hybrid.defenderDomain) === "warfare") {
      return { ...base, allowed: true };
    }
    const attacker = attackerActor ?? _resolveActorViaToken(data?.attacker?.actorUuid, data?.attacker?.tokenUuid);
    const token = _resolveToken(defenderData?.tokenUuid ?? defender.token);
    const attackMode = data?.context?.attackMode ?? "melee";
    const gating = getDefenseGatingContextSync({ attacker, defender, data });
    let types = allowedDefenseTypes ?? (data?.context?.isAoE || data?.context?.aoe?.isAoE ? ["block", "evade"] : null);
    const intercept = defenderData?.defenderIntercept?.allowedDefenseTypes;
    if (Array.isArray(intercept)) types = types ? types.filter(type => intercept.includes(type)) : intercept;
    const availability = computeDefenseAvailability({
      ...gating, attackMode, attackerActor: attacker, defenderActor: defender,
      defenderHasShield: hasEquippedShield(defender), defenderHasWard: canUseWardDefense(defender),
      allowedDefenseTypes: types,
      ...getDefenseTalentOverrides({ defender, attackMode, attackerWeaponTraits: gating.attackerWeaponTraits })
    });
    const eligible = defenseType ? [defenseType === "ward" ? "block" : defenseType] : Object.keys(availability.allowed);
    const legalTypes = eligible.filter(type => availability.allowed[type]);
    const gladiator = _getGladiatorContext({ defender, defenderToken: token, attackMode });
    const useGladiator = gladiator.triggered && gladiator.available
      && (gladiator.mode === "original" || (gladiator.mode === "updated" && gladiatorFree !== false));
    const free = _getFreeDefenseReactionContext({
      defenderData, defenderActor: defender, messageId, gladiator: useGladiator ? gladiator.roundCtx : null
    });
    const deferred = legalTypes.some(type => shouldDeferEvadeApForStepAside({
      defender, defenseType: type, attackerLabel: data?.attacker?.label ?? data?.attacker?.attackerLabel ?? data?.attacker?.name
    }));
    if (legalTypes.length && (free.free || deferred)) return { ...base, allowed: true, free, deferred };
  }
  return currentAP >= apCost ? { ...base, allowed: true }
    : { ...base, allowed: false, insufficientAP: true, reason: `${currentAP}/${apCost} AP` };
}
