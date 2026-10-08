import { ApplyDamageService } from "./apply-damage-service.js";
import { resumeDamageAftermath } from "../../core/combat/damage/deferred-operations.js";

/** Domain adapters retain the existing rules; this dispatcher adds no mechanics. */
export async function executeAdditionalChatOutcome(outcome, context) {
  const payload = outcome.payload ?? {};
  if (outcome.adapter === "resource.delta") {
    return context.stage("resource", async () => {
      const { adjustCurrentResource } = await import("../../core/system/resource-updates.js");
      const result = await adjustCurrentResource(context.actor, payload.resource, Number(payload.amount ?? 0));
      if (!result) throw Object.assign(new Error("The resolved resource change was not applied."), { committed: false });
      return { ok: true, resourceChanges: [{ actorUuid: context.actor.uuid, resource: payload.resource, ...result }] };
    });
  }
  if (outcome.adapter === "healing" || outcome.adapter === "damage.resolved") {
    const result = await context.stage("health", async () => {
      if (outcome.adapter === "healing" && Number(payload.amount ?? 0) <= 0) return { ok: true, healing: 0 };
      const result = outcome.adapter === "healing"
        ? await ApplyDamageService.applyHealing(context.actor, Number(payload.amount ?? 0), { ...payload, receiptId: context.receiptId, outcomeContext: context })
        : await ApplyDamageService.applySimple(context.actor, Number(payload.amount ?? 0), payload.damageType ?? "physical", { ...payload, receiptId: context.receiptId, outcomeContext: context });
      if (!result) throw Object.assign(new Error("The resolved health result could not be applied."), { committed: false });
      return result;
    });
    return resumeDamageAftermath(result, context);
  }
  const modules = {
    "combat.coup": () => import("../../core/combat/opposed/actions/damage.js"),
    "combat.special": () => import("../../core/combat/special-actions-helper.js"),
    "alchemy.potion": () => import("../../core/alchemy/runtime.js"),
    "alchemy.spell": () => import("../../core/alchemy/runtime.js"),
    "alchemy.poison": () => import("../../core/alchemy/runtime.js"),
    "alchemy.toxin": () => import("../../core/alchemy/runtime.js"),
    "ability.effects": () => import("../../core/system/activation/feature-effects.js"),
    "ability.status": () => import("../../core/system/activation/feature-effects.js"),
    "magic.consequences": () => import("../../core/magic/characteristic-defense-service.js"),
    "magic.spell": () => import("../../core/magic/effects/spell-effects.js"),
    "magic.origin": () => import("../../core/magic/effects/origin-effect.js"),
    "warfare.clash": () => import("../../core/mass-warfare/clash/engine.js"),
  };
  const module = await modules[outcome.adapter]?.();
  if (!module?.executeChatOutcome) throw Object.assign(new Error("The outcome executor is unavailable."), { committed: false });
  return module.executeChatOutcome(outcome, context);
}
