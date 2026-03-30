import { emitDynamicInitiativeRoundSummary } from "./initiative-ui.js";
import { getActionPointAutomationSetting, isDynamicInitiativeEnabledSetting } from "./settings.js";
import { isPerfEnabled, perfRecord } from "../../../utils/perf-tracker.js";

export function registerCombatApHooks(SystemCombatClass) {
  Hooks.on("updateCombat", (combat, changed, _options, _userId) => {
    if (!game.user?.isGM) return;
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

  Hooks.on("deleteCombat", (combat) => {
    SystemCombatClass._apLastProcessedRound.delete(String(combat.id ?? ""));
  });

  Hooks.on("uesrpg.combatTimeChanged", (payload) => {
    if (!game.user?.isGM) return;
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
