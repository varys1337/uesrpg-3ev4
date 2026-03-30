import { FLAG_SCOPE } from "../../system/namespace.js";
import { getMagicOpposedPostSubRollMessagesEnabled, getMagicSubRollMode } from "../settings.js";
import { emitSuppressedOpposedSubRollDice } from "./spell-helpers.js";

const _FLAG_NS = FLAG_SCOPE;

export async function postMagicOpposedSubRoll({
  roll,
  actor = null,
  flavor = "",
  parentMessageId = null,
  stage = "",
  defenderIndex = null,
}) {
  if (!roll) return;

  if (getMagicOpposedPostSubRollMessagesEnabled()) {
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor,
      flags: {
        [_FLAG_NS]: {
          magicOpposedMeta: {
            parentMessageId,
            stage,
            defenderIndex,
          },
        },
      },
    });
    return;
  }

  emitSuppressedOpposedSubRollDice(roll, { rollMode: getMagicSubRollMode() });
}
