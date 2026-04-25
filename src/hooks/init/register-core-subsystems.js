import { registerConditions } from "../../core/conditions/index.js";
import { registerWounds } from "../../core/wounds/index.js";
import { registerFrenzied } from "../../core/conditions/frenzied.js";
import { registerFearSystem } from "../../core/fear/index.js";
import { registerSurpriseHooks } from "../../core/combat/surprise-state.js";
import { registerEngagementFlanking } from "../../core/homebrew/engagement-flanking/index.js";
import { registerWarfareEncounterHooks } from "../../core/mass-warfare/encounter/hooks.js";
import { registerWarfareBattlefieldHooks } from "../../core/mass-warfare/battlefield/hooks.js";
import { registerWarfareCampaignHooks } from "../../core/mass-warfare/campaign/hooks.js";
import { registerOnce } from "../_internal/hook-registry.js";
import { registerGenericAELifecycleHooks } from "../../core/active-effects/lifecycle.js";

export function registerCoreSubsystems() {
  registerOnce("hooks:core-subsystems", () => {
    registerConditions();
    registerEngagementFlanking();
    registerWounds();
    registerSurpriseHooks();
    registerFearSystem();
    registerWarfareEncounterHooks();
    registerWarfareBattlefieldHooks();
    registerWarfareCampaignHooks();
    registerGenericAELifecycleHooks();

    try {
      registerFrenzied();
    } catch (err) {
      console.warn("UESRPG | Failed to register Frenzied automation", err);
    }
  });
}
