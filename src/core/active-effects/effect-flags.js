import { FLAG_SCOPE } from "../system/namespace.js";

export const SYSTEM_EFFECT_FLAG_SCOPE = FLAG_SCOPE;

export const SYSTEM_EFFECT_FLAG_KEYS = Object.freeze({
  ae: "ae",
  spellEffect: "spellEffect",
  spellEffectMetadata: "spellEffectMetadata",
  spellUuid: "spellUuid",
  spellName: "spellName",
  spellSchool: "spellSchool",
  spellLevel: "spellLevel",
  baseLevel: "baseLevel",
  castLevel: "castLevel",
  hasHigherCastLevel: "hasHigherCastLevel",
  spellStrengthValue: "spellStrengthValue",
  casterUuid: "casterUuid",
  casterTokenUuid: "casterTokenUuid",
  actualCost: "actualCost",
  costPaid: "costPaid",
  originalCastWorldTime: "originalCastWorldTime",
  durationSeconds: "durationSeconds",
  durationRounds: "durationRounds",
  durationStartTime: "durationStartTime",
  durationStartRound: "durationStartRound",
  durationStartTurn: "durationStartTurn",
  targetUuids: "targetUuids",
  upkeepGroupKey: "upkeepGroupKey",
  hasUpkeep: "hasUpkeep",
  upkeepAwaiting: "upkeepAwaiting",
  upkeepCost: "upkeepCost",
  isOriginAE: "isOriginAE",
  originAEUuid: "originAEUuid",
  originAEId: "originAEId",
  expirationAnchor: "expirationAnchor",
  condition: "condition",
  conditions: "conditions",
  overTime: "OverTime",
  overTimeState: "overTimeState",
});

export function systemEffectFlagPath(key) {
  return `flags.${SYSTEM_EFFECT_FLAG_SCOPE}.${key}`;
}

export const SYSTEM_EFFECT_FLAG_PATHS = Object.freeze(
  Object.fromEntries(
    Object.entries(SYSTEM_EFFECT_FLAG_KEYS).map(([name, key]) => [name, systemEffectFlagPath(key)])
  )
);
