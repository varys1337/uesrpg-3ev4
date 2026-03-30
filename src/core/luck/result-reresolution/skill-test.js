import { requestUpdateChatMessage } from "../../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../../constants.js";

export async function applyLuckSkillTestMutation(message, newResult, extraContext = {}) {
  const update = {
    [`flags.${SYSTEM_ID}.skillTest.isSuccess`]: newResult.isSuccess,
    [`flags.${SYSTEM_ID}.skillTest.degree`]: newResult.degree,
    [`flags.${SYSTEM_ID}.skillTest.textual`]: newResult.textual ?? `${newResult.degree} ${newResult.isSuccess ? "DoS" : "DoF"}`,
  };
  if (extraContext.luckUsed !== undefined) update[`flags.${SYSTEM_ID}.luckUsedOnTest`] = Boolean(extraContext.luckUsed);
  if (extraContext.luckBurned !== undefined) update[`flags.${SYSTEM_ID}.luckBurned`] = Boolean(extraContext.luckBurned);
  if (extraContext.rerollUsed !== undefined) update[`flags.${SYSTEM_ID}.reroll.used`] = Boolean(extraContext.rerollUsed);
  if (extraContext.rerollSource !== undefined) update[`flags.${SYSTEM_ID}.reroll.source`] = String(extraContext.rerollSource);
  return requestUpdateChatMessage(message, update);
}
