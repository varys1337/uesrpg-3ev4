/**
 * @file NPC actor preparation wrapper
 * @module core/actors/prepare/npc
 */

import { prepareHumanoidData } from "./humanoid-common.js";

/**
 * Prepare NPC type specific data.
 * @param {Object} actorContext
 * @param {Object} actorData
 */
export function prepareNPCData(actorContext, actorData) {
  prepareHumanoidData(actorContext, actorData, {
    isNPC: true,
    applyThreatLuckyNumbers: true,
    useDwemerSphereSpeedOverride: true,
    useActorSkillModifierCalc: true,
    applyFormShiftSkillBuffs: false,
    cripplingSpeedPenalty: -4,
  });
}
