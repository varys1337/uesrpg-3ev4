import { requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { isActiveGMUser } from "../wounds/wound-schema.js";
import { registerCombatBoundaryConsumer } from "../time/combat-boundary-orchestrator.js";
import { expireStartOfTurnFearEffects, fearLane, getFearEffects, pruneFearSnapPromptDedupe } from "./effects-and-restrictions.js";
import { maybePromptSnapOutOnTurnStart, settleSnapOutAtTurnEnd } from "./snap-out.js";

let fearRegistered = false;

export async function handleCombatBoundaryFear(payload) {
  try {
    if (!isActiveGMUser(game.user)) return;
    if (payload?.source !== "combat") return;
    if (payload?.combat?.phase && payload.combat.phase !== "post") return;

    const combat = game.combat ?? null;
    if (!combat?.id) return;
    if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

    const prior = payload?.combat?.prior;
    const current = payload?.combat?.current;
    if (!prior || !current || prior.round == null || prior.turn == null || current.round == null || current.turn == null) return;
    const priorRound = Number(prior.round);
    const priorTurn = Number(prior.turn);
    const currentRound = Number(current.round);
    const currentTurn = Number(current.turn);
    if (![priorRound, priorTurn, currentRound, currentTurn].every(Number.isInteger)) return;
    // Do not settle a rewind or a stale boundary after the encounter moved on.
    const advanced = currentRound > priorRound || (currentRound === priorRound && currentTurn > priorTurn);
    const isCurrent = () => game.combat?.id === combat.id && Number(combat.round) === currentRound
      && Number(combat.turn) === currentTurn && String(combat.combatant?.id ?? "") === String(current.combatantId ?? "");
    if (!advanced || !isCurrent()) return;

    const previousActor = combat.combatants?.get?.(String(prior.combatantId ?? ""))?.actor ?? null;
    if (previousActor) await settleSnapOutAtTurnEnd(previousActor, { combat, prior });
    if (!isCurrent()) return;
    await expireStartOfTurnFearEffects(combat);
    // Fixed-round Horror outcomes are still tracked by the GM: counting round
    // boundaries can expire a newly applied effect before a full round passes.
    if (isCurrent()) await maybePromptSnapOutOnTurnStart(combat);
  } catch (err) {
    console.warn("UESRPG | Fear turn hook failed", err);
  }
}

export function registerFearSystemHooks() {
  if (fearRegistered) return;
  fearRegistered = true;

  registerCombatBoundaryConsumer({
    id: "fear",
    order: 225,
    handle: handleCombatBoundaryFear,
  });

  

  Hooks.on("deleteCombat", async (combat) => {
    try {
      if (!isActiveGMUser(game.user)) return;
      pruneFearSnapPromptDedupe({ combatId: String(combat?.id ?? "") });
      const combatants = Array.isArray(combat?.combatants) ? combat.combatants : Array.from(combat?.combatants ?? []);
      for (const combatant of combatants) {
        const actor = combatant?.actor ?? null;
        if (!actor) continue;
        const scoped = getFearEffects(actor).filter((effect) => fearLane(effect)?.encounterScoped !== false);
        if (!scoped.length) continue;
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", scoped.map((effect) => effect.id));
      }
    } catch (err) {
      console.warn("UESRPG | Fear cleanup hook failed", err);
    }
  });
}
