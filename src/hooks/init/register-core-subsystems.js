import { registerConditions } from "../../core/conditions/index.js";
import { registerWounds } from "../../core/wounds/index.js";
import { registerFrenzied, FrenziedAPI } from "../../core/conditions/frenzied.js";
import { registerFearSystem } from "../../core/fear/index.js";
import { registerSurpriseHooks } from "../../core/combat/surprise-state.js";
import { registerEngagementFlanking } from "../../core/homebrew/engagement-flanking/index.js";
import { registerOnce } from "../_internal/hook-registry.js";

export function registerCoreSubsystems() {
  registerOnce("hooks:core-subsystems", () => {
    registerConditions();
    registerEngagementFlanking();
    registerWounds();
    registerSurpriseHooks();
    registerFearSystem();

    try {
      registerFrenzied();
      game.uesrpg = game.uesrpg ?? {};
      game.uesrpg.conditions = game.uesrpg.conditions ?? {};
      game.uesrpg.conditions.frenzied = FrenziedAPI;
    } catch (err) {
      console.warn("UESRPG | Failed to register Frenzied automation", err);
    }
  });
}
