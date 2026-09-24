import { emitDynamicInitiativeRoundSummary } from "./initiative-ui.js";
import { getActionPointAutomationSetting, isDynamicInitiativeEnabledSetting } from "./settings.js";
import { isPerfEnabled, perfRecord } from "../../../utils/perf-tracker.js";
import { isActiveGMUser } from "../../../utils/users.js";

let _combatApHooksRegistered = false;

export function registerCombatApHooks(SystemCombatClass) {
  if (_combatApHooksRegistered) return;
  _combatApHooksRegistered = true;

  Hooks.on("combatStart", async (combat) => {
    if (!isActiveGMUser(game.user)) return;
    if (!["round", "turn"].includes(getActionPointAutomationSetting())) return;
    const round = Number(combat?.round ?? 1) || 1;
    if ((SystemCombatClass._apLastProcessedRound.get(combat.id) ?? -1) >= round) return;
    SystemCombatClass._apLastProcessedRound.set(combat.id, round);
    try {
      await combat.resetAllActionPoints?.();
    } catch (error) {
      console.warn("UESRPG | AP combat-start restore failed", error);
    }
  });

  Hooks.on("updateCombat", (combat, changed, _options, _userId) => {
    if (!isActiveGMUser(game.user)) return;
    if (!("round" in changed)) return;
    if (getActionPointAutomationSetting() !== "round") return;

    const newRound = Number(combat.round ?? 0);
    const lastRound = SystemCombatClass._apLastProcessedRound.get(combat.id) ?? -1;
    if (newRound <= lastRound) return;

    SystemCombatClass._apLastProcessedRound.set(combat.id, newRound);
    combat.resetAllActionPoints?.().catch(err =>
      console.warn("UESRPG | AP round-restore hook failed", err)
    );
  });

  Hooks.on("combatTurnChange", async (combat, _prior, current) => {
    if (!isActiveGMUser(game.user)) return;
    if (getActionPointAutomationSetting() !== "turn") return;
    const round = Number(current?.round ?? combat?.round ?? 0);
    if (round <= 1) return;
    const combatantId = String(current?.combatantId ?? combat?.combatant?.id ?? "");
    const actor = combatantId ? combat?.combatants?.get?.(combatantId)?.actor : combat?.combatant?.actor;
    if (!actor) return;
    try {
      await combat._refreshActionPoints?.(actor);
    } catch (error) {
      console.warn("UESRPG | AP turn-restore hook failed", error);
    }
  });

  Hooks.on("deleteCombat", (combat) => {
    SystemCombatClass._apLastProcessedRound.delete(String(combat.id ?? ""));
  });

  Hooks.on("uesrpg.combatTimeChanged", (payload) => {
    if (!isActiveGMUser(game.user)) return;
    if (payload?.source !== "combat") return;
    if (payload?.combat?.phase && payload.combat.phase !== "post") return;

    const combat = game?.combat ?? null;
    if (!combat?.id) return;
    if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

    const round = Number(payload?.combat?.round ?? combat.round ?? 0);
    const boundaryKey = `${String(combat.id)}:${round}`;
    const expectedFirstCombatantId = String(SystemCombatClass._dynamicInitiativeExpectedFirstByBoundary.get(boundaryKey) ?? "");
    if (!expectedFirstCombatantId) return;
    const pendingSummary = SystemCombatClass._dynamicInitiativePendingSummaryByBoundary.get(boundaryKey) ?? null;

    const committedCombatantId = String(combat.combatant?.id ?? combat.combatantId ?? "");
    const match = committedCombatantId === expectedFirstCombatantId;

    if (isPerfEnabled()) {
      perfRecord({
        event: "dynamicInitiative.commitObserved",
        combatId: combat.id,
        round,
        enabled: isDynamicInitiativeEnabledSetting(),
        expectedFirstCombatantId,
        committedFirstCombatantId: committedCombatantId || null,
        match,
      });
    }

    if (pendingSummary) {
      emitDynamicInitiativeRoundSummary(pendingSummary, {
        combatId: combat.id,
        round,
      }).catch((err) => console.warn("UESRPG | Dynamic initiative summary chat failed", err));
    }

    SystemCombatClass._dynamicInitiativeExpectedFirstByBoundary.delete(boundaryKey);
    SystemCombatClass._dynamicInitiativePendingSummaryByBoundary.delete(boundaryKey);
  });
}
