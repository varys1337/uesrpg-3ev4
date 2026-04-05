import { requestUpdateChatMessage } from "../../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../../constants.js";
import { getFlagValueWithFallback } from "../../system/flags.js";

export async function applyLuckSkillTestMutation(message, newResult, extraContext = {}) {
  const currentSkillTest = getFlagValueWithFallback(message, "skillTest");
  const currentReroll = getFlagValueWithFallback(message, "reroll");
  const updateFlags = {
    ...((message?.flags?.[SYSTEM_ID] && typeof message.flags[SYSTEM_ID] === "object") ? message.flags[SYSTEM_ID] : {}),
    skillTest: {
      ...((currentSkillTest && typeof currentSkillTest === "object") ? currentSkillTest : {}),
      isSuccess: newResult.isSuccess,
      degree: newResult.degree,
      textual: newResult.textual ?? `${newResult.degree} ${newResult.isSuccess ? "DoS" : "DoF"}`,
    },
  };
  if (extraContext.luckUsed !== undefined) updateFlags.luckUsedOnTest = Boolean(extraContext.luckUsed);
  if (extraContext.luckBurned !== undefined) updateFlags.luckBurned = Boolean(extraContext.luckBurned);
  if (
    (currentReroll && typeof currentReroll === "object")
    || extraContext.rerollUsed !== undefined
    || extraContext.rerollSource !== undefined
  ) {
    updateFlags.reroll = {
      ...((currentReroll && typeof currentReroll === "object") ? currentReroll : {}),
      ...(extraContext.rerollUsed !== undefined ? { used: Boolean(extraContext.rerollUsed) } : {}),
      ...(extraContext.rerollSource !== undefined ? { source: String(extraContext.rerollSource) } : {}),
    };
  }
  return requestUpdateChatMessage(message, { flags: { [SYSTEM_ID]: updateFlags } });
}
