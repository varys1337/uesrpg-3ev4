import { computeEffectiveStrength, getAlchemySkill, getAlchemySkillSnapshot } from "./workflow-actor.js";
import { getAlchemyFlags } from "./shared.js";
import {
  getAlchemyInventoryState,
  getFilledAlchemySlots,
  getUniquenessIdentifier,
  resolveAlchemyEffectDescriptor,
} from "./workflow-descriptors.js";

export function computeBrewModifiers(actor, recipe, opts = {}) {
  const { nothingVentured = false, trialAndErrorBonus = 0, skill: precomputedSkill } = opts;
  const { tn, rank: alchemyRank } = getAlchemySkillSnapshot(actor, { skill: precomputedSkill });

  const breakdown = [];
  let totalMod = 0;

  if (nothingVentured) {
    breakdown.push({ label: "Nothing Ventured, Nothing Gained", value: +20 });
    totalMod += 20;
  }

  if (trialAndErrorBonus > 0) {
    breakdown.push({ label: "Trial and Error (repeated recipe)", value: trialAndErrorBonus });
    totalMod += trialAndErrorBonus;
  }

  if (recipe.mode === "potion" || recipe.mode === "toxin") {
    const effects = getFilledAlchemySlots(recipe);
    const highestSL = Math.max(0, ...effects.map((effect) => Number(effect.spellLevel ?? 1)));
    const slOverage = Math.max(0, highestSL - alchemyRank);
    if (slOverage > 0) {
      breakdown.push({ label: `SL ${highestSL} exceeds Alchemy rank ${alchemyRank}`, value: -10 * slOverage });
      totalMod -= 10 * slOverage;
    }

    if (effects.length > 1) {
      breakdown.push({ label: "Multiple effects (>1)", value: -10 });
      totalMod -= 10;
    }

    const brewTime = effects.reduce((sum, effect) => sum + Number(effect.spellLevel ?? 1), 0);
    return { tn, alchemyRank, penaltyBreakdown: breakdown, totalMod, brewTime };
  }

  if (recipe.mode === "poison") {
    const poisonLevel = Number(recipe.poisonLevel ?? 1);
    const poisonOverage = Math.max(0, poisonLevel - alchemyRank);
    if (poisonOverage > 0) {
      breakdown.push({ label: `Poison level ${poisonLevel} exceeds Alchemy rank ${alchemyRank}`, value: -10 * poisonOverage });
      totalMod -= 10 * poisonOverage;
    }
    return { tn, alchemyRank, penaltyBreakdown: breakdown, totalMod, brewTime: 1 };
  }

  return { tn, alchemyRank, penaltyBreakdown: breakdown, totalMod, brewTime: 0 };
}

export function validateBrewRecipe(actor, recipe) {
  const errors = [];
  const inventory = getAlchemyInventoryState(actor);
  const alchemySkill = getAlchemySkill(actor);
  const alchemySnapshot = getAlchemySkillSnapshot(actor, { skill: alchemySkill });

  if (!alchemySnapshot.found) {
    errors.push("Actor has no valid Alchemy skill entry.");
  }

  if (!inventory.toolsPresent) {
    errors.push("No Alchemical Tools found in inventory (required by RAW).");
  }

  if (recipe.mode === "potion" || recipe.mode === "toxin") {
    const filledSlots = getFilledAlchemySlots(recipe);
    if (!filledSlots.length) {
      errors.push("No ingredients or effects selected.");
      return { ok: false, errors, warnings: [] };
    }

    const uniqueness = [];
    for (const slot of filledSlots) {
      const ingredient = actor?.items?.get(slot.ingredientId);
      if (!ingredient) {
        errors.push(`Ingredient not found in inventory (${slot.ingredientId}).`);
        continue;
      }

      const ingredientData = getAlchemyFlags(ingredient);
      const effect = resolveAlchemyEffectDescriptor(actor, slot, { ingredient, mode: recipe.mode });
      if (!effect) {
        errors.push(slot.effectSource === "spell"
          ? `Spell effect could not be resolved (${slot.spellUuid}).`
          : `Unknown effect: ${slot.effectKey}.`);
        continue;
      }
      if (effect.compatible === false || !effect.directPayload) {
        errors.push(effect.invalidReason || `Effect "${effect.effectLabel}" is not compatible with direct ${recipe.mode} resolution.`);
        continue;
      }

      const depth = Number(ingredientData.depthBase ?? 0);
      const effectiveStrength = computeEffectiveStrength(ingredient, actor);
      const sl = Number(effect.spellLevel ?? 1);

      if (effect.school !== String(ingredientData.school ?? "").toLowerCase()) {
        errors.push(`Effect "${effect.effectLabel}" (${effect.school}) does not match ingredient school "${ingredientData.school}".`);
      }

      if (sl > depth) {
        errors.push(`Effect "${effect.effectLabel}" SL ${sl} exceeds ingredient depth ${depth}.`);
      }

      if (effect.cost > effectiveStrength) {
        errors.push(`Effect "${effect.effectLabel}" cost ${effect.cost} exceeds ingredient effective strength ${effectiveStrength}.`);
      }

      if (Array.isArray(effect.levelOptions) && effect.levelOptions.length && !effect.levelOptions.includes(sl)) {
        errors.push(`Effect "${effect.effectLabel}" does not define SL ${sl}. Allowed levels: ${effect.levelOptions.join(", ")}.`);
      } else if (sl < effect.slMin || sl > effect.slMax) {
        errors.push(`Effect "${effect.effectLabel}" SL ${sl} is outside allowed range [${effect.slMin}-${effect.slMax}].`);
      }

      uniqueness.push(getUniquenessIdentifier(slot));
    }

    if (new Set(uniqueness).size < uniqueness.length) {
      errors.push("Each effect may only be selected once per brew.");
    }
  }

  if (recipe.mode === "poison") {
    const ingredient = actor?.items?.get(recipe.ingredientId);
    if (!ingredient) {
      errors.push("No destruction ingredient selected.");
    } else {
      const algData = getAlchemyFlags(ingredient);
      if (String(algData.school ?? "").toLowerCase() !== "destruction") {
        errors.push("Poison brewing requires a Destruction ingredient.");
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings: [] };
}
