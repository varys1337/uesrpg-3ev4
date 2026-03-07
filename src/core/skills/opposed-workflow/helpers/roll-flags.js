/**
 * Shared roll-flag builder for skill opposed attacker/defender roll messages.
 */

import { _skillOpposedMetaFlag } from "../core/schema.js";

export function buildSkillOpposedRollFlags({
  side,
  messageId,
  request = null,
  laneData,
  decl,
  tn,
  res,
  actorUuid,
  skillLabel
} = {}) {
  const stage = (side === "attacker") ? "attacker-roll" : "defender-roll";
  const dosOverride = res?.uesrpgDosOverride ?? null;

  const skillTest = {
    actorUuid,
    skillUuid: decl?.skillUuid ?? laneData?.skillUuid ?? null,
    skillName: skillLabel,
    target: tn?.finalTN,
    rollFormula: "1d100",
    rollMode: game.settings.get("core", "rollMode"),
    useSpecialization: Boolean(decl?.useSpec),
    isInterrogationTest: Boolean(decl?.isInterrogationTest),
    isSuccess: Boolean(res?.isSuccess),
    degree: Number(res?.degree ?? 0) || 0,
    textual: String(res?.textual ?? "")
  };

  const talentChoices = {
    keenIntuitionChoice: res?.keenIntuitionChoice ?? null,
    hyperAwarenessChoice: res?.hyperAwarenessChoice ?? null
  };

  const commitPayload = (side === "attacker")
    ? { attacker: { talentChoices } }
    : {
      defender: {
        skillUuid: laneData?.skillUuid,
        skillLabel: laneData?.skillLabel,
        declared: laneData?.declared,
        tn,
        talentChoices
      }
    };

  const rollFlags = request ? {
    uesrpg: { rollRequest: request },
    "uesrpg-3ev4": {
      rollRequest: request,
      ..._skillOpposedMetaFlag(messageId, stage, { commit: commitPayload })
    }
  } : {
    "uesrpg-3ev4": {
      ..._skillOpposedMetaFlag(messageId, stage, { commit: commitPayload })
    }
  };

  rollFlags.uesrpg = {
    ...(rollFlags.uesrpg ?? {}),
    skillTest,
    ...(dosOverride ? { dosOverride } : {}),
    reroll: { used: false, source: null }
  };
  rollFlags["uesrpg-3ev4"] = {
    ...(rollFlags["uesrpg-3ev4"] ?? {}),
    skillTest,
    ...(dosOverride ? { dosOverride } : {})
  };

  if (decl?.histskinUnderwater === true) {
    rollFlags.uesrpg.rollOptions = { ...(rollFlags.uesrpg.rollOptions ?? {}), histskin: true };
    rollFlags["uesrpg-3ev4"].rollOptions = { ...(rollFlags["uesrpg-3ev4"].rollOptions ?? {}), histskin: true };
  }

  return rollFlags;
}

