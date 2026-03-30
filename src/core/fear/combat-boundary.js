import { requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { isActiveGMUser } from "../wounds/wound-schema.js";
import { registerCombatBoundaryConsumer, noteCombatBoundaryLegacyFallbackSkip } from "../time/combat-boundary-orchestrator.js";
import { expireStartOfTurnFearEffects, fearLane, getFearEffects, pruneFearSnapPromptDedupe, tickFixedRoundFearEffects } from "./effects-and-restrictions.js";
import { maybePromptSnapOutOnTurnStart } from "./snap-out.js";

let fearRegistered = false;

export async function handleCombatBoundaryFear(payload) {
  try {
    if (!isActiveGMUser(game.user)) return;
    if (payload?.source !== "combat") return;
    if (payload?.combat?.phase && payload.combat.phase !== "post") return;

    const combat = game.combat ?? null;
    if (!combat?.id) return;
    if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

    const changed = payload?.changed ?? {};
    const changedTurn = Object.prototype.hasOwnProperty.call(changed, "turn") || Object.prototype.hasOwnProperty.call(changed, "round");
    if (!changedTurn) return;

    await expireStartOfTurnFearEffects(combat);
    await tickFixedRoundFearEffects(combat, changed);
    await maybePromptSnapOutOnTurnStart(combat);
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

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    if (noteCombatBoundaryLegacyFallbackSkip("fear", payload)) return;
    await handleCombatBoundaryFear(payload);
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
