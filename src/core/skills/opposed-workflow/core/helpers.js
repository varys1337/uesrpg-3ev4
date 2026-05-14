/**
 * src/core/skills/opposed/helpers.js
 * Modifier building, outcome resolution, and special action helpers
 */

import { resolveOpposed } from "../../../../utils/degree-roll-helper.js";
import { normalizeTalentKey, hasTalent } from "../../../traits/talents-api.js";
import { applySenseLossPenaltyAdjustments } from "../../../traits/awareness-talents.js";
import { hasCondition } from "../../../conditions/condition-engine.js";
import { isActorInStartedCombatEncounter } from "../../../combat/combat-scope.js";
import { _esc } from "./util.js";
import { _resolveActor } from "./docs.js";

export function _buildSensorySituationalMods(decl, actor = null, { skillName = null } = {}) {
  const mods = [];
  if (decl?.applyBlinded) mods.push({ key: "blinded", conditionKey: "blinded", label: "Blinded (sight)", value: -30, source: "sense-loss" });
  if (decl?.applyDeafened) mods.push({ key: "deafened", conditionKey: "deafened", label: "Deafened (hearing)", value: -30, source: "sense-loss" });

  // Observe already receives a -30 penalty from the Blinded/Deafened condition AEs.
  // When that penalty is already applied, convert Honed Senses / One with All into an offset.
  const skillKey = normalizeTalentKey(skillName);
  if (skillKey === "observe" && actor) {
    const hasBlind = hasCondition(actor, "blinded");
    const hasDeaf = hasCondition(actor, "deafened");
    for (const mod of mods) {
      if (mod?.key === "blinded" && hasBlind) mod.applyMode = "offset";
      if (mod?.key === "deafened" && hasDeaf) mod.applyMode = "offset";
    }
  }

  // Awareness talent automation: Honed Senses / One with All.
  applySenseLossPenaltyAdjustments(mods, actor);
  return mods;
}

export function _maybeAddInvisibleTrackingPenalty({ skillLabel, targetActor, situationalMods } = {}) {
  if (!targetActor || !Array.isArray(situationalMods)) return;
  if (normalizeTalentKey(skillLabel) !== "survival") return;
  if (!hasTalent(targetActor, "invisible")) return;

  if (!situationalMods.some(m => String(m?.key ?? "") === "talent:invisible")) {
    situationalMods.push({
      key: "talent:invisible",
      label: "Invisible (Tracking)",
      value: -20,
      source: "talent"
    });
  }
}

export function _resolveOutcome(data) {
  if (!data?.attacker?.result || !data?.defender?.result) return null;
  const out = resolveOpposed(data.attacker.result, data.defender.result);
  const aName = data.attacker.name;
  const dName = data.defender.name;
  const text = out.winner === "attacker"
    ? `${aName} wins — ${data.attacker.skillLabel} beats ${data.defender.skillLabel}.`
    : (out.winner === "defender"
      ? `${dName} wins — ${data.defender.skillLabel} beats ${data.attacker.skillLabel}.`
      : `Tie — no one gains advantage.`);
  return { ...out, text };
}

function _resolveTokenForActor(actor) {
  if (!actor) return null;
  const controlled = canvas?.tokens?.controlled ?? [];
  const controlledMatch = controlled.find((t) => t?.actor?.id === actor.id);
  if (controlledMatch) return controlledMatch;
  return canvas?.tokens?.placeables?.find((t) => t?.actor?.id === actor.id) ?? null;
}

function _findEquippedMeleeWeapon(actor) {
  if (!actor) return null;
  const weapons = actor?.itemTypes?.weapon ?? actor?.items?.filter?.((i) => i?.type === "weapon") ?? [];
  return weapons.find((w) => {
    if (w?.system?.equipped !== true) return false;
    const mode = String(w?.system?.attackMode ?? "melee").trim().toLowerCase();
    return mode !== "ranged";
  }) ?? null;
}

async function _triggerInCloseFailureAoO(attackerActor, defenderActor) {
  if (!attackerActor || !defenderActor) return;

  try {
    const { isActorBlockedFromAoOAgainstTarget } = await import("../../../traits/mobility-talents.js");
    if (isActorBlockedFromAoOAgainstTarget(defenderActor, attackerActor)) {
      ui.notifications?.warn?.(`${defenderActor.name} cannot make an Attack of Opportunity against ${attackerActor.name} right now.`);
      return;
    }

    const aooWeapon = _findEquippedMeleeWeapon(defenderActor);
    if (!aooWeapon) {
      ui.notifications?.warn?.(`${defenderActor.name} has no equipped melee weapon for Attack of Opportunity.`);
      return;
    }

    const defenderAp = Number(defenderActor?.system?.action_points?.value ?? 0);
    if (isActorInStartedCombatEncounter(defenderActor) && defenderAp < 1) {
      ui.notifications?.warn?.(`${defenderActor.name} does not have enough Action Points for Attack of Opportunity.`);
      return;
    }

    const aooAttackerToken = _resolveTokenForActor(defenderActor);
    const aooDefenderToken = _resolveTokenForActor(attackerActor);
    if (!aooAttackerToken || !aooDefenderToken) {
      ui.notifications?.warn?.("Attack of Opportunity could not start: required tokens are missing from the canvas.");
      return;
    }

    const { resolveStyleForCombatTest } = await import("../../../combat/combat-style-utils.js");
    const styleCtx = resolveStyleForCombatTest(defenderActor, { actorTypeFallback: true });
    if (!styleCtx) {
      ui.notifications?.warn?.(`${defenderActor.name} has no Combat Style available for Attack of Opportunity.`);
      return;
    }

    const base = Number(styleCtx.base ?? 0) || 0;
    const fatiguePenalty = Number(defenderActor?.system?.fatigue?.penalty ?? 0) || 0;
    const carryPenalty = Number(defenderActor?.system?.carry_rating?.penalty ?? 0) || 0;
    const woundPenalty = Number(defenderActor?.system?.woundPenalty ?? 0) || 0;
    const tn = base + fatiguePenalty + carryPenalty + woundPenalty;

    const { OpposedWorkflow } = await import("../../../combat/opposed-workflow.js");
    await OpposedWorkflow.createPending({
      attackerTokenUuid: aooAttackerToken?.document?.uuid ?? aooAttackerToken?.uuid,
      defenderTokenUuids: [aooDefenderToken?.document?.uuid ?? aooDefenderToken?.uuid].filter(Boolean),
      attackerActorUuid: defenderActor.uuid,
      attackerItemUuid: styleCtx.styleUuid,
      attackerLabel: `Attack of Opportunity - ${styleCtx.styleName}`,
      attackerTarget: tn,
      mode: "attack",
      attackMode: "melee",
      weaponUuid: aooWeapon.uuid,
      isReactionAttack: true,
      skipAttackerAPDeduction: false
    });
  } catch (err) {
    console.error("UESRPG | Failed to trigger In Close failure Attack of Opportunity", err);
  }
}

export async function _executeSpecialActionIfWinner(data) {
  const specialActionId = String(data?.specialActionContext?.id ?? data?.specialActionId ?? "").trim();
  const winner = String(data?.outcome?.winner ?? "").trim().toLowerCase();
  if (!specialActionId || !winner) return;

  const attackerActor = _resolveActor(data.attacker.actorUuid);
  const defenderActor = _resolveActor(data.defender.actorUuid);
  if (!attackerActor || !defenderActor) return;

  if (winner === "attacker") {
    try {
      const { executeSpecialAction } = await import("../../../combat/special-actions-helper.js");

      const result = await executeSpecialAction({
        specialActionId,
        actor: attackerActor,
        target: defenderActor,
        isAutoWin: false,
        opposedResult: {
          winner: "attacker",
          degrees: data.outcome?.degrees ?? 0
        }
      });

      if (result.success) {
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
          content: `<div class="uesrpg-special-action-outcome"><b>Special Action:</b><p>${_esc(result.message)}</p></div>`,
          style: CONST.CHAT_MESSAGE_STYLES.OTHER
        });
      }
    } catch (err) {
      console.error("UESRPG | Failed to execute Special Action automation", err);
    }
    return;
  }

  if (winner === "defender" && specialActionId === "inClose") {
    await _triggerInCloseFailureAoO(attackerActor, defenderActor);
  }
}
