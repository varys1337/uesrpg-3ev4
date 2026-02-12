/**
 * src/core/skills/opposed/helpers.js
 * Modifier building, outcome resolution, and special action helpers
 */

import { resolveOpposed } from "../../../utils/degree-roll-helper.js";
import { normalizeTalentKey, hasTalent } from "../../traits/talents-api.js";
import { applySenseLossPenaltyAdjustments } from "../../traits/awareness-talents.js";
import { hasCondition } from "../../conditions/condition-engine.js";
import { _esc } from "./util.js";

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

export async function _executeSpecialActionIfWinner(data) {
  // Issue 2: Special Action automation on opposed test win
  if (data.outcome?.winner === "attacker" && data.specialActionId) {
    try {
      const { executeSpecialAction } = await import("../../combat/special-actions-helper.js");
      const { _resolveActor } = await import("./docs.js");
      const attackerActor = _resolveActor(data.attacker.actorUuid);
      const defenderActor = _resolveActor(data.defender.actorUuid);
      
      if (attackerActor && defenderActor) {
        const result = await executeSpecialAction({
          specialActionId: data.specialActionId,
          actor: attackerActor,
          target: defenderActor,
          isAutoWin: false, // Was opposed test, not auto-win
          opposedResult: { 
            winner: "attacker", 
            degrees: data.outcome?.degrees ?? 0 
          }
        });
        
        if (result.success) {
          // Post automation result to chat
          await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
            content: `<div class="uesrpg-special-action-outcome"><b>Special Action:</b><p>${_esc(result.message)}</p></div>`,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
          });
        }
      }
    } catch (err) {
      console.error("UESRPG | Failed to execute Special Action automation", err);
    }
  }
}
