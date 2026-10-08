import { getMagicSubRollMode } from "../settings.js";
import { emitSuppressedOpposedSubRollDice } from "./spell-helpers.js";

export async function postMagicOpposedSubRoll({
  roll,
  actor = null,
  flavor = "",
  parentMessageId = null,
  stage = "",
  defenderIndex = null,
}) {
  if (!roll) return;

  void flavor;
  void stage;
  void defenderIndex;
  emitSuppressedOpposedSubRollDice(roll, { rollMode: getMagicSubRollMode(), actor, parentMessageId, user: game.user });
}
