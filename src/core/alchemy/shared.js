import { emitSuppressedSubRollDice } from "../../utils/dice-visualization.js";
import { FLAG_SCOPE } from "../system/namespace.js";

export const FLAG_NS = FLAG_SCOPE;
export const ALCHEMY_DEFAULT_ICON = "icons/consumables/potions/bottle-bulb-empty-glass.webp";
export const COATING_AUTOMATION_PAUSED = true;
export const COATING_MANUAL_GUIDANCE = "Poison and toxin coating automation is paused. With the GM, review the Item, weapon or ammunition, previous chat and any paid costs; resolve application, hits, duration, resistance and effects manually. Do not repeat an uncertain action before checking its results.";

export function cloneAlchemyData(value) {
  try {
    return foundry.utils.deepClone(value);
  } catch (_err) {
    return JSON.parse(JSON.stringify(value));
  }
}

export function getAlchemyFlags(item) {
  return item?.flags?.[FLAG_NS]?.alchemy ?? {};
}

export function emitAlchemyRoll3d(roll, options = {}) {
  if (!roll || !game?.dice3d?.showForRoll) return null;
  void emitSuppressedSubRollDice(roll, options);
  return true;
}

export function formatAlchemyDurationLabel(duration) {
  if (!duration) return "";
  const unit = String(duration.unit ?? "").trim();
  if (!unit) return "";
  return `${Number(duration.value ?? 0)} ${unit}`;
}
