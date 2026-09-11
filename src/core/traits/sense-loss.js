import { hasTalent } from "./talents-api.js";
import { _num as asNumber } from "./_primitives.js";

const SENSE_LOSS_MOD_KEYS = new Set(["blinded", "deafened"]);

function isSenseLossModifier(modifier) {
  if (!modifier || typeof modifier !== "object") return false;
  const key = String(modifier.key ?? "").trim().toLowerCase();
  if (!SENSE_LOSS_MOD_KEYS.has(key)) return false;

  const source = String(modifier.source ?? "").trim().toLowerCase();
  return source === "sense-loss" || source === "condition" || !source;
}

export function adjustSensePenalty(penalty, actor) {
  const value = asNumber(penalty, 0);
  if (!actor || !value) return value;

  if (hasTalent(actor, "onewithall")) return 0;
  if (hasTalent(actor, "honedsenses")) return Math.trunc(value / 2);

  const mode = actor?.system?._reOverrides?.["system.senses.lossReduction"] ?? null;
  if (mode === "negate") return 0;
  if (mode === "halve") return Math.trunc(value / 2);
  return value;
}

export function applySenseLossPenaltyAdjustments(situationalMods, actor) {
  if (!Array.isArray(situationalMods) || !actor) return;

  const hasAll = hasTalent(actor, "onewithall");
  const hasHoned = !hasAll && hasTalent(actor, "honedsenses");
  const reMode = actor?.system?._reOverrides?.["system.senses.lossReduction"] ?? null;
  if (!hasAll && !hasHoned && reMode !== "negate" && reMode !== "halve") return;

  for (const modifier of situationalMods) {
    if (!isSenseLossModifier(modifier) || modifier?._awarenessAdjusted) continue;
    const before = asNumber(modifier.value, 0);
    if (!before) {
      modifier._awarenessAdjusted = true;
      continue;
    }

    const after = adjustSensePenalty(before, actor);
    if (after !== before) {
      const mode = String(modifier.applyMode ?? "").toLowerCase();
      modifier.value = mode === "offset" ? after - before : after;

      const label = String(modifier.label ?? "").trim();
      if (label) {
        if (hasAll && !/one with all/i.test(label)) modifier.label = `${label} (One with All)`;
        else if (hasHoned && !/honed senses/i.test(label)) modifier.label = `${label} (Honed Senses)`;
      }
      modifier.source = "sense-loss";
    }
    if (!modifier.conditionKey && modifier.key) modifier.conditionKey = String(modifier.key);
    modifier._awarenessAdjusted = true;
  }
}
