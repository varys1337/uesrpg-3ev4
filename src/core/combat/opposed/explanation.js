/** Pure projections of committed test records; no recalculation or runtime context. */
import { recordedDamageNumber } from "../damage/explanation.js";
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function text(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }

export function projectOpposedResolutionExplanation({ attacker, defender, advantage } = {}) {
  const a = record(attacker), d = record(defender), adv = record(advantage);
  return {
    variation: text(a.variantLabel) ?? text(a.variant),
    defense: text(d.defenseLabel) ?? text(d.defenseType),
    manual: recordedDamageNumber(a.manualMod),
    attackerLocation: text(a.precisionLocation) ?? text(a.hitLocation),
    defenderLocation: text(d.precisionLocation) ?? text(d.hitLocation),
    attackerAdvantage: recordedDamageNumber(adv.attacker), defenderAdvantage: recordedDamageNumber(adv.defender),
    duelingBonus: recordedDamageNumber(record(d.result).duelingBonus),
  };
}
export function projectOpposedTestExplanation(participant, { includeComponents = false } = {}) {
  const source = record(participant), tn = record(source.tn), result = record(source.result);
  const model = {
    roll: recordedDamageNumber(result.rollTotal), target: recordedDamageNumber(result.target),
    degree: recordedDamageNumber(result.degree), success: typeof result.isSuccess === "boolean" ? result.isSuccess : null,
  };
  if (includeComponents === true) {
    model.baseTN = recordedDamageNumber(tn.baseTN);
    model.totalMod = recordedDamageNumber(tn.totalMod);
    model.finalTN = recordedDamageNumber(tn.finalTN);
    const entries = tn.breakdown ?? tn.modifiers;
    model.components = (Array.isArray(entries) ? entries : []).filter(row => row && typeof row === "object" && !Array.isArray(row))
      .map(row => ({ label: text(row.label), value: recordedDamageNumber(row.value) }));
  }
  return model;
}

