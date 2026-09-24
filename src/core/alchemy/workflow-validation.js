import { computeEffectiveStrength, getAlchemySkill, getAlchemySkillSnapshot } from "./workflow-actor.js";
import { resolveAlchemyIngredientData } from "./ingredients.js";
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
    breakdown.push({ code: "nothing-ventured", label: "Nothing Ventured, Nothing Gained", value: 20 });
    totalMod += 20;
  }
  if (trialAndErrorBonus > 0) {
    breakdown.push({ code: "trial-and-error", label: "Trial and Error (repeated recipe)", value: trialAndErrorBonus });
    totalMod += trialAndErrorBonus;
  }

  if (recipe.mode === "potion" || recipe.mode === "toxin") {
    const effects = getFilledAlchemySlots(recipe);
    const highestSL = Math.max(0, ...effects.map((effect) => Number(effect.spellLevel ?? 1)));
    const slOverage = Math.max(0, highestSL - Math.max(0, alchemyRank));
    if (slOverage > 0) {
      breakdown.push({ code: "over-rank", label: `SL ${highestSL} exceeds Alchemy rank ${alchemyRank}`, value: -10 * slOverage });
      totalMod -= 10 * slOverage;
    }
    if (effects.length > 1) {
      breakdown.push({ code: "multiple-effects", label: "Multiple effects (>1)", value: -10 });
      totalMod -= 10;
    }
    return {
      tn,
      alchemyRank,
      highestSL,
      penaltyBreakdown: breakdown,
      totalMod,
      brewTime: effects.reduce((sum, effect) => sum + Number(effect.spellLevel ?? 1), 0),
    };
  }

  if (recipe.mode === "poison") {
    const poisonLevel = Number(recipe.poisonLevel ?? 1);
    const poisonOverage = Math.max(0, poisonLevel - Math.max(0, alchemyRank));
    if (poisonOverage > 0) {
      breakdown.push({ code: "over-rank", label: `Poison level ${poisonLevel} exceeds Alchemy rank ${alchemyRank}`, value: -10 * poisonOverage });
      totalMod -= 10 * poisonOverage;
    }
    return { tn, alchemyRank, highestSL: poisonLevel, penaltyBreakdown: breakdown, totalMod, brewTime: 1 };
  }

  return { tn, alchemyRank, highestSL: 0, penaltyBreakdown: breakdown, totalMod, brewTime: 0 };
}

function _issue(code, message, severity = "error", data = {}) {
  return { code, message, messageKey: `UESRPG.Apps.AlchemyWorkshop.Validation.${code}`, severity, data };
}

export function validateBrewRecipe(actor, recipe) {
  const issues = [];
  const add = (code, message, severity = "error", data = {}) => issues.push(_issue(code, message, severity, data));
  const inventory = getAlchemyInventoryState(actor);
  const alchemySkill = getAlchemySkill(actor);
  const alchemySnapshot = getAlchemySkillSnapshot(actor, { skill: alchemySkill });

  if (!alchemySnapshot.found) add("NoValidSkill", "Actor has no trained Alchemy skill entry.");
  if (["potion", "toxin", "poison"].includes(recipe.mode) && !inventory.requirementMet) {
    add("LabRequired", "No Alchemy Lab or alchemical tools found in inventory.");
  }

  if (recipe.mode === "potion" || recipe.mode === "toxin") {
    for (const rawSlot of recipe.slots ?? []) {
      const hasIngredient = Boolean(rawSlot?.ingredientId);
      const hasEffect = String(rawSlot?.effectSource ?? (rawSlot?.spellUuid ? "spell" : "catalog")) === "spell"
        ? Boolean(rawSlot?.spellUuid)
        : Boolean(rawSlot?.effectKey);
      if (hasIngredient !== hasEffect) add("PartialSlot", "Complete or clear every started recipe slot.");
    }
    const filledSlots = getFilledAlchemySlots(recipe);
    if (!filledSlots.length) add("NoEffects", "No ingredients or effects selected.");

    const uniqueness = [];
    const requiredQuantities = new Map();
    for (const slot of filledSlots) {
      const ingredient = actor?.items?.get?.(slot.ingredientId) ?? null;
      if (!ingredient) {
        add("IngredientMissing", `Ingredient not found in inventory (${slot.ingredientId}).`, "error", { ingredientId: slot.ingredientId });
        continue;
      }

      requiredQuantities.set(ingredient.id, (requiredQuantities.get(ingredient.id) ?? 0) + 1);
      const ingredientData = resolveAlchemyIngredientData(ingredient);
      if (!ingredientData) {
        add("IngredientUnrecognized", `${ingredient.name} is not a recognized alchemical ingredient.`, "error", { ingredientId: ingredient.id });
        continue;
      }
      if (!ingredientData.isConfigured) {
        add("IngredientUnconfigured", `${ingredient.name} has no configured alchemical school.`, "error", { ingredientId: ingredient.id });
        continue;
      }

      const effect = resolveAlchemyEffectDescriptor(actor, slot, { ingredient, mode: recipe.mode });
      if (!effect) {
        add("EffectUnresolved", slot.effectSource === "spell"
          ? `Custom spell effect could not be resolved (${slot.spellUuid}).`
          : `Unknown effect: ${slot.effectKey}.`);
        continue;
      }
      if (effect.compatible === false || !effect.directPayload) {
        add("EffectIncompatible", effect.invalidReason || `Effect "${effect.effectLabel}" cannot be used in a ${recipe.mode}.`);
        continue;
      }

      const effectiveStrength = computeEffectiveStrength(ingredient, actor);
      const sl = Number(effect.spellLevel ?? 1);
      if (effect.school !== ingredientData.school) {
        add("SchoolMismatch", `Effect "${effect.effectLabel}" (${effect.school}) does not match ingredient school "${ingredientData.school}".`);
      }
      if (sl > ingredientData.depthBase) {
        add("DepthExceeded", `Effect "${effect.effectLabel}" SL ${sl} exceeds ingredient depth ${ingredientData.depthBase}.`);
      }
      if (effect.cost > effectiveStrength) {
        add("StrengthExceeded", `Effect "${effect.effectLabel}" cost ${effect.cost} exceeds ingredient effective strength ${effectiveStrength}.`);
      }
      if (Array.isArray(effect.levelOptions) && effect.levelOptions.length && !effect.levelOptions.includes(sl)) {
        add("LevelInvalid", `Effect "${effect.effectLabel}" allows SL ${effect.levelOptions.join(", ")}, not SL ${sl}.`);
      } else if (sl < effect.slMin || sl > effect.slMax) {
        add("LevelInvalid", `Effect "${effect.effectLabel}" SL ${sl} is outside [${effect.slMin}-${effect.slMax}].`);
      }
      for (const parameter of effect.parameters ?? []) {
        const value = String(effect.params?.[parameter.key] ?? "").trim();
        const allowed = (parameter.options ?? []).map((option) => String(option.value));
        if (!value || (allowed.length && !allowed.includes(value))) {
          add("ParameterRequired", `${effect.effectLabel} requires a valid ${parameter.label}.`, "error", { parameter: parameter.key });
        }
      }
      if (effect.automation === "manual") {
        add("ManualResolution", `${effect.effectLabel} requires GM resolution when used.`, "warning", { effectKey: effect.effectKey });
      }
      uniqueness.push(getUniquenessIdentifier(slot));
    }

    if (new Set(uniqueness).size < uniqueness.length) add("DuplicateEffect", "Each effect may only be selected once per brew.");
    for (const [ingredientId, required] of requiredQuantities) {
      const ingredient = actor?.items?.get?.(ingredientId);
      const available = Math.max(0, Number(ingredient?.system?.quantity ?? 0) || 0);
      if (required > available) {
        add("QuantityInsufficient", `${ingredient?.name ?? "Ingredient"} requires ${required} units but only ${available} are available.`, "error", { ingredientId, required, available });
      }
    }
  }

  if (recipe.mode === "poison") {
    const ingredient = actor?.items?.get?.(recipe.ingredientId) ?? null;
    const data = resolveAlchemyIngredientData(ingredient);
    if (!ingredient) add("PoisonIngredientMissing", "No Destruction ingredient selected.");
    else if (!data?.isConfigured) add("IngredientUnconfigured", `${ingredient.name} is not a configured alchemical ingredient.`);
    else if (data.school !== "destruction") add("PoisonRequiresDestruction", "Poison brewing requires a Destruction ingredient.");
    else if (data.quantity < 1) add("QuantityInsufficient", `${ingredient.name} has no remaining units.`);
  }

  const errors = issues.filter((entry) => entry.severity === "error").map((entry) => entry.message);
  const warnings = issues.filter((entry) => entry.severity === "warning").map((entry) => entry.message);
  return { ok: errors.length === 0, errors, warnings, issues };
}
