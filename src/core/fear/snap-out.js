import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import {
  applyEncounterPenaltyAfterSnapOut,
  combatTurnPromptKey,
  escapeFearHtml,
  fearLane,
  getFearEffects,
  hasFearSnapPromptSeen,
  markFearSnapPromptSeen,
  postFearMessage,
  wpTN,
} from "./effects-and-restrictions.js";

export async function attemptSnapOut(actor, { combat = game.combat } = {}) {
  if (!actor || !combat?.id) return { attempted: false, success: false };
  const effects = getFearEffects(actor).filter((effect) => fearLane(effect)?.snapOut === true);
  if (!effects.length) return { attempted: false, success: false };

  const tn = wpTN(actor, 0);
  const res = await doTestRoll(actor, { target: tn, rollFormula: "1d100", allowLucky: true, allowUnlucky: true });

  try {
    await res?.roll?.toMessage?.({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} - Snap Out (Willpower ${tn})`,
      rollMode: getCoreRollMode(),
    });
  } catch (_err) {}

  if (!res?.isSuccess) {
    await postFearMessage(actor, "Fear", `<p><b>${escapeFearHtml(actor.name)}</b> fails to snap out of fear.</p>`);
    return { attempted: true, success: false };
  }

  const penalties = effects.map((effect) => Number(fearLane(effect)?.applyAfterSnapPenalty ?? 0) || 0);
  const lingeringPenalty = Math.min(0, ...penalties, 0);
  await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", effects.map((effect) => effect.id));
  await applyEncounterPenaltyAfterSnapOut(actor, lingeringPenalty);
  await postFearMessage(actor, "Fear", `<p><b>${escapeFearHtml(actor.name)}</b> snaps out of fear.</p>`);
  return { attempted: true, success: true };
}

export async function maybePromptSnapOutOnTurnStart(combat) {
  if (!combat?.started) return;
  const combatant = combat?.combatant ?? null;
  const actor = combatant?.actor ?? null;
  if (!actor) return;
  const hasSnapOut = getFearEffects(actor).some((effect) => fearLane(effect)?.snapOut === true);
  if (!hasSnapOut) return;

  const key = combatTurnPromptKey(combat, actor.id);
  if (hasFearSnapPromptSeen(key)) return;
  markFearSnapPromptSeen(key);
  await attemptSnapOut(actor, { combat });
}
