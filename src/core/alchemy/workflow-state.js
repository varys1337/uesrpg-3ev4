import { FLAG_NS } from "./shared.js";
import { updateAlchemyDocument } from "./operations.js";

export function computeAlchemyRecipeHash(recipe, { getFilledSlots, getSlotIdentifier } = {}) {
  const effects = (typeof getFilledSlots === "function" ? getFilledSlots(recipe) : [])
    .map((slot) => (typeof getSlotIdentifier === "function" ? getSlotIdentifier(slot) : ""))
    .sort()
    .join(",");
  return `${recipe?.mode ?? ""}|${effects}|${recipe?.poisonLevel ?? 0}`;
}

export async function updateTrialAndErrorState(actor, nextState) {
  return updateAlchemyDocument(actor, { [`flags.${FLAG_NS}.alchemy.trialAndError`]: nextState });
}
