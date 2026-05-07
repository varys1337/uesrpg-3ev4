/**
 * @file Character actor preparation wrapper
 * @module core/actors/prepare/character
 */

import { prepareHumanoidData } from "./humanoid-common.js";

/**
 * Prepare Character type specific data.
 * @param {Object} actorContext
 * @param {Object} actorData
 */
export function prepareCharacterData(actorContext, actorData) {
  prepareHumanoidData(actorContext, actorData, {
    isNPC: false,
    useDwemerSphereSpeedOverride: false,
    useActorSkillModifierCalc: false,
    applyFormShiftSkillBuffs: true,
    cripplingSpeedPenalty: 0,
  });
}
