import { getApplicableEffectsCached } from "./collect.js";
import { createEvaluationMemo, effectMatchesContext } from "./conditions.js";
import { isAddMode, isOverrideMode, toNumericEffectValue } from "./reducers.js";
import { getEffectChanges } from "../../utils/compat.js";
import { getActorTraitDamageProfile } from "../traits/trait-registry.js";
import { isLegacyWeaknessResistanceChange } from "./weakness-compat.js";
import { getFlagValueWithFallback } from "../system/flags.js";

const TYPES = Object.freeze({
  physical: "physicalR", fire: "fireR", frost: "frostR", shock: "shockR",
  poison: "poisonR", magic: "magicR", silver: "silverR", sunlight: "sunlightR", disease: "diseaseR"
});

/** Highest applicable weakness of one type; effects and trait Items do not stack. */
export function getActorDamageWeakness(actor, damageType, { attackerActor = null } = {}) {
  const type = String(damageType ?? "").trim().toLowerCase();
  const resistanceKey = TYPES[type];
  if (!actor || !resistanceKey) return 0;
  const profile = getActorTraitDamageProfile(actor);
  let highest = Math.max(0, Number(profile?.weakness?.[type]) || 0, Number(actor.system?.weakness?.[resistanceKey]) || 0);
  const context = { opposingActor: attackerActor, attackerActor };
  const memo = createEvaluationMemo();
  for (const effect of getApplicableEffectsCached(actor)) {
    if (!effectMatchesContext(effect, context, memo)) continue;
    const item = effect?.parent?.documentName === "Item" ? effect.parent : (effect?.item ?? null);
    for (const change of getEffectChanges(effect)) {
      if (!isAddMode(change) && !isOverrideMode(change)) continue;
      const isTyped = change.key === `system.traits.weakness.${type}` || change.key === `system.weakness.${resistanceKey}`;
      const isLegacy = isLegacyWeaknessResistanceChange(effect, change)
        && change.key === `system.modifiers.resistance.${resistanceKey}`;
      if (!isTyped && !isLegacy) continue;
      const value = toNumericEffectValue(change.value, { actor, item, effect });
      if (value === null) continue;
      highest = Math.max(highest, isLegacy ? -value : value);
    }
  }
  return highest;
}

/** Flag customized weakness spell resistance changes whose meaning cannot be inferred. */
export function hasAmbiguousWeaknessResistance(actor, damageType, { attackerActor = null } = {}) {
  const type = String(damageType ?? "").trim().toLowerCase();
  const resistanceKey = TYPES[type];
  if (!actor || !resistanceKey) return false;
  const context = { opposingActor: attackerActor, attackerActor };
  const memo = createEvaluationMemo();
  return getApplicableEffectsCached(actor).some(effect => {
    if (!String(getFlagValueWithFallback(effect, "spellEffectIdentity") ?? "").startsWith("weaknesstotype::")) return false;
    if (!effectMatchesContext(effect, context, memo)) return false;
    return getEffectChanges(effect).some(change => change.key === `system.modifiers.resistance.${resistanceKey}`
      && !isLegacyWeaknessResistanceChange(effect, change));
  });
}
