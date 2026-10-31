import { ApplyDamageService } from "./apply-damage-service.js";
import { resumeDamageAftermath } from "../../core/combat/damage/deferred-operations.js";

/** Domain adapters retain the existing rules; this dispatcher adds no mechanics. */
export async function executeAdditionalChatOutcome(outcome, context) {
  const payload = outcome.payload ?? {};
  if (outcome.adapter === "resource.delta") {
    return context.stage("resource", async () => {
      const { adjustCurrentResource } = await import("../../core/system/resource-updates.js");
      const result = await adjustCurrentResource(context.actor, payload.resource, Number(payload.amount ?? 0));
      if (!result) throw new Error("The resolved resource change was not confirmed.");
      return { ok: true, resourceChanges: [{ actorUuid: context.actor.uuid, resource: payload.resource, ...result }] };
    });
  }
  if (outcome.adapter === "resource.fatigue") {
    return context.stage("fatigue", async () => {
      const { restoreStaminaOrRemoveFatigue } = await import("../../core/magic/services/resource-restoration-service.js");
      const lines = [];
      const applied = await restoreStaminaOrRemoveFatigue(context.actor, { removeFatigueLevels: 1, fallbackToStamina: false, lines });
      if (!applied) throw Object.assign(new Error("The actor is no longer fatigued. Review the Adrenaline Rush use before resolving it manually."), { committed: false });
      return { ok: true, message: lines.join("; ") };
    });
  }
  if (outcome.adapter === "healing" || outcome.adapter === "damage.resolved") {
    const result = await context.stage("health", async () => {
      if (outcome.adapter === "healing" && Number(payload.amount ?? 0) <= 0) return { ok: true, healing: 0 };
      const result = outcome.adapter === "healing"
        ? await ApplyDamageService.applyHealingResult(context.actor, Number(payload.amount ?? 0), { ...payload, receiptId: context.receiptId, outcomeContext: context })
        : await ApplyDamageService.applySimpleResult(context.actor, Number(payload.amount ?? 0), payload.damageType ?? "physical", { ...payload, receiptId: context.receiptId, outcomeContext: context });
      if (!result.value && !result.actionResult.ok) throw Object.assign(new Error("The resolved health result was not confirmed."), {
        actionResult: result.actionResult, ...(result.actionResult.commitment === "none" ? { committed: false } : {}) });
      return result.value ?? { ok: true, skipped: true, execution: { committed: false }, healing: 0 };
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
    "fear.warCry": () => import("../../core/fear/war-cry.js"),
  };
  const module = await modules[outcome.adapter]?.();
  if (!module?.executeChatOutcome) throw Object.assign(new Error("The outcome executor is unavailable."), { committed: false });
  return module.executeChatOutcome(outcome, context);
}
