import { applyDamage, applyHealing, DAMAGE_TYPES } from "../../core/combat/damage-automation.js";
import { applyDamageResolved } from "../../core/combat/damage-resolver.js";
import { applyHybridDamageToWarfareUnit, isWarfareActor } from "../../core/combat/opposed/hybrid.js";
import { resolveActorDocument } from "../foundry/adapters.js";
import { requireMassCombatEnabled } from "../../core/homebrew/settings.js";

async function resolveTargetActor(targetActorOrUuid) {
  const actor = await resolveActorDocument(targetActorOrUuid);
  if (actor?.documentName === "Actor") return actor;
  throw new Error("Invalid target actor for damage application.");
}

export const ApplyDamageService = {
  async applySimple(targetActorOrUuid, damage, damageType = DAMAGE_TYPES.PHYSICAL, options = {}) {
    const actor = await resolveTargetActor(targetActorOrUuid);
    if (isWarfareActor(actor) && !requireMassCombatEnabled()) return null;
    return applyDamage(actor, damage, damageType, options);
  },

  async applyResolved(targetActorOrUuid, payload = {}) {
    const actor = await resolveTargetActor(targetActorOrUuid);
    if (isWarfareActor(actor) && !requireMassCombatEnabled()) return null;
    return applyDamageResolved(actor, payload);
  },

  async applyHealing(targetActorOrUuid, amount, options = {}) {
    const actor = await resolveTargetActor(targetActorOrUuid);
    if (isWarfareActor(actor) && !requireMassCombatEnabled()) return null;
    return applyHealing(actor, amount, options);
  },

  async applyChatCard({
    targetActor,
    rawDamage = 0,
    damageType = DAMAGE_TYPES.PHYSICAL,
    magicSource = false,
    targetDomain = "",
    ...payload
  } = {}) {
    const actor = await resolveTargetActor(targetActor);
    const warfareTarget = String(targetDomain ?? "").trim().toLowerCase() === "warfare" || isWarfareActor(actor);

    if (warfareTarget) {
      if (!requireMassCombatEnabled()) return null;
      return applyHybridDamageToWarfareUnit(actor, {
        rawDamage,
        damageType,
        magicSource,
      });
    }

    return applyDamageResolved(actor, {
      rawDamage,
      damageType,
      magicSource,
      ...payload,
    });
  },
};
