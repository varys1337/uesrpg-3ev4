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
import { registerEffectDrops } from "./register-effect-drops.js";
import { registerXpPurchaseService } from "../../core/advancement/purchase-service.js";
import { buildXpPurchasePlan } from "../../core/advancement/purchase-plans.js";
import { buildRacialGrantPurchasePlan } from "../../ui/apps/v2/char-gen/racial-grants.js";

export function registerCoreSubsystems() {
  registerOnce("hooks:core-subsystems", () => {
    registerXpPurchaseService((actor, intent, context) => ["racialGrant", "racialRefund"].includes(intent.workflow)
      ? buildRacialGrantPurchasePlan(actor, intent, context) : buildXpPurchasePlan(actor, intent, context));
    registerConditions();
    registerEngagementFlanking();
    registerWounds();
    registerSurpriseHooks();
    registerFearSystem();
    registerWarfareEncounterHooks();
    registerWarfareBattlefieldHooks();
    registerWarfareCampaignHooks();
    registerGenericAELifecycleHooks();
    registerEffectDrops();

    try {
      registerFrenzied();
    } catch (err) {
      console.warn("UESRPG | Failed to register Frenzied automation", err);
    }
  });
}
