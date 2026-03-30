import { registerOnce } from "../_internal/hook-registry.js";

function clearActorAECache(actor) {
  if (!actor || actor.documentName !== "Actor") return;
  if (Object.prototype.hasOwnProperty.call(actor, "_aeApplicableCache")) actor._aeApplicableCache = null;
  if (Object.prototype.hasOwnProperty.call(actor, "_aeTotalsMap")) actor._aeTotalsMap = null;
}

function invalidateAECacheFromEffect(effect) {
  const parent = effect?.parent;
  if (!parent) return;
  if (parent.documentName === "Actor") {
    clearActorAECache(parent);
    return;
  }
  if (parent.documentName === "Item") {
    const actorParent = parent.parent;
    if (actorParent?.documentName === "Actor") clearActorAECache(actorParent);
  }
}

export function registerAECacheInvalidation() {
  registerOnce("hooks:ae-cache-invalidation", () => {
    Hooks.on("createActiveEffect", (effect) => invalidateAECacheFromEffect(effect));
    Hooks.on("updateActiveEffect", (effect) => invalidateAECacheFromEffect(effect));
    Hooks.on("deleteActiveEffect", (effect) => invalidateAECacheFromEffect(effect));
    Hooks.on("updateActor", (actor, changed) => {
      if (!actor || actor.documentName !== "Actor") return;
      const touchedEquippedWeapons = Boolean(changed?.system?.equippedWeapons)
        || foundry.utils.hasProperty(changed, "system.equippedWeapons");
      if (!touchedEquippedWeapons) return;
      clearActorAECache(actor);
    });
  });
}
