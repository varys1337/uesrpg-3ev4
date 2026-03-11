/**
 * src/core/conditions/index.js
 *
 * Stage-06: registers conditionsHudUpgradeV2Done world setting so the ready-hook
 * upgrade sweep in status-hud.js runs only once per world.
 */

import { registerConditionHooks, ConditionsAPI, auditConditionRegistry } from "./condition-engine.js";
export { CONDITION_KEYS } from "./condition-engine.js";
import { registerConditionTurnTicker } from "./turn-ticker.js";
import { initializeRoundStartCandidateRegistry } from "./round-start-candidate-registry.js";
import { registerSystemStatusEffects, registerStatusHudInterop } from "./status-hud.js";
import { isAnyDebugEnabled } from "../../utils/debug.js";
import { getSystemId } from "./constants.js";

let _conditionsRegistered = false;

export function registerConditions() {
  if (_conditionsRegistered) return;
  _conditionsRegistered = true;

  // Hidden rollback/internal flag: gates the one-time Token HUD status-effect upgrade sweep.
  // Must be registered before ready so game.settings.get/set works in the ready hook.
  try {
    game.settings.register(getSystemId(), "conditionsHudUpgradeV2Done", {
      name: "Conditions HUD Upgrade v2 Done",
      scope: "world",
      config: false,
      type: Boolean,
      default: false
    });
  } catch (_e) {
    // Already registered (safe no-op if registerConditions is called more than once).
  }

  // Token HUD: expose system conditions as status effects and route interactions through the
  // deterministic condition engine.
  // Apply early.
  registerSystemStatusEffects();
  registerStatusHudInterop();

  // Re-assert after other packages/modules have had an opportunity to mutate CONFIG.statusEffects.
  Hooks.once("setup", () => registerSystemStatusEffects());
  Hooks.once("ready", () => {
    registerSystemStatusEffects();

    // Stability-only audit (no data mutation). Useful to catch duplicates, missing icons, or leaked core statuses.
    let log = false;
    try {
      log = isAnyDebugEnabled(["opposedDebug", "skillRollDebug", "debugSkillTN"]);
    } catch (_e) {
      log = false;
    }

    const audit = auditConditionRegistry();
    if (log && Array.isArray(audit?.warnings) && audit.warnings.length) {
      try {
        console.warn("UESRPG | Condition registry audit warnings", audit.warnings);
      } catch (_e) {}
    }

  });

  registerConditionHooks();
  initializeRoundStartCandidateRegistry();
  registerConditionTurnTicker();

  game.uesrpg = game.uesrpg || {};
  game.uesrpg.conditions = { ...ConditionsAPI };
}
