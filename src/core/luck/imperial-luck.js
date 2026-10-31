import { getFlagValueWithFallback } from "../system/flags.js";
import { hasTalent } from "../traits/talents-api.js";
import { canApplyCharGenGatedImperialTalents } from "../traits/racial-talents.js";

export function hasActiveImperialLuck(actor, { warn = false } = {}) {
  return hasTalent(actor, "imperialluck") && canApplyCharGenGatedImperialTalents(actor,
    { warnTalentName: warn ? "Imperial Luck" : null });
}

/** A pending or unrecognized operation must be reviewed before another Luck action. */
export function getPendingImperialLuckOperation(actor) {
  const operation = getFlagValueWithFallback(actor, "imperialLuckOperation");
  if (!operation || ["completed", "reviewed"].includes(operation.status)) return null;
  return operation;
}

/** Older or alternate Luck actions do not identify whether the first DoS was added. */
export function hasUntrackedImperialLuckHistory(message) {
  const spent = Number(getFlagValueWithFallback(message, "imperialLuck.lpSpent") ?? 0) || 0;
  return spent <= 0 && Boolean(getFlagValueWithFallback(message, "luckUsedOnTest")
    || getFlagValueWithFallback(message, "luckBurned"));
}
